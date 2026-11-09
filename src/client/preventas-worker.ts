import * as XLSX from 'xlsx';
import { COLUMNAS_PREVENTAS, MAX_PREVENTAS, normalizarPreventa } from '../shared/preventas';
import { esBase, transformarBase } from '../shared/preventas-base';

self.onmessage = async (event: MessageEvent<{file: File; fecha: string}>) => {
  try {
    const buffer = await event.data.file.arrayBuffer();
    const nombres = XLSX.read(buffer, {bookSheets: true}).SheetNames;
    if (!nombres.includes('Datos')) {
      const base = XLSX.read(buffer, {dense: true, cellFormula: false, cellHTML: false, cellText: false});
      for (const nombre of nombres) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(base.Sheets[nombre], {header: 1, defval: null});
        if (esBase(rows[0] ?? [])) { self.postMessage(transformarBase(rows, event.data.fecha)); return; }
      }
      throw new Error('Selecciona el archivo base de 15 columnas o un Excel con la hoja Datos de 35 columnas.');
    }
    const libro = XLSX.read(buffer, { dense: true, sheets: ['Datos', 'SO'], cellFormula: false, cellHTML: false, cellText: false });
    const hoja = libro.Sheets.Datos as unknown as XLSX.CellObject[][];
    if (!hoja) throw new Error('El archivo debe incluir la hoja Datos.');
    for (let c = 0; c < 35; c++) if (String(hoja[0]?.[c]?.v ?? '').trim() !== COLUMNAS_PREVENTAS[c].trim()) throw new Error(`Columna ${c + 1}: se esperaba ${COLUMNAS_PREVENTAS[c]}. Usa la plantilla.`);
    const filas = [];
    for (let i = 1; i < hoja.length; i++) {
      const row = hoja[i];
      if (!row || ![0, 2, 3, 4, 7, 13, 15].some(c => row[c]?.v !== undefined && row[c]?.v !== '')) continue;
      filas.push(normalizarPreventa(Array.from({ length: 35 }, (_, c) => row[c]?.t === 'e' ? null : row[c]?.v ?? null), i + 1));
      if (filas.length > MAX_PREVENTAS) throw new Error('Máximo 10.000 registros por archivo.');
    }
    if (!filas.length) throw new Error('La hoja Datos no contiene registros.');
    const so = libro.Sheets.SO as unknown as XLSX.CellObject[][] | undefined;
    const snapshot = [];
    if (so && typeof so[1]?.[1]?.v === 'number' && String(so[2]?.[0]?.v).includes('AGOTADOS')) {
      for (let r = 5; r < so.length; r++) {
        if (!/^\d+$/.test(String(so[r]?.[0]?.v ?? ''))) continue;
        for (let c = 2; c < 19; c++) {
          if (so[r][c]?.v === undefined || !so[4]?.[c]?.v) continue;
          snapshot.push({ fecha: so[1][1].v, material: String(so[r][0].v), descripcion: String(so[r][1]?.v ?? ''), cd: String(so[4][c].v), agotados: Number(so[r][c].v) });
        }
      }
    }
    self.postMessage({ filas, snapshot });
  } catch (error) { self.postMessage({ error: (error as Error).message }); }
};
