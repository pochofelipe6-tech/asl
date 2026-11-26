// Lee ATCT.xlsx o ESPERA.xlsx en segundo plano (unas 100.000 filas), lo pasa a columnas y lo comprime con gzip
// para subirlo. Detecta el tipo por el encabezado de la hoja (normalmente "Export").
import * as XLSX from 'xlsx';
import { leerAtct, leerEspera, tipoDeEncabezado } from '../shared/t1';
import type { ColumnasT1, Lectura } from '../shared/t1';

export interface RespuestaWorkerT1 {
  error?: string;
  tipo?: 'atct' | 'espera';
  filas?: number; omitidas?: { fila: number; motivo: string }[]; desde?: number | null; hasta?: number | null;
  gzip?: ArrayBuffer;
}

async function comprimir(texto: string): Promise<ArrayBuffer> {
  const flujo = new Blob([texto]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(flujo).arrayBuffer();
}

self.onmessage = async (evento: MessageEvent<{ file: File }>) => {
  try {
    const libro = XLSX.read(await evento.data.file.arrayBuffer(), { dense: true, cellDates: false, cellFormula: false, cellHTML: false, cellText: false });
    for (const nombre of libro.SheetNames) {
      const filas = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[nombre], { header: 1, raw: true, defval: null });
      const tipo = tipoDeEncabezado(filas[0] ?? []);
      if (!tipo) continue;
      const lectura: Lectura<ColumnasT1> = tipo === 'atct' ? leerAtct(filas) : leerEspera(filas);
      const gzip = await comprimir(JSON.stringify(lectura.columnas));
      const respuesta: RespuestaWorkerT1 = { tipo, filas: lectura.filas, omitidas: lectura.omitidas.slice(0, 50), desde: lectura.desde, hasta: lectura.hasta, gzip };
      (self as unknown as Worker).postMessage(respuesta, [gzip]);
      return;
    }
    throw new Error('No encontré una hoja con las columnas de ATCT (Fecha, Registro, Placa, Ubicación, Zona…) ni de ESPERA (Placa, Hora programada, Enturnamiento…).');
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: (error as Error).message } satisfies RespuestaWorkerT1);
  }
};
