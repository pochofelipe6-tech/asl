import express from 'express';
import type { Request, Response } from 'express';
import type pg from 'pg';
import { ID_SOLICITUDES, MAX_LOTE, MAX_SOLICITUDES_LISTADO, revisarSolicitud } from '../shared/solicitudes.ts';

// Las solicitudes usan la tabla genérica de formularios (una fila por solicitud, valores en jsonb),
// así el módulo no necesita una tabla nueva en Supabase.
const TABLA_FALTANTE = 'Falta crear la tabla de respuestas. Ejecuta supabase/formularios_schema.sql en Supabase.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNAS = 'id, usuario_nombre, creado_en, respuestas';

// Igual que en Control de inventarios: cualquier usuario con sesión registra, edita y elimina.
interface UsuarioSesion { sub: string; nombre: string }

export function rutasSolicitudes(pool: pg.Pool | null, sesion: (req: Request) => UsuarioSesion | null) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) { res.status(401).json({ error: 'Inicia sesión para abrir las solicitudes.' }); return; }
    if (req.method !== 'GET' && req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Abre la aplicación para guardar datos.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const fallo = (res: Response, error: unknown, accion: string, mensaje: string) => {
    if ((error as { code?: string }).code === '42P01') { res.status(503).json({ error: TABLA_FALTANTE }); return; }
    console.error(`${accion} de solicitudes:`, (error as Error).message);
    res.status(503).json({ error: mensaje });
  };

  /** Valida el cuerpo; si hay errores responde el primero y devuelve null. */
  const leer = (req: Request, res: Response) => {
    const { solicitud, errores } = revisarSolicitud(req.body?.solicitud);
    if (!solicitud) { res.status(400).json({ error: Object.values(errores)[0] ?? 'La solicitud no es válida.' }); return null; }
    return solicitud;
  };

  const idValido = (req: Request) => typeof req.params.id === 'string' && UUID.test(req.params.id);

  router.get('/', async (_req, res) => {
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para consultar las solicitudes.' }); return; }
    try {
      const { rows } = await pool.query(
        `select ${COLUMNAS} from public.formularios_respuestas
         where formulario = $1 order by creado_en desc, id desc limit ${MAX_SOLICITUDES_LISTADO + 1}`,
        [ID_SOLICITUDES],
      );
      res.json({ solicitudes: rows.slice(0, MAX_SOLICITUDES_LISTADO), truncado: rows.length > MAX_SOLICITUDES_LISTADO });
    } catch (error) {
      fallo(res, error, 'Consulta', 'No se pudieron consultar las solicitudes. Reintenta en un momento.');
    }
  });

  // El formulario guarda todos sus artículos juntos: una sola sentencia, así entran todos o ninguno.
  router.post('/', async (req, res) => {
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para guardar.' }); return; }
    const lista: unknown = req.body?.solicitudes;
    if (!Array.isArray(lista) || !lista.length || lista.length > MAX_LOTE) {
      res.status(400).json({ error: `Envía entre 1 y ${MAX_LOTE} artículos.` }); return;
    }
    const solicitudes = [];
    for (const [i, datos] of lista.entries()) {
      const { solicitud, errores } = revisarSolicitud(datos);
      if (!solicitud) { res.status(400).json({ error: `Artículo ${i + 1}: ${Object.values(errores)[0] ?? 'no es válido.'}` }); return; }
      solicitudes.push(solicitud);
    }
    const usuario = sesion(req)!;
    try {
      const { rows } = await pool.query(
        `insert into public.formularios_respuestas (formulario, respuestas, usuario_id, usuario_nombre)
         select $1, x.valor, $3, $4 from jsonb_array_elements($2::jsonb) with ordinality as x(valor, n)
         order by x.n returning ${COLUMNAS}`,
        [ID_SOLICITUDES, JSON.stringify(solicitudes), usuario.sub, usuario.nombre],
      );
      res.status(201).json({ solicitudes: rows });
    } catch (error) {
      fallo(res, error, 'Guardado', 'No se pudo guardar la solicitud. Reintenta en un momento.');
    }
  });

  router.put('/:id', async (req, res) => {
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para guardar.' }); return; }
    if (!idValido(req)) { res.status(404).json({ error: 'La solicitud no existe.' }); return; }
    const solicitud = leer(req, res);
    if (!solicitud) return;
    try {
      // La fecha de la solicitud no cambia al corregirla.
      const { rows } = await pool.query(
        `update public.formularios_respuestas set respuestas = $3
         where id = $1 and formulario = $2 returning ${COLUMNAS}`,
        [req.params.id, ID_SOLICITUDES, JSON.stringify(solicitud)],
      );
      if (!rows[0]) { res.status(404).json({ error: 'La solicitud ya no existe. Actualiza la tabla.' }); return; }
      res.json({ solicitud: rows[0] });
    } catch (error) {
      fallo(res, error, 'Edición', 'No se pudo guardar el cambio. Reintenta en un momento.');
    }
  });

  router.delete('/:id', async (req, res) => {
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para eliminar.' }); return; }
    if (!idValido(req)) { res.status(404).json({ error: 'La solicitud no existe.' }); return; }
    try {
      const { rowCount } = await pool.query('delete from public.formularios_respuestas where id = $1 and formulario = $2', [req.params.id, ID_SOLICITUDES]);
      if (!rowCount) { res.status(404).json({ error: 'La solicitud ya no existe. Actualiza la tabla.' }); return; }
      res.status(204).end();
    } catch (error) {
      fallo(res, error, 'Eliminación', 'No se pudo eliminar la solicitud. Reintenta en un momento.');
    }
  });

  return router;
}
