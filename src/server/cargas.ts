import express from 'express';
import type { Request, Response } from 'express';
import type pg from 'pg';
import { gunzipSync, gzipSync } from 'node:zlib';
import { isoDeDia } from '../shared/t1.ts';

// Cargas de Excel de los módulos de Comando Central (Seguimiento T1, WIP y OFE). Cada archivo llega desde el navegador
// ya leído, en columnas y comprimido con gzip.
// - Cada archivo se guarda tal cual en public.t1_cargas y NUNCA se borra (es el historial de lo que se subió).
// - Los datos que ve la página salen de public.t1_consolidado: todas las cargas juntas, día por día. Cada archivo
//   llena las fechas que trae; si una fecha ya estaba, queda la del archivo más nuevo (sin duplicar) y las demás
//   fechas se conservan. Así se puede subir un histórico y después un archivo por día.
const TABLA_FALTANTE = 'Falta crear la tabla de cargas. Ejecuta supabase/t1_schema.sql en Supabase.';
const LIMITE_CUERPO = '8mb';
const LIMITE_DESCOMPRIMIDO = 80 * 1024 * 1024;
/** Lo juntado de todas las cargas puede pesar más que un archivo suelto. */
const LIMITE_CONSOLIDADO = 400 * 1024 * 1024;

interface UsuarioSesion { sub: string; nombre: string }
type Columnas = Record<string, unknown>;
type Consulta = Pick<pg.PoolClient, 'query'>;

/** Cómo están armadas las columnas de un tipo, para juntar cargas fila por fila. */
export interface Esquema {
  /** Columnas con un valor por fila. */
  filas: readonly string[];
  /** Columnas que son una lista de columnas, cada una con un valor por fila (los estados de WIP). */
  grupos?: readonly string[];
  /** Columna con índices → lista de valores a la que apuntan (p. ej. placa → placas). */
  indices?: Readonly<Record<string, string>>;
}

export interface TipoDeCarga {
  /** Devuelve el problema (para el usuario) o null si los datos sirven. */
  validar(datos: unknown): string | null;
  /** Día de Excel de cada fila: con él se reemplazan las fechas de una carga nueva y se guarda el rango. */
  dias(datos: never): number[];
  esquema: Esquema;
}

/**
 * Junta dos cargas del mismo tipo: de "base" quedan las filas de los días que "nuevo" no trae; de "nuevo", todas.
 * El resultado va ordenado por día (dentro de un día, en el orden en que venían) y con sus listas de valores rehechas.
 */
export function combinarColumnas(esquema: Esquema, base: Columnas, diasBase: readonly number[], nuevo: Columnas, diasNuevo: readonly number[]): Columnas {
  const grupos = esquema.grupos ?? [];
  const indices = esquema.indices ?? {};
  const conocidas = new Set(['tipo', 'version', ...esquema.filas, ...grupos, ...Object.keys(indices), ...Object.values(indices)]);
  for (const d of [base, nuevo]) {
    const extra = Object.keys(d).find(k => !conocidas.has(k));
    // Una columna que el esquema no conoce se perdería al juntar: mejor no guardar nada.
    if (extra) throw new Error(`La columna ${extra} no está en el esquema de la carga.`);
  }
  const fuentes = [base, nuevo];
  const reemplazados = new Set(diasNuevo);
  const elegidas: [fuente: number, fila: number, dia: number][] = [];
  diasBase.forEach((d, i) => { if (!reemplazados.has(d)) elegidas.push([0, i, d]); });
  diasNuevo.forEach((d, i) => elegidas.push([1, i, d]));
  elegidas.sort((a, b) => a[2] - b[2]); // sort estable: dentro de un día se conserva el orden
  const columna = (f: number, k: string) => fuentes[f][k] as unknown[];
  const salida: Columnas = { tipo: nuevo.tipo, version: nuevo.version };
  for (const k of esquema.filas) salida[k] = elegidas.map(([f, i]) => columna(f, k)[i]);
  for (const g of grupos) {
    const partes = (fuentes[1][g] as unknown[][]).length;
    salida[g] = Array.from({ length: partes }, (_, p) => elegidas.map(([f, i]) => (fuentes[f][g] as unknown[][])[p][i]));
  }
  for (const [col, lista] of Object.entries(indices)) {
    const valores: unknown[] = [];
    const posicion = new Map<unknown, number>();
    salida[col] = elegidas.map(([f, i]) => {
      const v = (fuentes[f][lista] as unknown[])[columna(f, col)[i] as number];
      let p = posicion.get(v);
      if (p === undefined) { p = valores.length; valores.push(v); posicion.set(v, p); }
      return p;
    });
    salida[lista] = valores;
  }
  return salida;
}

