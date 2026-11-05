export const COLUMNAS_EXCEL = [
  'Fecha envio información', 'Llave', 'Código CD', 'Código Material', 'Cantidad',
  'Fecha Vencimiento', 'Usuario', 'Fecha Modificación', 'Material', 'CD', 'Factor',
  'HL', 'Hectolitros', 'Cajas', 'Mes', 'Días Vencimiento', 'Rango Días 1', 'Día',
  'Empaque', 'Línea', 'USD/HL', 'Costo USD', 'Gerencia', 'Semana', 'TRM',
  'Clase Envase', 'Vencimiento 2', 'Vida Útil', 'Dias Venc Actual', 'Venc Actual',
  'Logística', 'Ventas', 'Valor UN', 'Valor total', 'Canal', 'Venta',
  'Politica_Min_Dias', 'Politica_Max_Dias', 'Venta', 'Mes 1', 'Año',
] as const;

export const MAX_FILAS = 300000;
export const MAX_ARCHIVO = 100 * 1024 * 1024;
export const MAX_FILAS_BLOQUE = 500;
export type ValorExcel = string | number | boolean | null;
export type FilaExcel = { fila_excel: number; valores: ValorExcel[] };
const numericas = new Set([4, 12, 13, 21, 28, 33]);

export function validarColumnas(columnas: unknown): void {
  if (!Array.isArray(columnas) || columnas.length !== COLUMNAS_EXCEL.length) throw new Error('La hoja Data debe tener exactamente 41 columnas. Usa la plantilla.');
  for (let i = 0; i < COLUMNAS_EXCEL.length; i++) {
    if (String(columnas[i] ?? '').trim() !== COLUMNAS_EXCEL[i]) throw new Error(`La columna ${i + 1} debe llamarse «${COLUMNAS_EXCEL[i]}». Usa el orden de la plantilla.`);
  }
}

export function fechaExcel(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number' && Number.isFinite(valor) && valor >= 1 && valor < 2958466) return Math.floor(valor);
  if (typeof valor !== 'string') throw new Error('Escribe una fecha válida de Excel, AAAA-MM-DD o DD/MM/AAAA.');
  const texto = valor.trim();
  if (!texto) return null;
  if (/^\d{1,7}$/.test(texto)) return fechaExcel(Number(texto));
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
  if (!iso && !local) throw new Error('Escribe una fecha válida de Excel, AAAA-MM-DD o DD/MM/AAAA.');
  const [anio, mes, dia] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(local![3]), Number(local![2]), Number(local![1])];
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (anio < 1900 || fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) throw new Error('La fecha no existe.');
  return fechaExcel((fecha.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
}

export function normalizarFila(fila: unknown, numeroFila: number): ValorExcel[] {
  if (!Array.isArray(fila) || fila.length !== COLUMNAS_EXCEL.length) throw new Error(`Fila ${numeroFila}: se esperaban 41 valores.`);
  const valores = fila.map((valor, columna): ValorExcel => {
    try {
      if (valor === undefined || valor === null || valor === '') return null;
      if (typeof valor !== 'string' && typeof valor !== 'number' && typeof valor !== 'boolean') throw new Error('El valor no es una celda válida.');
      if (typeof valor === 'number' && !Number.isFinite(valor)) throw new Error('El número no es válido.');
      if (typeof valor === 'string' && valor.length > 2000) throw new Error('El texto supera los 2.000 caracteres.');
      if (columna === 0 || columna === 5) return fechaExcel(valor);
      if (numericas.has(columna)) {
        if (typeof valor === 'string' && !valor.trim()) return null;
        if (typeof valor === 'boolean' || (typeof valor === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(valor.trim()))) throw new Error('Usa una celda numérica, sin símbolos de moneda ni separadores de miles.');
        const numero = Number(valor);
        if (!Number.isFinite(numero)) throw new Error('El número no es válido.');
        return numero;
      }
      return valor;
    } catch (error) {
      throw new Error(`Fila ${numeroFila}, ${COLUMNAS_EXCEL[columna]}: ${error instanceof Error ? error.message : 'valor no válido'}`);
    }
  });
  if (valores[0] === null) throw new Error(`Fila ${numeroFila}: falta Fecha envio información.`);
  if (new TextEncoder().encode(JSON.stringify(valores)).length > 16000) throw new Error(`La fila ${numeroFila} contiene demasiado texto.`);
  return valores;
}
