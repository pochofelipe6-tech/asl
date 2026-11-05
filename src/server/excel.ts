import express from 'express';
import type { Request } from 'express';
import type pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { COLUMNAS_EXCEL, MAX_FILAS, MAX_FILAS_BLOQUE, normalizarFila, validarColumnas } from '../shared/excel.ts';

type SesionExcel = { sub: string };
type Importacion = { id: string; usuario_id: string; archivo: string; filas: number; recibidas: number; ultima_fila: number; ultimo_offset: number | null; ultimo_hash: string | null; lote_base: string | null; lote_id: string | null; estado: string; vencida: boolean };
class ErrorCarga extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function rutasExcel(pool: pg.Pool | null, sesion: (req: Request) => SesionExcel | null, alImportar: () => void) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!sesion(req)) { res.status(401).json({ error: 'Inicia sesión para gestionar el Excel.' }); return; }
    if (!pool) { res.status(503).json({ error: 'Falta configurar la conexión a la base de datos.' }); return; }
    if (!['GET', 'HEAD'].includes(req.method) && req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Abre la aplicación para realizar esta operación.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  async function bloquear(client: pg.PoolClient, id: string, usuario: string): Promise<Importacion> {
    if (!uuid.test(id)) throw new ErrorCarga(400, 'La carga no es válida.');
    const result = await client.query<Importacion>(`select *, creado_en < now() - interval '24 hours' as vencida from frescura_importaciones where id=$1 and usuario_id=$2 for update`, [id, usuario]);
    const carga = result.rows[0];
    if (!carga) throw new ErrorCarga(404, 'No se encontró esta carga.');
    if (carga.vencida && carga.estado === 'pendiente') throw new ErrorCarga(410, 'La carga venció. Selecciona el archivo de nuevo.');
    return carga;
  }
  async function transaccion<T>(accion: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool!.connect();
    try { await client.query('begin'); const result = await accion(client); await client.query('commit'); return result; }
    catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); }
  }

  router.get('/archivo', async (_req, res) => {
    const result = await pool!.query('select id, archivo, filas, cargado_en from frescura_consolidado_lotes order by cargado_en desc limit 1');
    if (!result.rows.length) throw new ErrorCarga(404, 'Todavía no hay un Excel cargado.');
    res.json({ ...result.rows[0], columnas: COLUMNAS_EXCEL });
  });

  router.get('/datos', async (req, res) => {
    const { lote, despues = '1' } = req.query;
    if (typeof lote !== 'string' || lote.length > 200 || typeof despues !== 'string' || !/^\d{1,7}$/.test(despues)) throw new ErrorCarga(400, 'La descarga solicitada no es válida.');
    const existe = await pool!.query('select id from frescura_consolidado_lotes where id=$1', [lote]);
    if (!existe.rows.length) throw new ErrorCarga(404, 'No se encontró el archivo solicitado.');
    const result = await pool!.query('select fila_excel, valores from frescura_consolidado where lote_id=$1 and fila_excel>$2 order by fila_excel limit 2001', [lote, Number(despues)]);
    const filas: { fila_excel: number; valores: unknown[] }[] = [];
    let bytes = 0;
    for (const fila of result.rows.slice(0, 2000)) {
      const tamano = Buffer.byteLength(JSON.stringify(fila));
      if (filas.length && bytes + tamano > 1000000) break;
      filas.push(fila); bytes += tamano;
    }
    res.json({ filas, siguiente: result.rows.length > filas.length ? filas.at(-1)!.fila_excel : null });
  });

  router.post('/importaciones', async (req, res) => {
    const { archivo, filas, columnas } = req.body ?? {};
    if (typeof archivo !== 'string' || archivo.length > 180 || !/\.(xlsx|xlsb)$/i.test(archivo) || /[\/\\\x00-\x1f]/.test(archivo)) throw new ErrorCarga(400, 'Selecciona un archivo .xlsx o .xlsb válido.');
    if (!Number.isSafeInteger(filas) || filas < 1 || filas > MAX_FILAS) throw new ErrorCarga(400, `El archivo debe contener entre 1 y ${MAX_FILAS} filas.`);
    try { validarColumnas(columnas); } catch (error) { throw new ErrorCarga(400, (error as Error).message); }
    const usuario = sesion(req)!.sub;
    const id = randomUUID();
    await transaccion(async client => {
      // Serializa las aperturas por usuario; las cargas abandonadas expiran.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', ['excel:' + usuario]);
      await client.query(`delete from frescura_importaciones where estado <> 'completa' and creado_en < now() - interval '24 hours'`);
      const activas = await client.query(`select count(*)::int as n from frescura_importaciones where usuario_id=$1 and estado='pendiente'`, [usuario]);
      if (activas.rows[0].n >= 3) throw new ErrorCarga(409, 'Ya tienes tres cargas pendientes. Cancela una antes de continuar.');
      const actual = await client.query('select id from frescura_consolidado_lotes order by cargado_en desc limit 1');
      await client.query('insert into frescura_importaciones(id,usuario_id,archivo,filas,lote_base) values($1,$2,$3,$4,$5)', [id, usuario, archivo, filas, actual.rows[0]?.id ?? null]);
    });
    res.status(201).json({ id, recibidas: 0 });
  });

  router.put('/importaciones/:id/filas', async (req, res) => {
    const { offset, filas } = req.body ?? {};
    if (!Number.isSafeInteger(offset) || offset < 0 || !Array.isArray(filas) || !filas.length || filas.length > MAX_FILAS_BLOQUE) throw new ErrorCarga(400, 'El bloque de filas no es válido.');
    let anterior = 1;
    const normalizadas = filas.map((fila: { fila_excel?: unknown; valores?: unknown }) => {
      if (!fila || !Number.isSafeInteger(fila.fila_excel) || Number(fila.fila_excel) <= anterior || Number(fila.fila_excel) > 1048576) throw new ErrorCarga(400, 'Las filas deben conservar su orden en Excel.');
      anterior = Number(fila.fila_excel);
      try { return { fila_excel: anterior, valores: normalizarFila(fila.valores, anterior) }; }
      catch (error) { throw new ErrorCarga(400, (error as Error).message); }
    });
    const hash = createHash('sha256').update(JSON.stringify(normalizadas)).digest('hex');
    const recibidas = await transaccion(async client => {
      const carga = await bloquear(client, String(req.params.id), sesion(req)!.sub);
      if (carga.estado !== 'pendiente') throw new ErrorCarga(409, 'Esta carga ya no admite filas.');
      if (carga.ultimo_offset === offset && carga.ultimo_hash === hash) return carga.recibidas;
      if (offset !== carga.recibidas || offset + filas.length > carga.filas || normalizadas[0].fila_excel <= carga.ultima_fila) throw new ErrorCarga(409, 'Las filas recibidas no coinciden con el progreso de la carga.');
      await client.query(`insert into frescura_importacion_filas(importacion_id,posicion,fila_excel,valores)
        select $1, $2 + (ordinalidad - 1)::int, (fila->>'fila_excel')::int, fila->'valores'
        from jsonb_array_elements($3::jsonb) with ordinality as t(fila,ordinalidad)`, [carga.id, offset, JSON.stringify(normalizadas)]);
      const total = offset + filas.length;
      await client.query('update frescura_importaciones set recibidas=$2,ultima_fila=$3,ultimo_offset=$4,ultimo_hash=$5 where id=$1', [carga.id, total, anterior, offset, hash]);
      return total;
    });
    res.json({ recibidas });
  });

  router.get('/importaciones/:id', async (req, res) => {
    const carga = await transaccion(client => bloquear(client, String(req.params.id), sesion(req)!.sub));
    res.json({ estado: carga.estado, recibidas: carga.recibidas, filas: carga.filas, lote: carga.lote_id });
  });

  router.post('/importaciones/:id/finalizar', async (req, res) => {
    const resultado = await transaccion(async client => {
      const carga = await bloquear(client, String(req.params.id), sesion(req)!.sub);
      if (carga.estado === 'completa') return { lote: carga.lote_id, filas: carga.filas };
      if (carga.estado !== 'pendiente' || carga.recibidas !== carga.filas) throw new ErrorCarga(409, 'La carga no está completa. El informe anterior sigue activo.');
      const conteo = await client.query('select count(*)::int as n from frescura_importacion_filas where importacion_id=$1', [carga.id]);
      if (conteo.rows[0].n !== carga.filas) throw new ErrorCarga(409, 'No coinciden las filas recibidas. El informe anterior sigue activo.');
      await client.query("select pg_advisory_xact_lock(hashtext('excel:activar-lote'))");
      const actual = await client.query('select id from frescura_consolidado_lotes order by cargado_en desc limit 1');
      if ((actual.rows[0]?.id ?? null) !== carga.lote_base) throw new ErrorCarga(409, 'Otra carga actualizó el informe. Revisa el informe actual antes de volver a importar.');
      const lote = 'web-' + carga.id;
      await client.query('insert into frescura_consolidado_lotes(id,archivo,filas,cargado_en) values($1,$2,$3,clock_timestamp())', [lote, carga.archivo, carga.filas]);
      await client.query('insert into frescura_consolidado(lote_id,fila_excel,valores) select $1,fila_excel,valores from frescura_importacion_filas where importacion_id=$2 order by posicion', [lote, carga.id]);
      await client.query("update frescura_importaciones set estado='completa',lote_id=$2 where id=$1", [carga.id, lote]);
      await client.query('delete from frescura_importacion_filas where importacion_id=$1', [carga.id]);
      return { lote, filas: carga.filas };
    });
    alImportar();
    res.json(resultado);
  });

  router.delete('/importaciones/:id', async (req, res) => {
    await transaccion(async client => {
      const carga = await bloquear(client, String(req.params.id), sesion(req)!.sub);
      if (carga.estado === 'completa') throw new ErrorCarga(409, 'El archivo ya se importó.');
      await client.query("update frescura_importaciones set estado='cancelada' where id=$1", [carga.id]);
      await client.query('delete from frescura_importacion_filas where importacion_id=$1', [carga.id]);
    });
    res.status(204).end();
  });

  router.use((error: unknown, _req: Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ErrorCarga) { res.status(error.status).json({ error: error.message }); return; }
    console.error('Error gestionando Excel:', error instanceof Error ? error.message : 'error desconocido');
    res.status(500).json({ error: 'No se pudo completar la operación con el Excel. Inténtalo de nuevo.' });
  });
  return router;
}