const leer = (gz: Buffer, limite: number): Columnas => JSON.parse(gunzipSync(gz, { maxOutputLength: limite }).toString('utf8'));
const deBase64 = (texto: unknown) => Buffer.from(String(texto).replace(/\s/g, ''), 'base64');

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

  // La tabla de lo juntado se crea sola la primera vez (así no hay que ejecutar nada en Supabase para empezar).
  let tablaLista: Promise<void> | null = null;
  const crearTabla = (db: pg.Pool) => (tablaLista ??= (async () => {
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', ['t1_consolidado:crear']);
      await client.query(`create table if not exists public.t1_consolidado (
        tipo text primary key, carga_id uuid not null, filas integer not null, desde date, hasta date,
        datos bytea not null, actualizado_en timestamptz not null default now())`);
      await client.query('alter table public.t1_consolidado enable row level security');
      await client.query('revoke all on public.t1_consolidado from anon, authenticated');
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      tablaLista = null;
      throw error;
    } finally { client.release(); }
  })());
  /** Corre "accion"; si falta la tabla de lo juntado, la crea y vuelve a intentar una vez. */
  const conTabla = async <T>(db: pg.Pool, accion: () => Promise<T>): Promise<T> => {
    try { return await accion(); } catch (error) {
      const e = error as { code?: string; message?: string };
      if (e.code !== '42P01' || !String(e.message).includes('t1_consolidado')) throw error;
      await crearTabla(db);
      return accion();
    }
  };

  // Lo juntado de cada tipo, guardado en memoria: descargarlo de Supabase toma varios segundos y casi nunca cambia.
  // Se pide en base64 (pesa un tercio menos que el formato hexadecimal con el que llega un bytea).
  const memoria = new Map<string, { id: string; datos: Promise<Buffer> }>();
  const datosDe = (db: Consulta, tipo: string, id: string): Promise<Buffer> => {
    const guardado = memoria.get(tipo);
    if (guardado?.id === id) return guardado.datos;
    const datos = db.query("select encode(datos, 'base64') as datos from public.t1_consolidado where tipo = $1 and carga_id = $2", [tipo, id])
      .then(({ rows }) => { if (!rows[0]) throw new Error('Los datos cambiaron mientras se consultaban.'); return deBase64(rows[0].datos); });
    memoria.set(tipo, { id, datos });
    datos.catch(() => { if (memoria.get(tipo)?.datos === datos) memoria.delete(tipo); });
    return datos;
  };

  /** Guarda lo juntado de un tipo (reemplaza lo anterior: siempre se puede rehacer con las cargas guardadas). */
  const guardarJuntado = async (db: Consulta, tipo: string, cargaId: string, columnas: Columnas) => {
    const dias = tipos[tipo].dias(columnas as never);
    let desde = Infinity, hasta = -Infinity;
    for (const d of dias) { if (d < desde) desde = d; if (d > hasta) hasta = d; }
    const gz = gzipSync(JSON.stringify(columnas));
    await db.query(
      `insert into public.t1_consolidado (tipo, carga_id, filas, desde, hasta, datos) values ($1, $2, $3, $4, $5, $6)
       on conflict (tipo) do update set carga_id = excluded.carga_id, filas = excluded.filas, desde = excluded.desde,
         hasta = excluded.hasta, datos = excluded.datos, actualizado_en = now()`,
      [tipo, cargaId, dias.length, dias.length ? isoDeDia(desde) : null, dias.length ? isoDeDia(hasta) : null, gz]);
    return { gz, filas: dias.length, desde: dias.length ? isoDeDia(desde) : null, hasta: dias.length ? isoDeDia(hasta) : null };
  };

  /** Junta todas las cargas guardadas de un tipo, de la más vieja a la más nueva (cada una manda en sus fechas). */
  const juntarTodo = async (db: Consulta, tipo: string): Promise<{ id: string; columnas: Columnas } | null> => {
    const { rows } = await db.query('select id from public.t1_cargas where tipo = $1 order by creado_en, id', [tipo]);
    let actual: { id: string; columnas: Columnas } | null = null;
    for (const { id } of rows) {
      const fila = (await db.query("select encode(datos, 'base64') as datos from public.t1_cargas where id = $1", [id])).rows[0];
      if (!fila) continue;
      const nuevo = leer(deBase64(fila.datos), LIMITE_DESCOMPRIMIDO);
      const columnas: Columnas = actual
        ? combinarColumnas(tipos[tipo].esquema, actual.columnas, tipos[tipo].dias(actual.columnas as never), nuevo, tipos[tipo].dias(nuevo as never))
        : nuevo;
      actual = { id: String(id), columnas };
    }
    return actual;
  };

  /** Arma lo juntado de los tipos que tienen cargas pero aún no lo tienen (la primera vez, con las cargas que ya había). */
  const completarJuntados = async (db: pg.Pool, faltan: string[]) => {
    if (!faltan.length) return;
    const { rows } = await db.query('select distinct tipo from public.t1_cargas where tipo = any($1)', [faltan]);
    for (const { tipo } of rows) {
      const client = await db.connect();
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [`t1_cargas:${tipo}`]);
        const ya = await client.query('select carga_id from public.t1_consolidado where tipo = $1', [tipo]);
        if (!ya.rows[0]) {
          const todo = await juntarTodo(client, tipo);
          if (todo) {
            const { gz } = await guardarJuntado(client, tipo, todo.id, todo.columnas);
            memoria.set(tipo, { id: todo.id, datos: Promise.resolve(gz) });
          }
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally { client.release(); }
    }
  };

  const ESTADO = `select c.tipo, c.carga_id as id, c.filas, to_char(c.desde, 'YYYY-MM-DD') as desde, to_char(c.hasta, 'YYYY-MM-DD') as hasta,
      l.archivo, l.usuario_nombre, l.creado_en, (select count(*)::int from public.t1_cargas x where x.tipo = c.tipo) as cargas
    from public.t1_consolidado c join public.t1_cargas l on l.id = c.carga_id where c.tipo = any($1)`;

  /** Por tipo: lo juntado (filas y fechas de todas las cargas) y el último archivo subido (nombre, quién y cuándo). */
  router.get('/estado', async (_req, res) => {
    if (!pool) { res.status(503).json({ error: `Configura la conexión de Supabase para consultar ${modulo}.` }); return; }
    try {
      const rows = await conTabla(pool, async () => {
        let { rows } = await pool.query(ESTADO, [nombres]);
        const faltan = nombres.filter(t => !rows.some(r => r.tipo === t));
        if (faltan.length) {
          await completarJuntados(pool, faltan);
          ({ rows } = await pool.query(ESTADO, [nombres]));
        }
        return rows;
      });
      // Mientras el navegador procesa el estado, el servidor ya va trayendo los datos.
      for (const r of rows) datosDe(pool, r.tipo, String(r.id)).catch(() => undefined);
      res.json(Object.fromEntries(nombres.map(t => [t, rows.find(r => r.tipo === t) ?? null])));
    } catch (error) {
      fallo(res, error, 'Consulta', `No se pudo consultar ${modulo}. Reintenta en un momento.`);
    }
  });

  /** Datos juntados del tipo, comprimidos (el navegador los descomprime solo). */
  router.get('/datos/:tipo', async (req, res) => {
    const tipo = tipoDe(req);
    if (!tipo) { res.status(404).json({ error: 'Tipo de datos desconocido.' }); return; }
    if (!pool) { res.status(503).json({ error: `Configura la conexión de Supabase para consultar ${modulo}.` }); return; }
    try {
      // Primero solo cuál es la versión de lo juntado (rápido); los datos se traen una vez y quedan en memoria.
      const id = await conTabla(pool, async () => {
        const cual = () => pool.query('select carga_id from public.t1_consolidado where tipo = $1', [tipo]);
        let { rows } = await cual();
        if (!rows[0]) { await completarJuntados(pool, [tipo]); ({ rows } = await cual()); }
        return rows[0] ? String(rows[0].carga_id) : null;
      });
      if (!id) { res.status(404).json({ error: 'Aún no se ha cargado ese archivo.' }); return; }
      const datos = await datosDe(pool, tipo, id);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.send(datos);
    } catch (error) {
      fallo(res, error, 'Consulta', `No se pudieron consultar los datos de ${modulo}.`);
    }
  });

  /** Guarda una carga: cuerpo = JSON de las columnas del tipo, comprimido con gzip; cabecera x-archivo con el nombre.
   *  El archivo queda guardado tal cual y sus fechas se suman (o reemplazan) en lo juntado. */
  router.post('/cargar/:tipo', express.raw({ type: 'application/octet-stream', limit: LIMITE_CUERPO }), async (req, res) => {
    const tipo = tipoDe(req);
    if (!tipo) { res.status(404).json({ error: 'Tipo de datos desconocido.' }); return; }
    if (!pool) { res.status(503).json({ error: 'Configura la conexión de Supabase para guardar.' }); return; }
    const archivo = decodeURIComponent(String(req.get('x-archivo') ?? req.get('x-t1-archivo') ?? '')).trim().slice(0, 180);
    if (!archivo || !Buffer.isBuffer(req.body) || !req.body.length) { res.status(400).json({ error: 'Falta el archivo.' }); return; }
    let columnas: Columnas;
    try {
      columnas = leer(req.body, LIMITE_DESCOMPRIMIDO);
    } catch {
      res.status(400).json({ error: 'El archivo llegó dañado o es demasiado grande. Inténtalo de nuevo.' }); return;
    }
    const problema = tipos[tipo].validar(columnas);
    if (problema) { res.status(400).json({ error: problema }); return; }
    const dias = tipos[tipo].dias(columnas as never);
    let desde = Infinity, hasta = -Infinity;
    for (const d of dias) { if (d < desde) desde = d; if (d > hasta) hasta = d; }
    const usuario = sesion(req)!;
    try {
      const resultado = await conTabla(pool, async () => {
        const client = await pool.connect();
        try {
          await client.query('begin');
          // Una carga a la vez por tipo: la siguiente se junta sobre lo que dejó la anterior.
          await client.query('select pg_advisory_xact_lock(hashtext($1))', [`t1_cargas:${tipo}`]);
          const vigente = (await client.query('select carga_id from public.t1_consolidado where tipo = $1', [tipo])).rows[0];
          const antes = vigente
            ? { id: String(vigente.carga_id), columnas: leer(await datosDe(client, tipo, String(vigente.carga_id)), LIMITE_CONSOLIDADO) }
            : await juntarTodo(client, tipo);
          const { rows } = await client.query(
            `insert into public.t1_cargas (tipo, archivo, filas, desde, hasta, datos, usuario_id, usuario_nombre)
             values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, creado_en`,
            [tipo, archivo, dias.length, isoDeDia(desde), isoDeDia(hasta), req.body, usuario.sub, usuario.nombre]);
          const id = String(rows[0].id);
          const juntado = antes
            ? combinarColumnas(tipos[tipo].esquema, antes.columnas, tipos[tipo].dias(antes.columnas as never), columnas, dias)
            : columnas;
          const total = await guardarJuntado(client, tipo, id, juntado);
          await client.query('commit');
          // Lo recién juntado queda en memoria: no hace falta volver a pedirlo a Supabase.
          memoria.set(tipo, { id, datos: Promise.resolve(total.gz) });
          return { creado_en: rows[0].creado_en, total: { filas: total.filas, desde: total.desde, hasta: total.hasta } };
        } catch (error) {
          await client.query('rollback').catch(() => undefined);
          memoria.delete(tipo);
          throw error;
        } finally { client.release(); }
      });
      res.status(201).json({ tipo, archivo, filas: dias.length, desde: isoDeDia(desde), hasta: isoDeDia(hasta), ...resultado });
    } catch (error) {
      fallo(res, error, 'Guardado', 'No se pudo guardar el archivo. No se aplicó la carga; reintenta.');
    }
  });

  return router;
}
