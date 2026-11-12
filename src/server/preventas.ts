import express from 'express';
import type { Request } from 'express';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MAX_PREVENTAS, normalizarPreventa } from '../shared/preventas.ts';

export function rutasPreventas(pool: pg.Pool | null, sesion: (req: Request) => { sub: string } | null) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) { res.status(401).json({ error: 'Inicia sesión para abrir Preventas.' }); return; }
    if (req.method !== 'GET' && req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Abre la aplicación para guardar datos.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get('/datos', async (_req, res) => {
    try {
      if (pool) {
        const lote = (await pool.query('select id,archivo,creado_en from public.preventas_lotes order by creado_en desc,id desc limit 1')).rows[0];
        if (lote) {
          // Un único lote por fecha: una nueva importación sustituye el día completo.
          // Los lotes anteriores se conservan como respaldo y nunca se suman.
          const result = await pool.query(`with cortes as (
            select distinct on (d.fecha) d.fecha,d.lote_id
            from public.preventas_datos d join public.preventas_lotes l on l.id=d.lote_id
            order by d.fecha,l.creado_en desc,l.id desc
          ) select row_number() over(order by d.fecha,d.fila)::int as fila,d.valores
            from public.preventas_datos d join cortes c on c.fecha=d.fecha and c.lote_id=d.lote_id
            order by d.fecha,d.fila`);
          const snapshot = (await pool.query(`with cortes as (
            select distinct on (s.fecha_excel) s.fecha_excel,s.lote_id
            from public.preventas_so_snapshot s join public.preventas_lotes l on l.id=s.lote_id
            order by s.fecha_excel,l.creado_en desc,l.id desc
          ) select s.fecha_excel as fecha,s.material,s.descripcion,s.cd,s.agotados_hl::float8 as agotados
            from public.preventas_so_snapshot s join cortes c on c.fecha_excel=s.fecha_excel and c.lote_id=s.lote_id`)).rows;
          res.json({ lote, filas: result.rows.map(r => ({ id: r.fila, valores: r.valores })), snapshot, persistido: true }); return;
        }
      }
    } catch (error) {
      if ((error as { code?: string }).code !== '42P01') { console.error('Consulta Preventas:', (error as Error).message); res.status(503).json({ error: 'No se pudo consultar Preventas. Reintenta en un momento.' }); return; }
    }
    // Vista inicial protegida mientras se ejecuta el SQL; nunca simula un guardado.
    const inicial = JSON.parse(await readFile('datos/preventas/inicial.json', 'utf8'));
    res.json({ lote: { id: null, archivo: inicial.archivo }, filas: inicial.filas.map((valores: unknown, i: number) => ({ id: i + 1, valores })), snapshot: inicial.snapshot, persistido: false });
  });
  router.post('/guardar', async (req, res) => {
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para guardar.' }); return; }
    const { archivo, filas, modo, loteBase, snapshot = [] } = req.body ?? {};
    if (!['importar', 'agregar'].includes(modo) || !Array.isArray(filas) || !filas.length || filas.length > MAX_PREVENTAS || (modo === 'agregar' && filas.length !== 1) || typeof archivo !== 'string' || archivo.length > 180) {
      res.status(400).json({ error: 'La carga no es válida. Máximo 10.000 registros por archivo.' }); return;
    }
    let datos;
    try { datos = filas.map((f: unknown, i: number) => normalizarPreventa(f, i + 2)); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    if (!Array.isArray(snapshot) || snapshot.length > 20000 || snapshot.some(s => !s || !Number.isInteger(s.fecha) || s.fecha < 1 || s.fecha > 2958465 || !['material', 'descripcion', 'cd'].every(k => typeof s[k] === 'string' && s[k].length > 0 && s[k].length < 500) || !Number.isFinite(s.agotados) || s.agotados < 0 || s.agotados > 1e12)) {
      res.status(400).json({ error: 'El corte histórico de SO contiene datos no válidos.' }); return;
    }
    let client: pg.PoolClient;
    try { client = await pool.connect(); }
    catch { res.status(503).json({ error: 'No se pudo conectar a Supabase. Reintenta en un momento.' }); return; }
    try {
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('preventas:guardar'))");
      const actual = (await client.query('select id from public.preventas_lotes order by creado_en desc,id desc limit 1')).rows[0]?.id ?? null;
      if (!actual && modo === 'agregar') { await client.query('rollback'); res.status(409).json({ error: 'Carga primero los datos iniciales en Supabase o importa un Excel completo.' }); return; }
      if (actual !== loteBase) { await client.query('rollback'); res.status(409).json({ error: 'Los datos cambiaron. Recarga antes de guardar.' }); return; }
      let lote = actual;
      if (modo === 'agregar') {
        // El ingreso manual se añade al corte de su propia fecha.
        lote = (await client.query(`select d.lote_id from public.preventas_datos d
          join public.preventas_lotes l on l.id=d.lote_id where d.valores->>0=$1
          order by l.creado_en desc,l.id desc limit 1`, [String(datos[0][0])])).rows[0]?.lote_id ?? null;
      }
      if (modo === 'importar' || !lote) {
        lote = randomUUID();
        await client.query('insert into public.preventas_lotes(id,archivo,usuario_id) values($1,$2,$3)', [lote, archivo, sesion(req)!.sub]);
      }
      const max = (await client.query('select coalesce(max(fila),0)::int as n from public.preventas_datos where lote_id=$1', [lote])).rows[0].n;
      if (max + datos.length > MAX_PREVENTAS) throw new Error('El corte supera los 10.000 registros. Importa un nuevo corte.');
      for (let i = 0; i < datos.length; i += 500) {
        await client.query('insert into public.preventas_datos(lote_id,fila,valores) select $1,$2+ordinality::int,value from jsonb_array_elements($3::jsonb) with ordinality', [lote, max + i, JSON.stringify(datos.slice(i, i + 500))]);
      }
      if (modo === 'importar' && snapshot.length) {
        await client.query(`insert into public.preventas_so_snapshot(lote_id,fecha_excel,material,descripcion,cd,agotados_hl)
          select $1,fecha,material,descripcion,cd,agotados from jsonb_to_recordset($2::jsonb)
          as x(fecha integer,material text,descripcion text,cd text,agotados numeric)`, [lote, JSON.stringify(snapshot)]);
      }
      await client.query('commit');
      res.json({ lote, guardadas: datos.length });
    } catch (error) {
      await client.query('rollback');
      const falta = (error as { code?: string }).code === '42P01';
      console.error('Guardado Preventas:', (error as Error).message);
      res.status(503).json({ error: falta ? 'Ejecuta preventas_schema.sql y preventas_datos_iniciales.sql en Supabase antes de guardar.' : 'No se pudieron guardar los datos. No se aplicó la carga; reintenta.' });
    } finally { client.release(); }
  });
  return router;
}
