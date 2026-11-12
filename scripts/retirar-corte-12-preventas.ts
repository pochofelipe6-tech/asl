// Retira el día solicitado para una nueva carga, con respaldo y verificación.
import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

if (!process.env.SUPABASE_DB_URL) throw new Error('Falta conexión.');
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
const client = await pool.connect();
const hash = (r: unknown) => createHash('sha256').update(JSON.stringify(r)).digest('hex');
try {
  await client.query('begin');
  await client.query("select pg_advisory_xact_lock(hashtext('preventas:guardar'))");
  const ultimo = (await client.query('select id from public.preventas_lotes order by creado_en desc,id desc limit 1')).rows[0];
  if (ultimo?.id !== '28320023-8d0f-4e6f-b65c-eebbc186a9b8') throw new Error('El último lote cambió; se canceló el retiro.');
  const datos = (await client.query("select * from public.preventas_datos where fecha='2026-11-12' order by lote_id,fila")).rows;
  const ids = [...new Set(datos.map(r => r.lote_id))];
  const lotes = (await client.query('select * from public.preventas_lotes where id=any($1::uuid[]) order by id', [ids])).rows;
  const otros = (await client.query("select * from public.preventas_datos where fecha<>'2026-11-12' order by lote_id,fila")).rows;
  const so = (await client.query('select * from public.preventas_so_snapshot order by lote_id,fecha_excel,material,cd')).rows;
  await writeFile('datos/preventas/respaldo-retiro-corte-12.json', JSON.stringify({ fecha: '2026-11-12', lotes, datos, otrosHash: hash(otros), soHash: hash(so) }, null, 2));
  const borrado = await client.query("delete from public.preventas_datos where fecha='2026-11-12'");
  // Conserva lotes que aún respaldan datos de otros días o el histórico SO.
  await client.query(`delete from public.preventas_lotes l where id=any($1::uuid[])
    and not exists(select 1 from public.preventas_datos d where d.lote_id=l.id)
    and not exists(select 1 from public.preventas_so_snapshot s where s.lote_id=l.id)`, [ids]);
  const despues = (await client.query('select * from public.preventas_datos order by lote_id,fila')).rows;
  const soDespues = (await client.query('select * from public.preventas_so_snapshot order by lote_id,fecha_excel,material,cd')).rows;
  if (hash(otros) !== hash(despues) || hash(so) !== hash(soDespues)) throw new Error('Falló la verificación de los datos conservados.');
  await client.query('commit');
  console.log(JSON.stringify({ fechaRetirada: '2026-11-12', versionesRetiradas: ids.length, filasRetiradas: borrado.rowCount, otrosRegistrosConservados: otros.length, soConservado: true }));
} catch (error) { await client.query('rollback'); throw error; }
finally { client.release(); await pool.end(); }
