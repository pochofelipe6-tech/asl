import express from 'express';
import type { Request } from 'express';
import type pg from 'pg';
import { MAX_RESPUESTAS_LISTADO, buscarFormulario, normalizarRespuestas } from '../shared/formularios.ts';

const TABLA_FALTANTE = 'Falta crear la tabla de respuestas. Ejecuta supabase/formularios_schema.sql en Supabase.';

export function rutasFormularios(pool: pg.Pool | null, sesion: (req: Request) => { sub: string; nombre: string } | null) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) { res.status(401).json({ error: 'Inicia sesión para abrir los formularios.' }); return; }
    if (req.method !== 'GET' && req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Abre la aplicación para guardar datos.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.get('/respuestas', async (req, res) => {
    const formulario = buscarFormulario(req.query.formulario);
    if (!formulario) { res.status(404).json({ error: 'El formulario no existe.' }); return; }
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para consultar las respuestas.' }); return; }
    try {
      const { rows } = await pool.query(
        `select id, usuario_nombre, creado_en, respuestas from public.formularios_respuestas
         where formulario = $1 order by creado_en desc, id desc limit ${MAX_RESPUESTAS_LISTADO + 1}`,
        [formulario.id],
      );
      res.json({ respuestas: rows.slice(0, MAX_RESPUESTAS_LISTADO), truncado: rows.length > MAX_RESPUESTAS_LISTADO });
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') { res.status(503).json({ error: TABLA_FALTANTE }); return; }
      console.error('Consulta de formularios:', (error as Error).message);
      res.status(503).json({ error: 'No se pudieron consultar las respuestas. Reintenta en un momento.' });
    }
  });

  router.post('/respuestas', async (req, res) => {
    const formulario = buscarFormulario(req.body?.formulario);
    if (!formulario) { res.status(404).json({ error: 'El formulario no existe.' }); return; }
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para guardar.' }); return; }
    let respuestas;
    try { respuestas = normalizarRespuestas(formulario, req.body?.respuestas); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    const usuario = sesion(req)!;
    try {
      const { rows } = await pool.query(
        `insert into public.formularios_respuestas (formulario, respuestas, usuario_id, usuario_nombre)
         values ($1, $2, $3, $4) returning id, usuario_nombre, creado_en, respuestas`,
        [formulario.id, JSON.stringify(respuestas), usuario.sub, usuario.nombre],
      );
      res.status(201).json({ respuesta: rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') { res.status(503).json({ error: TABLA_FALTANTE }); return; }
      console.error('Guardado de formularios:', (error as Error).message);
      res.status(503).json({ error: 'No se pudo guardar la respuesta. Reintenta en un momento.' });
    }
  });

  return router;
}
