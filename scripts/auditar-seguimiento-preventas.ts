import XLSX from 'xlsx';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { normalizarPreventa } from '../src/shared/preventas.ts';

const archivo = process.argv[2];
if (!archivo) throw new Error('Indica el Excel de seguimiento.');
const libro = XLSX.readFile(archivo, { sheets: ['Datos', 'Preventa x Canal'], dense: true, cellText: false, cellHTML: false });
const datos = libro.Sheets.Datos as unknown as XLSX.CellObject[][];
const tabla = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets['Preventa x Canal'], { header: 1, defval: null });
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
try {
  if (!process.env.SUPABASE_DB_URL) throw new Error('Falta conexión a la base de datos.');
  const lotes = (await pool.query('select id,archivo,creado_en from public.preventas_lotes order by creado_en desc,id desc')).rows;
  const db = (await pool.query(`with cortes as (
    select distinct on (d.fecha) d.fecha,d.lote_id from public.preventas_datos d
    join public.preventas_lotes l on l.id=d.lote_id order by d.fecha,l.creado_en desc,l.id desc
  ) select d.fila,d.valores,d.lote_id from public.preventas_datos d
    join cortes c on c.fecha=d.fecha and c.lote_id=d.lote_id order by d.fecha,d.fila`)).rows;
  const excel: { fila: number; valores: any[]; formulas: Record<string, unknown> }[] = [];
  for (let r = 1; r < datos.length; r++) {
    if (!datos[r]?.some(c => c?.v !== undefined && c.v !== '')) continue;
    const valores = Array.from({ length: 35 }, (_, c) => datos[r]?.[c]?.v ?? null);
    excel.push({ fila: r + 1, valores, formulas: Object.fromEntries([11, 16, 17, 18, 19, 20, 21].map(c => [XLSX.utils.encode_col(c), datos[r]?.[c]?.f])) });
  }
  const fecha = Number(tabla[4]?.[2]);
  const resumen = (rows: { valores: any[] }[]) => {
    const cds: Record<string, { filas: number; preventa: number; disponible: number; agotados: number }> = {};
    for (const { valores: f } of rows) {
      const cd = String(f[21]), g = cds[cd] ??= { filas: 0, preventa: 0, disponible: 0, agotados: 0 };
      g.filas++; g.preventa += Number(f[18]); g.agotados += Number(f[20]); g.disponible += Number(f[18]) - Number(f[20]);
    }
    return cds;
  };
  const corteExcel = excel.filter(r => Number(r.valores[0]) === fecha), corteDb = db.filter(r => Number(r.valores[0]) === fecha);
  const key = (f: any[]) => JSON.stringify([Number(f[0]), String(f[2]), String(f[3]), String(f[15])]);
  const gruposDb = new Map<string, any[]>();
  for (const r of corteDb) { const k = key(r.valores); gruposDb.set(k, [...(gruposDb.get(k) ?? []), r]); }
  const diferencias: any[] = [];
  for (const r of corteExcel) {
    const match = gruposDb.get(key(r.valores))?.shift();
    if (!match) { diferencias.push({ tipo: 'soloExcel', ...r }); continue; }
    const celdas = r.valores.flatMap((v, c) => {
      const b = match.valores[c];
      if (v === b || String(v ?? '') === String(b ?? '') || (typeof v === 'number' && typeof b === 'number' && Math.abs(v - b) < 1e-8)) return [];
      return [{ columna: XLSX.utils.encode_col(c), excel: v, db: b }];
    });
    if (celdas.length) diferencias.push({ tipo: 'celdas', filaExcel: r.fila, filaDb: match.fila, cd: r.valores[21], material: r.valores[3], descripcion: r.valores[4], canal: r.valores[15], celdas, formulas: r.formulas });
  }
  for (const rows of gruposDb.values()) for (const r of rows) diferencias.push({ tipo: 'soloDb', ...r });
  const formulasDistintas: any[] = [];
  for (const r of corteExcel) {
    try {
      const f = normalizarPreventa(r.valores, r.fila);
      const celdas = [11, 14, 18, 19, 20].filter(c => Math.abs(Number(f[c]) - Number(r.valores[c])) > 1e-8);
      if (celdas.length) formulasDistintas.push({ fila: r.fila, cd: r.valores[21], material: r.valores[3], celdas: celdas.map(c => ({ columna: XLSX.utils.encode_col(c), excel: r.valores[c], recalculado: f[c] })), formulas: r.formulas });
    } catch (e) { formulasDistintas.push({ fila: r.fila, error: (e as Error).message }); }
  }
  const informe = { archivo, fecha, lotes, fechasExcel: [...new Set(excel.map(r => r.valores[0]))], fechasDb: [...new Set(db.map(r => r.valores[0]))], filasExcel: excel.length, filasDb: db.length, corteExcel: corteExcel.length, corteDb: corteDb.length, resumenExcel: resumen(corteExcel), resumenDb: resumen(corteDb), tablaExcel: tabla.slice(3, 30), diferencias, formulasDistintas, riohachaExcel: corteExcel.filter(r => String(r.valores[21]).toLowerCase().includes('riohacha')), riohachaDb: corteDb.filter(r => String(r.valores[21]).toLowerCase().includes('riohacha')) };
  await writeFile('datos/preventas/auditoria-seguimiento.json', JSON.stringify(informe, null, 2));
  console.log(JSON.stringify({ fecha, filasExcel: excel.length, corteExcel: corteExcel.length, corteDb: corteDb.length, resumenExcel: informe.resumenExcel, resumenDb: informe.resumenDb, diferencias: diferencias.length, formulasDistintas }, null, 2));
} finally { await pool.end(); }
