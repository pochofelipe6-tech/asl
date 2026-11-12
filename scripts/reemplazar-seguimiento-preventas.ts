// Sustituye solo el corte del Excel auditado y conserva los demás cortes y SO.
import XLSX from 'xlsx';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { completarDatosPreventas } from '../src/shared/preventas-completar.ts';

const archivo = process.argv[2];
if (!archivo || !process.env.SUPABASE_DB_URL) throw new Error('Indica el Excel y configura la conexión.');
const w = XLSX.readFile(archivo, { dense: true, sheets: ['Datos', 'Fuentes', 'Preventa x Canal'], cellText: false, cellHTML: false });
const sheet = w.Sheets.Datos as unknown as XLSX.CellObject[][];
const originales: unknown[][] = [];
for (let i = 1; i < sheet.length; i++) {
  if (!sheet[i]?.some(c => c?.v !== undefined && c.v !== '')) continue;
  originales.push(Array.from({ length: 35 }, (_, c) => sheet[i]?.[c]?.t === 'e' ? null : sheet[i]?.[c]?.v ?? null));
}
const fuentes = XLSX.utils.sheet_to_json<unknown[]>(w.Sheets.Fuentes, { header: 1, defval: null });
const filas = completarDatosPreventas(originales, fuentes);
if (filas.length !== 1228 || filas.some(f => f[0] !== 46338)) throw new Error('No es el corte auditado de 1.228 filas del 12/11/2026.');
const metricas = (rows: (string | number | null)[][]) => rows.reduce((s, f) => ({ preventa: s.preventa + Number(f[18]), disponible: s.disponible + Number(f[18]) - Number(f[20]), agotados: s.agotados + Number(f[20]) }), { preventa: 0, disponible: 0, agotados: 0 });
const tabla = XLSX.utils.sheet_to_json<unknown[]>(w.Sheets['Preventa x Canal'], { header: 1, defval: null });
const totalExcel = tabla.find(r => r[1] === 'Total general');
const resumenTabla = tabla.slice(7, tabla.findIndex(r => r[1] === 'Total general'));
const esperado = metricas(filas);
if (!totalExcel || [esperado.preventa - Number(totalExcel[2]), esperado.disponible - Number(totalExcel[3]), esperado.agotados - Number(totalExcel[4])].some(n => Math.abs(n) > 1e-7)) throw new Error('Los cálculos no concuerdan con la tabla del seguimiento.');
for (const r of resumenTabla) {
  const m = metricas(filas.filter(f => f[21] === r[1]));
  if ([m.preventa - Number(r[2]), m.disponible - Number(r[3]), m.agotados - Number(r[4])].some(n => Math.abs(n) > 1e-7)) throw new Error(`No concuerda el CD ${r[1]}.`);
}
const activeSql = `with cortes as (
  select distinct on(d.fecha) d.fecha,d.lote_id from public.preventas_datos d
  join public.preventas_lotes l on l.id=d.lote_id order by d.fecha,l.creado_en desc,l.id desc
) select d.lote_id,d.fila,d.valores from public.preventas_datos d
  join cortes c on c.fecha=d.fecha and c.lote_id=d.lote_id order by d.fecha,d.fila`;
const hash = (rows: unknown[]) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
try {
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtext('preventas:guardar'))");
  const antes = (await client.query(activeSql)).rows;
  const otros = antes.filter(r => Number(r.valores[0]) !== 46338);
  const anteriores = antes.filter(r => Number(r.valores[0]) === 46338);
  const soAntes = (await client.query('select * from public.preventas_so_snapshot order by lote_id,fecha_excel,material,cd')).rows;
  const firmas = (r: (string | number | null)[][]) => r.map(f => JSON.stringify(f)).sort();
  if (JSON.stringify(firmas(anteriores.map(r => r.valores))) === JSON.stringify(firmas(filas))) {
    await client.query('rollback'); console.log('El seguimiento ya está cargado; no se duplicó.');
  } else {
    await writeFile('datos/preventas/respaldo-antes-seguimiento-copia-2.json', JSON.stringify({ archivo, anteriores, otrosHash: hash(otros), soHash: hash(soAntes) }, null, 2));
    const usuario = (await client.query('select usuario_id from public.preventas_lotes order by creado_en desc,id desc limit 1')).rows[0]?.usuario_id ?? null;
    const id = randomUUID();
    await client.query('insert into public.preventas_lotes(id,archivo,usuario_id) values($1,$2,$3)', [id, basename(archivo), usuario]);
    await client.query(`insert into public.preventas_datos(lote_id,fila,valores)
      select $1,ordinality::int,value from jsonb_array_elements($2::jsonb) with ordinality`, [id, JSON.stringify(filas)]);
    const despues = (await client.query(activeSql)).rows;
    const corte = despues.filter(r => Number(r.valores[0]) === 46338);
    const soDespues = (await client.query('select * from public.preventas_so_snapshot order by lote_id,fecha_excel,material,cd')).rows;
    if (hash(otros) !== hash(despues.filter(r => Number(r.valores[0]) !== 46338)) || hash(soAntes) !== hash(soDespues)) throw new Error('Cambió información ajena al corte; se cancela la operación.');
    if (corte.length !== filas.length || JSON.stringify(firmas(corte.map(r => r.valores))) !== JSON.stringify(firmas(filas))) throw new Error('Falló la verificación del corte guardado.');
    await client.query('commit');
    const resultado = { archivo: basename(archivo), fecha: '2026-11-12', lote: id, filas: corte.length, totales: metricas(corte.map(r => r.valores)), otrosRegistrosConservados: otros.length, soConservado: true, cdsVerificados: resumenTabla.map(r => r[1]) };
    await writeFile('datos/preventas/resultado-seguimiento-copia-2.json', JSON.stringify(resultado, null, 2));
    console.log(JSON.stringify(resultado, null, 2));
  }
} catch (e) { await client.query('rollback'); throw e; }
finally { client.release(); await pool.end(); }
