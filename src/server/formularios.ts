import express from 'express';
import type { Request, Response } from 'express';
import type pg from 'pg';
import { MAX_RESPUESTAS_LISTADO, buscarFormulario, normalizarRespuestas } from '../shared/formularios.ts';

const TABLA_FALTANTE = 'Falta crear la tabla de respuestas. Ejecuta supabase/formularios_schema.sql en Supabase.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Cualquier usuario con sesión puede registrar, editar y eliminar respuestas (decisión del usuario, 24/11/2026).
interface UsuarioSesion { sub: string; nombre: string }

export function rutasFormularios(pool: pg.Pool | null, sesion: (req: Request) => UsuarioSesion | null) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) { res.status(401).json({ error: 'Inicia sesión para abrir los formularios.' }); return; }
    if (req.method !== 'GET' && req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Abre la aplicación para guardar datos.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const fallo = (res: Response, error: unknown, accion: string, mensaje: string) => {
    if ((error as { code?: string }).code === '42P01') { res.status(503).json({ error: TABLA_FALTANTE }); return; }
    console.error(`${accion} de formularios:`, (error as Error).message);
    res.status(503).json({ error: mensaje });
  };

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
      fallo(res, error, 'Consulta', 'No se pudieron consultar las respuestas. Reintenta en un momento.');
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
      fallo(res, error, 'Guardado', 'No se pudo guardar la respuesta. Reintenta en un momento.');
    }
  });

  /** Busca la respuesta por su id. Si no existe, responde el error y devuelve null. */
  async function buscarRespuesta(req: Request, res: Response, db: pg.Pool) {
    const id = req.params.id;
    if (typeof id !== 'string' || !UUID.test(id)) { res.status(404).json({ error: 'La respuesta no existe.' }); return null; }
    const { rows } = await db.query('select id, formulario from public.formularios_respuestas where id = $1', [id]);
    const fila = rows[0] as { id: string; formulario: string } | undefined;
    if (!fila) { res.status(404).json({ error: 'La respuesta ya no existe. Actualiza la tabla.' }); return null; }
    return fila;
  }

  router.put('/respuestas/:id', async (req, res) => {
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para guardar.' }); return; }
    try {
      const fila = await buscarRespuesta(req, res, pool);
      if (!fila) return;
      const formulario = buscarFormulario(fila.formulario);
      if (!formulario) { res.status(404).json({ error: 'El formulario no existe.' }); return; }
      let respuestas;
      try { respuestas = normalizarRespuestas(formulario, req.body?.respuestas); }
      catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
      // La fecha del reporte no cambia: corregir un conteo no lo vuelve más reciente.
      const { rows } = await pool.query(
        'update public.formularios_respuestas set respuestas = $2 where id = $1 returning id, usuario_nombre, creado_en, respuestas',
        [fila.id, JSON.stringify(respuestas)],
      );
      res.json({ respuesta: rows[0] });
    } catch (error) {
      fallo(res, error, 'Edición', 'No se pudo guardar el cambio. Reintenta en un momento.');
    }
  });

  router.delete('/respuestas/:id', async (req, res) => {
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para eliminar.' }); return; }
    try {
      const fila = await buscarRespuesta(req, res, pool);
      if (!fila) return;
      await pool.query('delete from public.formularios_respuestas where id = $1', [fila.id]);
      res.status(204).end();
    } catch (error) {
      fallo(res, error, 'Eliminación', 'No se pudo eliminar la respuesta. Reintenta en un momento.');
    }
  });

  return router;
}
