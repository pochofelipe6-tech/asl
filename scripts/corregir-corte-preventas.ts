// Reimporta el corte conciliado sin borrar el lote anterior.
import XLSX from 'xlsx';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { transformarBase } from '../src/shared/preventas-base.ts';

const archivo = process.argv[2];
if (!archivo) throw new Error('Indica la ruta de 10KA.xlsx.');
const libro = XLSX.readFile(archivo);
const { filas } = transformarBase(XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { header: 1, defval: null }), '2026-11-11');
const total = filas.reduce((s, f) => s + Number(f[18]), 0);
if (filas.length !== 1002 || Math.abs(total - 22005.5441) > .000001) throw new Error('El archivo no corresponde al corte conciliado.');
if (!process.env.SUPABASE_DB_URL) throw new Error('Falta SUPABASE_DB_URL.');
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
try {
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtext('preventas:guardar'))");
  const actual = (await client.query('select id,archivo,usuario_id from public.preventas_lotes order by creado_en desc,id desc limit 1')).rows[0];
  const anteriores = (await client.query('select valores from public.preventas_datos where lote_id=$1 order by fila', [actual?.id])).rows.map(r => r.valores);
  if (actual?.archivo !== '10KA.xlsx') throw new Error('El último corte cambió; no se aplicó la corrección.');
  if (anteriores.length === filas.length && anteriores.every((f, i) => JSON.stringify(f) === JSON.stringify(filas[i]))) {
    await client.query('rollback');
    console.log('El corte ya está corregido.');
  } else {
    if (anteriores.length !== 997 || anteriores.some(f => f[0] !== 46337) || Math.abs(anteriores.reduce((s, f) => s + Number(f[18]), 0) - 22306.77798) > .000001) throw new Error('El corte guardado no coincide con el corte que se debe corregir.');
    const id = randomUUID();
    await client.query('insert into public.preventas_lotes(id,archivo,usuario_id) values($1,$2,$3)', [id, actual.archivo, actual.usuario_id]);
    await client.query('insert into public.preventas_datos(lote_id,fila,valores) select $1,ordinality::int,value from jsonb_array_elements($2::jsonb) with ordinality', [id, JSON.stringify(filas)]);
    await client.query('insert into public.preventas_so_snapshot(lote_id,fecha_excel,material,descripcion,cd,agotados_hl) select $1,fecha_excel,material,descripcion,cd,agotados_hl from public.preventas_so_snapshot where lote_id=$2', [id, actual.id]);
    await client.query('commit');
    console.log(JSON.stringify({ lote: id, loteAnterior: actual.id, filas: filas.length, total }));
  }
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
