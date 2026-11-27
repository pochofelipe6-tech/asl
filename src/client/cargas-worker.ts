// Lee Data WIP.xlsx, Data FMS.xlsx o el Excel de bajas de SAP en segundo plano, lo pasa a columnas y lo comprime con gzip para subirlo.
// Detecta el tipo por el encabezado de cada hoja (normalmente "Hoja1" en WIP y "Data FMS" en FMS).
// Se le envía { file, tipo } y responde solo si el archivo es del tipo pedido.
import * as XLSX from 'xlsx';
import { esEncabezadoWip, leerWip, COLUMNAS_WIP } from '../shared/wip';
import { esEncabezadoFms, leerFms, COLUMNAS_FMS } from '../shared/ofe';
import { esEncabezadoBajas, leerBajas } from '../shared/bajas';

export type TipoCargaComando = 'wip' | 'fms' | 'bajas';
export interface PedidoWorkerCargas { file: File; tipo: TipoCargaComando }
export interface RespuestaWorkerCargas {
  error?: string;
  tipo?: TipoCargaComando;
  filas?: number; omitidas?: { fila: number; motivo: string }[]; desde?: number | null; hasta?: number | null;
  gzip?: ArrayBuffer;
}

const LECTORES = {
  wip: { es: esEncabezadoWip, leer: leerWip, nombre: 'Data WIP', columnas: COLUMNAS_WIP },
  fms: { es: esEncabezadoFms, leer: leerFms, nombre: 'Data FMS', columnas: COLUMNAS_FMS },
  bajas: { es: esEncabezadoBajas, leer: leerBajas, nombre: 'el Excel de bajas', columnas: ['Ce.', 'Nombre 1', 'CMv', 'Material', 'Texto breve de material', 'Fe.contab.', 'Cantidad', 'Importe ML'] },
} as const;

async function comprimir(texto: string): Promise<ArrayBuffer> {
  const flujo = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(flujo).arrayBuffer();
}

self.onmessage = async (evento: MessageEvent<PedidoWorkerCargas>) => {
  const { file, tipo } = evento.data;
  try {
    const lector = LECTORES[tipo];
    if (!lector) throw new Error('Tipo de archivo desconocido.');
    const libro = XLSX.read(await file.arrayBuffer(), { dense: true, cellDates: false, cellFormula: false, cellHTML: false, cellText: false });
    for (const nombre of libro.SheetNames) {
      const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[nombre], { header: 1, raw: true, defval: null });
      if (!lector.es(filas[0] ?? [])) continue;
      const lectura = lector.leer(filas);
      const gzip = await comprimir(JSON.stringify(lectura.columnas));
      const respuesta: RespuestaWorkerCargas = { tipo, filas: lectura.filas, omitidas: lectura.omitidas.slice(0, 50), desde: lectura.desde, hasta: lectura.hasta, gzip };
      (self as unknown as Worker).postMessage(respuesta, [gzip]);
      return;
    }
    const otro = (Object.keys(LECTORES) as TipoCargaComando[]).find(t => t !== tipo && libro.SheetNames.some(n => LECTORES[t].es(XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[n], { header: 1, raw: true, defval: null, range: 0 })[0] ?? [])));
    throw new Error(otro
      ? `Ese archivo es ${LECTORES[otro].nombre}; aquí va ${lector.nombre}.`
      : `No encontré una hoja con las columnas de ${lector.nombre}: ${lector.columnas.join(', ')}.`);
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: (error as Error).message } satisfies RespuestaWorkerCargas);
  }
};
