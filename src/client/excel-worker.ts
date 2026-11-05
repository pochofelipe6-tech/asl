import * as XLSX from 'xlsx';
import { COLUMNAS_EXCEL, MAX_ARCHIVO, MAX_FILAS, MAX_FILAS_BLOQUE, normalizarFila, validarColumnas } from '../shared/excel';
import type { FilaExcel, ValorExcel } from '../shared/excel';

type HojaDensa = XLSX.WorkSheet & XLSX.CellObject[][];
let filas: FilaExcel[] = [];
let exportacion: XLSX.WorkSheet | undefined;
let exportadas = 0;
const encoder = new TextEncoder();

function nuevaHoja(): XLSX.WorkSheet {
  const opciones: XLSX.AOA2SheetOpts & { dense: boolean } = { dense: true };
  const hoja = XLSX.utils.aoa_to_sheet([[...COLUMNAS_EXCEL]], opciones);
  hoja['!cols'] = COLUMNAS_EXCEL.map((_, i) => ({ wch: i === 8 ? 40 : i === 0 || i === 5 || i === 7 ? 23 : 19 }));
  return hoja;
}
function escribir(hoja: XLSX.WorkSheet, plantilla = false): ArrayBuffer {
  const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, 'Data');
  if (plantilla) {
    const instrucciones = XLSX.utils.aoa_to_sheet([
      ['Plantilla de información de frescura'],
      ['Completa la hoja Data. Conserva los 41 encabezados y su orden.'],
      ['Fecha envio información es obligatoria. Usa fechas de Excel o DD/MM/AAAA.'],
      ['Cantidad, Hectolitros, Cajas, Costo USD, Dias Venc Actual y Valor total deben ser números.'],
      ['Las columnas Venta aparecen dos veces porque corresponden al formato de origen.'],
      ['Se importan los valores guardados: recalcula las fórmulas y guarda el archivo antes de subirlo.'],
      ['El archivo completo será el nuevo informe. Incluye el histórico que quieras consultar.'],
      ['Máximo 300.000 filas y 100 MB. Formatos admitidos para subir: .xlsx y .xlsb.'],
    ]);
    instrucciones['!cols'] = [{ wch: 110 }];
    XLSX.utils.book_append_sheet(libro, instrucciones, 'Instrucciones');
  }
  return XLSX.write(libro, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
}

// Un worker evita bloquear los filtros y el resto de la pantalla al leer un libro grande.
self.addEventListener('message', (event: MessageEvent) => {
  const { id, accion, datos } = event.data;
  try {
    let resultado: unknown;
    if (accion === 'leer') {
      filas = [];
      const buffer = datos as ArrayBuffer;
      if (buffer.byteLength > MAX_ARCHIVO) throw new Error('El archivo supera el máximo de 100 MB.');
      const libro = XLSX.read(buffer, { dense: true, sheets: 'Data', cellFormula: true, cellText: false, cellNF: false });
      const hoja = libro.Sheets.Data as HojaDensa | undefined;
      if (!hoja?.['!ref']) throw new Error('El archivo debe contener una hoja llamada Data. Descarga la plantilla.');
      const rango = XLSX.utils.decode_range(hoja['!ref']);
      if (rango.e.r > MAX_FILAS + 10000) throw new Error('La hoja contiene demasiadas filas. El máximo es 300.000 registros.');
      const cabecera = Array.from({ length: Math.max(41, rango.e.c + 1) }, (_, c) => String(hoja[0]?.[c]?.v ?? '').trim());
      while (cabecera.length > 41 && !cabecera.at(-1)) cabecera.pop();
      validarColumnas(cabecera);
      let primeraFecha = Infinity, ultimaFecha = -Infinity;
      const fechas1904 = !!libro.Workbook?.WBProps?.date1904;
      for (let r = 1; r <= rango.e.r; r++) {
        if (hoja[r]?.slice(41).some(celda => celda?.v != null && celda.v !== '')) throw new Error(`Fila ${r + 1}: hay valores fuera de las 41 columnas.`);
        const valores = COLUMNAS_EXCEL.map((_, c) => {
          const celda = hoja[r]?.[c];
          if (celda?.t === 'e') throw new Error(`Fila ${r + 1}, ${COLUMNAS_EXCEL[c]}: corrige el error de Excel antes de importar.`);
          if (celda?.f && celda.v == null) throw new Error(`Fila ${r + 1}: recalcula las fórmulas en Excel y guarda el archivo antes de subirlo.`);
          const valor = celda?.v ?? null;
          return fechas1904 && [0, 5, 7].includes(c) && typeof valor === 'number' ? valor + 1462 : valor;
        });
        if (valores.every(v => v === null || v === '')) continue;
        const normalizados = normalizarFila(valores, r + 1);
        filas.push({ fila_excel: r + 1, valores: normalizados });
        primeraFecha = Math.min(primeraFecha, Number(normalizados[0])); ultimaFecha = Math.max(ultimaFecha, Number(normalizados[0]));
        if (filas.length > MAX_FILAS) throw new Error('El archivo supera el máximo de 300.000 filas.');
      }
      if (!filas.length) throw new Error('La hoja Data está vacía. Completa la plantilla antes de importarla.');
      const fecha = (serial: number) => new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
      resultado = { filas: filas.length, desde: fecha(primeraFecha), hasta: fecha(ultimaFecha), muestra: filas.slice(0, 3).map(f => [f.valores[9], f.valores[8], f.valores[12]]) };
    } else if (accion === 'bloque') {
      const bloque: FilaExcel[] = []; let bytes = 0;
      for (const fila of filas.slice(Number(datos), Number(datos) + MAX_FILAS_BLOQUE)) {
        const tamano = encoder.encode(JSON.stringify(fila)).length;
        if (bloque.length && bytes + tamano > 750000) break;
        bloque.push(fila); bytes += tamano;
      }
      resultado = bloque;
    } else if (accion === 'plantilla') {
      resultado = escribir(nuevaHoja(), true);
    } else if (accion === 'exportar-inicio') {
      exportacion = nuevaHoja(); exportadas = 0; resultado = true;
    } else if (accion === 'exportar-filas') {
      if (!exportacion) throw new Error('No se inició la descarga.');
      const registros = datos as ValorExcel[][];
      XLSX.utils.sheet_add_aoa(exportacion, registros, { origin: -1 });
      const densa = exportacion as HojaDensa;
      for (let r = exportadas + 1; r <= exportadas + registros.length; r++) {
        for (const c of [0, 5, 7]) if (densa[r]?.[c]?.t === 'n') densa[r][c].z = c === 7 ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy';
      }
      exportadas += registros.length; resultado = exportadas;
    } else if (accion === 'exportar-fin') {
      if (!exportacion) throw new Error('No se inició la descarga.');
      resultado = escribir(exportacion); exportacion = undefined;
    } else throw new Error('Operación de Excel desconocida.');
    if (resultado instanceof ArrayBuffer) self.postMessage({ id, resultado }, { transfer: [resultado] });
    else self.postMessage({ id, resultado });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'No se pudo procesar el Excel.' });
  }
});
