import express from 'express';
import type { Request, Response } from 'express';
import type pg from 'pg';
import { claveChasis, revisarMontacargas } from '../shared/ofe.ts';

// Montacargas agregados o corregidos desde la página de OFE (tabla public.ofe_montacargas). Se aplican encima de la lista
// de montacargas del Power BI (src/shared/montacargas.ts): con un chasis de esa lista la corrigen; con uno nuevo, se agregan.
// Quitar un cambio deja el montacargas como estaba en la lista original (o lo saca, si era agregado).
const TABLA_FALTANTE = 'Falta crear la tabla de montacargas. Ejecuta supabase/t1_schema.sql en Supabase.';
const MAX_CAMBIOS = 1000;

interface UsuarioSesion { sub: string; nombre: string }

/** Rutas bajo /api/ofe/montacargas. La sesión y el control de origen ya los revisa el router de OFE. */
export function rutasMontacargas(pool: pg.Pool | null, sesion: (req: Request) => UsuarioSesion | null) {
  const router = express.Router();
  const fallo = (res: Response, error: unknown, mensaje: string) => {
    if ((error as { code?: string }).code === '42P01') { res.status(503).json({ error: TABLA_FALTANTE }); return; }
    console.error('Montacargas de OFE:', (error as Error).message);
    res.status(503).json({ error: mensaje });
  };
  const sinBase = (res: Response) => { res.status(503).json({ error: 'Configura la conexión de Supabase para la lista de montacargas.' }); };

  router.get('/', async (_req, res) => {
    if (!pool) { sinBase(res); return; }
    try {
      const { rows } = await pool.query(
        `select chasis, cd, placa, usuario_nombre, actualizado_en from public.ofe_montacargas order by actualizado_en desc limit ${MAX_CAMBIOS}`);
      res.json({ cambios: rows });
    } catch (error) { fallo(res, error, 'No se pudo consultar la lista de montacargas. Reintenta en un momento.'); }
  });

  router.put('/', async (req, res) => {
    if (!pool) { sinBase(res); return; }
    const revision = revisarMontacargas(req.body);
    if ('error' in revision) { res.status(400).json({ error: revision.error }); return; }
    const { chasis, cd, placa } = revision.montacargas;
    const usuario = sesion(req)!;
    try {
      const { rows } = await pool.query(
        `insert into public.ofe_montacargas (clave, chasis, cd, placa, usuario_id, usuario_nombre) values ($1, $2, $3, $4, $5, $6)
         on conflict (clave) do update set chasis = excluded.chasis, cd = excluded.cd, placa = excluded.placa,
           usuario_id = excluded.usuario_id, usuario_nombre = excluded.usuario_nombre, actualizado_en = now()
         returning chasis, cd, placa, usuario_nombre, actualizado_en`,
        [claveChasis(chasis), chasis, cd, placa, usuario.sub, usuario.nombre]);
      res.json({ cambio: rows[0] });
    } catch (error) { fallo(res, error, 'No se pudo guardar el montacargas. Reintenta en un momento.'); }
  });

  router.delete('/', async (req, res) => {
    if (!pool) { sinBase(res); return; }
    const chasis = typeof req.query.chasis === 'string' ? req.query.chasis : '';
    if (!chasis.trim() || chasis.length > 60) { res.status(400).json({ error: 'Falta el número de chasis.' }); return; }
    try {
      const { rowCount } = await pool.query('delete from public.ofe_montacargas where clave = $1', [claveChasis(chasis)]);
      if (!rowCount) { res.status(404).json({ error: 'Ese montacargas no tiene cambios guardados.' }); return; }
      res.json({ ok: true });
    } catch (error) { fallo(res, error, 'No se pudo quitar el montacargas. Reintenta en un momento.'); }
  });

  return router;
}
