import express from 'express';
import type { Request, Response } from 'express';
import type pg from 'pg';
import { gunzipSync } from 'node:zlib';
import { isoDeDia } from '../shared/t1.ts';

// Cargas de Excel de los módulos de Comando Central (Seguimiento T1, WIP y OFE). Cada archivo llega desde el navegador
// ya leído, en columnas y comprimido con gzip; aquí se valida, se guarda comprimido en public.t1_cargas y se entrega tal cual.
const TABLA_FALTANTE = 'Falta crear la tabla de cargas. Ejecuta supabase/t1_schema.sql en Supabase.';
/** Cargas que se conservan por tipo (las anteriores quedan como respaldo). */
const CONSERVAR = 5;
const LIMITE_CUERPO = '8mb';
const LIMITE_DESCOMPRIMIDO = 80 * 1024 * 1024;

interface UsuarioSesion { sub: string; nombre: string }
export interface TipoDeCarga {
  /** Devuelve el problema (para el usuario) o null si los datos sirven. */
  validar(datos: unknown): string | null;
  /** Días de Excel de cada fila, para guardar el rango de fechas de la carga. */
  dias(datos: never): number[];
}

export function rutasCargas(pool: pg.Pool | null, sesion: (req: Request) => UsuarioSesion | null, modulo: string, tipos: Record<string, TipoDeCarga>) {
  const nombres = Object.keys(tipos);
  const router = express.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) { res.status(401).json({ error: `Inicia sesión para abrir ${modulo}.` }); return; }
    if (req.method !== 'GET' && req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Abre la aplicación para guardar datos.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const fallo = (res: Response, error: unknown, accion: string, mensaje: string) => {
    if ((error as { code?: string }).code === '42P01') { res.status(503).json({ error: TABLA_FALTANTE }); return; }
    console.error(`${accion} de ${modulo}:`, (error as Error).message);
    res.status(503).json({ error: mensaje });
  };
  const tipoDe = (req: Request) => (nombres.includes(String(req.params.tipo)) ? String(req.params.tipo) : null);

  // Última carga de cada tipo guardada en memoria: descargarla de Supabase toma varios segundos y casi nunca cambia.
  // Se pide en base64 (pesa un tercio menos que el formato hexadecimal con el que llega un bytea).
  const memoria = new Map<string, { id: string; datos: Promise<Buffer> }>();
  const datosDe = (db: pg.Pool, tipo: string, id: string): Promise<Buffer> => {
    const guardado = memoria.get(tipo);
    if (guardado?.id === id) return guardado.datos;
    const datos = db.query("select encode(datos, 'base64') as datos from public.t1_cargas where id = $1", [id])
      .then(({ rows }) => { if (!rows[0]) throw new Error('La carga ya no existe.'); return Buffer.from(String(rows[0].datos).replace(/\s/g, ''), 'base64'); });
    memoria.set(tipo, { id, datos });
    datos.catch(() => { if (memoria.get(tipo)?.datos === datos) memoria.delete(tipo); });
    return datos;
  };

  /** Última carga de cada tipo del módulo (sin los datos). */
  router.get('/estado', async (_req, res) => {
    if (!pool) { res.status(503).json({ error: `Configura la conexión de Supabase para consultar ${modulo}.` }); return; }
    try {
      const { rows } = await pool.query(
        `select distinct on (tipo) id, tipo, archivo, filas, to_char(desde, 'YYYY-MM-DD') as desde, to_char(hasta, 'YYYY-MM-DD') as hasta, usuario_nombre, creado_en
         from public.t1_cargas where tipo = any($1) order by tipo, creado_en desc, id desc`, [nombres]);
      // Mientras el navegador procesa el estado, el servidor ya va trayendo los datos.
      for (const r of rows) datosDe(pool, r.tipo, String(r.id)).catch(() => undefined);
      res.json(Object.fromEntries(nombres.map(t => [t, rows.find(r => r.tipo === t) ?? null])));
    } catch (error) {
      fallo(res, error, 'Consulta', `No se pudo consultar ${modulo}. Reintenta en un momento.`);
    }
  });

  /** Datos de la última carga del tipo, comprimidos (el navegador los descomprime solo). */
  router.get('/datos/:tipo', async (req, res) => {
    const tipo = tipoDe(req);
    if (!tipo) { res.status(404).json({ error: 'Tipo de datos desconocido.' }); return; }
    if (!pool) { res.status(503).json({ error: `Configura la conexión de Supabase para consultar ${modulo}.` }); return; }
    try {
      // Primero solo cuál es la última carga (rápido); los datos (1–2 MB) se traen una vez y quedan en memoria.
      const { rows } = await pool.query('select id from public.t1_cargas where tipo = $1 order by creado_en desc, id desc limit 1', [tipo]);
      if (!rows[0]) { res.status(404).json({ error: 'Aún no se ha cargado ese archivo.' }); return; }
      const datos = await datosDe(pool, tipo, String(rows[0].id));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.send(datos);
    } catch (error) {
      fallo(res, error, 'Consulta', `No se pudieron consultar los datos de ${modulo}.`);
    }
  });

  /** Guarda una carga: cuerpo = JSON de las columnas del tipo, comprimido con gzip; cabecera x-archivo con el nombre. */
  router.post('/cargar/:tipo', express.raw({ type: 'application/octet-stream', limit: LIMITE_CUERPO }), async (req, res) => {
    const tipo = tipoDe(req);
    if (!tipo) { res.status(404).json({ error: 'Tipo de datos desconocido.' }); return; }
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para guardar.' }); return; }
    const archivo = decodeURIComponent(String(req.get('x-archivo') ?? req.get('x-t1-archivo') ?? '')).trim().slice(0, 180);
    if (!archivo || !Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({ error: 'Falta el archivo.' }); return; }
    let columnas: unknown;
    try {
      columnas = JSON.parse(gunzipSync(req.body, { maxOutputLength: LIMITE_DESCOMPRIMIDO }).toString('utf8'));
    } catch {
      res.status(400).json({ error: 'El archivo llegó dañado o es demasiado grande. Inténtalo de nuevo.' }); return;
    }
    const problema = tipos[tipo].validar(columnas);
    if (problema) { res.status(400).json({ error: problema }); return; }
    const dias = tipos[tipo].dias(columnas as never);
    let desde = Infinity, hasta = -Infinity;
    for (const d of dias) { if (d < desde) desde = d; if (d > hasta) hasta = d; }
    const usuario = sesion(req)!;
    let client: pg.PoolClient;
    try { client = await pool.connect(); }
    catch { res.status(503).json({ error: 'No se pudo conectar a Supabase. Reintenta en un momento.' }); return; }
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `insert into public.t1_cargas (tipo, archivo, filas, desde, hasta, datos, usuario_id, usuario_nombre)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, creado_en`,
        [tipo, archivo, dias.length, isoDeDia(desde), isoDeDia(hasta), req.body, usuario.sub, usuario.nombre]);
      await client.query(
        `delete from public.t1_cargas where tipo = $1 and id not in
         (select id from public.t1_cargas where tipo = $1 order by creado_en desc, id desc limit ${CONSERVAR})`, [tipo]);
      await client.query('commit');
      // Lo recién subido queda en memoria: no hace falta volver a pedirlo a Supabase.
      memoria.set(tipo, { id: String(rows[0].id), datos: Promise.resolve(req.body as Buffer) });
      res.status(201).json({ tipo, archivo, filas: dias.length, desde: isoDeDia(desde), hasta: isoDeDia(hasta), creado_en: rows[0].creado_en });
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      fallo(res, error, 'Guardado', 'No se pudo guardar el archivo. No se aplicó la carga; reintenta.');
    } finally { client.release(); }
  });

  return router;
}
