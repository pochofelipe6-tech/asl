// Corrección acotada al corte auditado del 12/11/2026; conserva el lote anterior.
import XLSX from 'xlsx';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { transformarBase } from '../src/shared/preventas-base.ts';

const archivo = process.argv[2];
if (!archivo || !process.env.SUPABASE_DB_URL) throw new Error('Indica 12KA.xlsx y configura la conexión.');
const libro = XLSX.readFile(archivo);
const { filas, excluidas } = transformarBase(XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { header: 1, defval: null }), '2026-11-12');
const total = (rows: (string | number | null)[][]) => rows.reduce((s, f) => s + Number(f[18]), 0);
if (filas.length !== 1003 || Math.abs(total(filas) - 19720.93616) > 1e-8) throw new Error('El archivo no coincide con el corte auditado.');
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
try {
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtext('preventas:guardar'))");
  const actual = (await client.query(`select l.id,l.archivo,l.usuario_id from public.preventas_lotes l
    join public.preventas_datos d on d.lote_id=l.id where d.fecha='2026-11-12'
    order by l.creado_en desc,l.id desc limit 1`)).rows[0];
  if (!actual || actual.archivo !== '12KA.xlsx') throw new Error('El corte vigente cambió; no se aplicó la corrección.');
  const anteriores = (await client.query('select valores from public.preventas_datos where lote_id=$1 and fecha=$2 order by fila', [actual.id, '2026-11-12'])).rows.map(r => r.valores);
  const serializar = (rows: (string | number | null)[][]) => rows.map(f => JSON.stringify(f)).sort();
  const iguales = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  if (iguales(serializar(anteriores), serializar(filas))) {
    await client.query('rollback');
    console.log('El corte ya está corregido; no se duplicó.');
  } else {
    const sinNuevos = filas.filter(f => !['22284', '22256'].includes(String(f[3])));
    if (actual.id !== '9ebdd259-69f7-4178-add7-6d56e2368f7b' || anteriores.length !== 1001 || !iguales(serializar(anteriores), serializar(sinNuevos))) throw new Error('Los registros actuales no coinciden exactamente con los auditados; no se aplicó ningún cambio.');
    await writeFile('datos/preventas/respaldo-corte-12-antes-correccion.json', JSON.stringify({ lote: actual, filas: anteriores }, null, 2));
    const id = randomUUID();
    await client.query('insert into public.preventas_lotes(id,archivo,usuario_id) values($1,$2,$3)', [id, actual.archivo, actual.usuario_id]);
    await client.query(`insert into public.preventas_datos(lote_id,fila,valores)
      select $1,ordinality::int,value from jsonb_array_elements($2::jsonb) with ordinality`, [id, JSON.stringify(filas)]);
    await client.query(`insert into public.preventas_so_snapshot(lote_id,fecha_excel,material,descripcion,cd,agotados_hl)
      select $1,fecha_excel,material,descripcion,cd,agotados_hl from public.preventas_so_snapshot where lote_id=$2 and fecha_excel=46338`, [id, actual.id]);
    const guardadas = (await client.query('select valores from public.preventas_datos where lote_id=$1 order by fila', [id])).rows.map(r => r.valores);
    if (!iguales(serializar(guardadas), serializar(filas))) throw new Error('La verificación del guardado falló.');
    await client.query('commit');
    const resultado = { lote: id, loteAnterior: actual.id, fecha: '2026-11-12', filas: guardadas.length, total: total(guardadas), exclusionesHistoricas: excluidas.length };
    await writeFile('datos/preventas/correccion-corte-12-resultado.json', JSON.stringify(resultado, null, 2));
    console.log(JSON.stringify(resultado, null, 2));
  }
} catch (error) {
  await client.query('rollback');
  throw error;
} finally { client.release(); await pool.end(); }
