import express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type pg from 'pg';
import { randomBytes, randomInt, scrypt as scryptConCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  errorCedula, errorClave, errorNombre, esRol, normalizarCedula, normalizarNombre,
  type Estado, type Rol, type UsuarioPanel,
} from '../shared/usuarios.ts';

// Acceso con cédula y contraseña (reemplaza el ingreso con correo de Supabase Auth).
// - Cada persona se registra con su cédula, su nombre y la contraseña que elija: queda "pendiente".
// - Un administrador la aprueba (y le da un rol), la rechaza, la desactiva o le restablece la contraseña.
// - Las contraseñas se guardan cifradas con scrypt (sal propia por usuario); nunca se guardan ni se devuelven en claro.
// - Tras 5 intentos fallidos con una cédula, esa cédula queda bloqueada 15 minutos (además del límite por IP).
// La tabla public.usuarios_acceso se crea sola la primera vez (ver supabase/usuarios.sql).

export interface SesionUsuario { sub: string; cedula: string; nombre: string; rol: string }
type Consulta = Pick<pg.PoolClient, 'query'>;

const scrypt = promisify(scryptConCallback) as (clave: string, sal: Buffer, largo: number, opciones: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Cifra una contraseña: "scrypt$N$r$p$sal$hash" (base64). */
export async function cifrarClave(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const hash = await scrypt(clave.normalize('NFKC'), sal, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sal.toString('base64')}$${hash.toString('base64')}`;
}
export async function verificarClave(clave: string, guardada: string): Promise<boolean> {
  const partes = guardada.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, N, r, p, sal, hash] = partes;
  const esperado = Buffer.from(hash, 'base64');
  const obtenido = await scrypt(clave.normalize('NFKC'), Buffer.from(sal, 'base64'), esperado.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return obtenido.length === esperado.length && timingSafeEqual(obtenido, esperado);
}

/** Contraseña temporal para un restablecimiento: 10 caracteres fáciles de dictar (sin 0/O ni 1/l/I), con letras y números. */
export function claveTemporal(): string {
  const letras = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', numeros = '23456789', todos = letras + numeros;
  const c = Array.from({ length: 10 }, () => todos[randomInt(todos.length)]);
  c[randomInt(5)] = letras[randomInt(letras.length)];
  c[5 + randomInt(5)] = numeros[randomInt(numeros.length)];
  return c.join('');
}

const TABLA = `create table if not exists public.usuarios_acceso (
  id uuid primary key default gen_random_uuid(),
  cedula text not null unique,
  nombre text not null,
  clave text not null,
  rol text not null default 'usuario' check (rol in ('administrador', 'usuario')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'activo', 'inactivo', 'rechazado')),
  debe_cambiar boolean not null default false,
  intentos_fallidos integer not null default 0,
  bloqueado_hasta timestamptz,
  ultimo_ingreso timestamptz,
  aprobado_por text,
  aprobado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
)`;
const COLUMNAS_PANEL = 'id, cedula, nombre, rol, estado, debe_cambiar, creado_en, ultimo_ingreso, aprobado_por, aprobado_en';
const INCORRECTO = 'Cédula o contraseña incorrectas.';
const MAX_INTENTOS = 5;
const MINUTOS_BLOQUEO = 15;
/** Cada cuánto se vuelve a confirmar en la base que una sesión sigue activa (y con qué rol). */
const VIGENCIA_MS = 60_000;

export function crearAcceso(pool: pg.Pool | null, abrirSesion: (res: Response, s: SesionUsuario) => void, sesion: (req: Request) => SesionUsuario | null) {
  let tablaLista: Promise<void> | null = null;
  const crearTabla = (db: pg.Pool) => (tablaLista ??= (async () => {
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', ['usuarios_acceso:crear']);
      await client.query(TABLA);
      await client.query('alter table public.usuarios_acceso enable row level security');
      await client.query('revoke all on public.usuarios_acceso from anon, authenticated');
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      tablaLista = null;
      throw error;
    } finally { client.release(); }
  })());
  /** Corre "accion"; si falta la tabla, la crea y vuelve a intentar una vez. */
  const conTabla = async <T>(db: pg.Pool, accion: () => Promise<T>): Promise<T> => {
    try { return await accion(); } catch (error) {
      const e = error as { code?: string; message?: string };
      if (e.code !== '42P01' || !String(e.message).includes('usuarios_acceso')) throw error;
      await crearTabla(db);
      return accion();
    }
  };
  const fallo = (res: Response, error: unknown, mensaje: string) => {
    console.error('Usuarios:', (error as Error).message);
    res.status(503).json({ error: mensaje });
  };

  // Contraseña de mentira para comparar cuando la cédula no existe: así tarda lo mismo y no delata qué cédulas hay.
  let claveFalsa: Promise<string> | null = null;
  const falsa = () => (claveFalsa ??= cifrarClave(randomBytes(12).toString('hex')));

  // ¿La sesión sigue activa y con qué rol? (cada minuto se vuelve a mirar en la base; los cambios del panel la renuevan ya).
  const vigentes = new Map<string, { hasta: number; usuario: { nombre: string; rol: Rol } | null }>();
  async function vigente(id: string, fresco = false): Promise<{ nombre: string; rol: Rol } | null> {
    const guardado = vigentes.get(id);
    if (!fresco && guardado && guardado.hasta > Date.now()) return guardado.usuario;
    if (!pool || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { rows } = await conTabla(pool, () => pool.query('select nombre, rol, estado from public.usuarios_acceso where id = $1', [id]));
    const usuario = rows[0]?.estado === 'activo' ? { nombre: String(rows[0].nombre), rol: rows[0].rol as Rol } : null;
    vigentes.set(id, { hasta: Date.now() + VIGENCIA_MS, usuario });
    return usuario;
  }

  const login: RequestHandler = async (req, res) => {
    if (!pool) { res.status(503).json({ error: 'El inicio de sesión no está disponible: falta la conexión con la base de datos.' }); return; }
    const cedula = normalizarCedula(req.body?.cedula);
    const clave = String(req.body?.password ?? '');
    const nueva = req.body?.nueva === undefined || req.body?.nueva === null ? null : String(req.body.nueva);
    if (errorCedula(cedula) || !clave) { res.status(400).json({ error: 'Escribe tu cédula y tu contraseña.' }); return; }
    try {
      const fila = (await conTabla(pool, () => pool.query(
        'select id, nombre, clave, rol, estado, debe_cambiar, intentos_fallidos, bloqueado_hasta from public.usuarios_acceso where cedula = $1', [cedula]))).rows[0];
      if (!fila) { await verificarClave(clave, await falsa()); res.status(401).json({ error: INCORRECTO }); return; }
      if (fila.bloqueado_hasta && new Date(fila.bloqueado_hasta).getTime() > Date.now()) {
        const minutos = Math.max(1, Math.ceil((new Date(fila.bloqueado_hasta).getTime() - Date.now()) / 60_000));
        res.status(429).json({ error: `Demasiados intentos fallidos con esta cédula. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} e inténtalo de nuevo.` });
        return;
      }
      if (!(await verificarClave(clave, String(fila.clave)))) {
        const intentos = Number(fila.intentos_fallidos) + 1;
        if (intentos >= MAX_INTENTOS) {
          await pool.query(`update public.usuarios_acceso set intentos_fallidos = 0, bloqueado_hasta = now() + interval '${MINUTOS_BLOQUEO} minutes' where id = $1`, [fila.id]);
        } else await pool.query('update public.usuarios_acceso set intentos_fallidos = $2 where id = $1', [fila.id, intentos]);
        res.status(401).json({ error: INCORRECTO });
        return;
      }
      // El estado solo se cuenta a quien ya dio la contraseña correcta.
      const estado = fila.estado as Estado;
      if (estado === 'pendiente') { res.status(403).json({ error: 'Tu registro está pendiente: un administrador debe aprobarlo antes de que puedas entrar.' }); return; }
      if (estado === 'rechazado') { res.status(403).json({ error: 'Tu registro no fue aprobado. Contacta con el administrador.' }); return; }
      if (estado === 'inactivo') { res.status(403).json({ error: 'Tu usuario está desactivado. Contacta con el administrador.' }); return; }
      if (fila.debe_cambiar) {
        // Contraseña temporal (la dio el administrador): para entrar hay que crear una nueva.
        if (nueva === null) { res.status(409).json({ code: 'DEBE_CAMBIAR', error: 'Tu contraseña fue restablecida. Crea una nueva para continuar.' }); return; }
        const problema = errorClave(nueva, cedula) ?? (nueva === clave ? 'La nueva contraseña debe ser distinta a la temporal.' : null);
        if (problema) { res.status(400).json({ code: 'DEBE_CAMBIAR', error: problema }); return; }
        await pool.query('update public.usuarios_acceso set clave = $2, debe_cambiar = false, actualizado_en = now() where id = $1', [fila.id, await cifrarClave(nueva)]);
      }
      await pool.query('update public.usuarios_acceso set intentos_fallidos = 0, bloqueado_hasta = null, ultimo_ingreso = now() where id = $1', [fila.id]);
      vigentes.set(String(fila.id), { hasta: Date.now() + VIGENCIA_MS, usuario: { nombre: String(fila.nombre), rol: fila.rol as Rol } });
      abrirSesion(res, { sub: String(fila.id), cedula, nombre: String(fila.nombre), rol: String(fila.rol) });
      res.json({ nombre: fila.nombre });
    } catch (error) {
      fallo(res, error, 'No se pudo iniciar sesión. Inténtalo más tarde.');
    }
  };

  const registro: RequestHandler = async (req, res) => {
    if (!pool) { res.status(503).json({ error: 'El registro no está disponible: falta la conexión con la base de datos.' }); return; }
    const cedula = normalizarCedula(req.body?.cedula);
    const nombre = normalizarNombre(req.body?.nombre);
    const clave = String(req.body?.password ?? '');
    const problema = errorCedula(cedula) ?? errorNombre(nombre) ?? errorClave(clave, cedula);
    if (problema) { res.status(400).json({ error: problema }); return; }
    try {
      const hash = await cifrarClave(clave);
      const { rows } = await conTabla(pool, () => pool.query(
        'insert into public.usuarios_acceso (cedula, nombre, clave) values ($1, $2, $3) on conflict (cedula) do nothing returning id', [cedula, nombre, hash]));
      if (!rows[0]) { res.status(409).json({ error: 'Esa cédula ya está registrada. Si olvidaste tu contraseña, pide al administrador que la restablezca.' }); return; }
      res.status(201).json({ mensaje: 'Registro enviado. Cuando un administrador lo apruebe podrás entrar con tu cédula y tu contraseña.' });
    } catch (error) {
      fallo(res, error, 'No se pudo registrar. Inténtalo más tarde.');
    }
  };

  // ---------- Panel de administración: /api/usuarios ----------
  const admin = express.Router();
  admin.use(async (req, res, next) => {
    const s = sesion(req);
    if (!s) { res.status(401).json({ error: 'Inicia sesión para administrar usuarios.' }); return; }
    if (req.method !== 'GET' && req.get('sec-fetch-site') === 'cross-site') { res.status(403).json({ error: 'Abre la aplicación para hacer cambios.' }); return; }
    if (!pool) { res.status(503).json({ error: 'Falta la conexión con la base de datos.' }); return; }
    res.setHeader('Cache-Control', 'no-store');
    try {
      // El rol se confirma en la base en cada petición: una sesión vieja no da permisos que ya no tiene.
      const yo = await vigente(s.sub, true);
      if (yo?.rol !== 'administrador') { res.status(403).json({ error: 'Solo un administrador puede administrar usuarios.' }); return; }
      res.locals.admin = { ...s, nombre: yo.nombre };
      next();
    } catch (error) { fallo(res, error, 'No se pudo comprobar tu sesión.'); }
  });

  admin.get('/', async (_req, res) => {
    try {
      const { rows } = await conTabla(pool!, () => pool!.query(
        `select ${COLUMNAS_PANEL} from public.usuarios_acceso order by (estado = 'pendiente') desc, creado_en desc`));
      res.json({ usuarios: rows as UsuarioPanel[] });
    } catch (error) { fallo(res, error, 'No se pudieron consultar los usuarios.'); }
  });

  admin.post('/:id', async (req, res) => {
    const id = String(req.params.id);
    const accion = String(req.body?.accion ?? '');
    const rol = req.body?.rol;
    const yo = res.locals.admin as SesionUsuario;
    if (!/^[0-9a-f-]{36}$/i.test(id)) { res.status(404).json({ error: 'Ese usuario no existe.' }); return; }
    const client = await pool!.connect();
    try {
      await client.query('begin');
      // Un cambio a la vez: así dos administradores no dejan el sistema sin ninguno.
      await client.query('select pg_advisory_xact_lock(hashtext($1))', ['usuarios_acceso:cambios']);
      const fila = (await client.query(`select ${COLUMNAS_PANEL} from public.usuarios_acceso where id = $1 for update`, [id])).rows[0] as UsuarioPanel | undefined;
      if (!fila) { await client.query('rollback'); res.status(404).json({ error: 'Ese usuario no existe.' }); return; }
      const resultado = await aplicar(client, fila, accion, rol, yo);
      if ('error' in resultado) { await client.query('rollback'); res.status(resultado.estado).json({ error: resultado.error }); return; }
      await client.query('commit');
      vigentes.delete(id);
      res.json(resultado);
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      fallo(res, error, 'No se pudo guardar el cambio. Inténtalo de nuevo.');
    } finally { client.release(); }
  });

  type Resultado = { usuario: UsuarioPanel | null; temporal?: string } | { error: string; estado: number };
  async function aplicar(db: Consulta, u: UsuarioPanel, accion: string, rol: unknown, yo: SesionUsuario): Promise<Resultado> {
    const esYo = u.id === yo.sub;
    const otrosAdmins = async () => Number((await db.query(
      "select count(*)::int as n from public.usuarios_acceso where rol = 'administrador' and estado = 'activo' and id <> $1", [u.id])).rows[0].n);
    const dejaSinAdmins = async () => u.rol === 'administrador' && u.estado === 'activo' && (await otrosAdmins()) === 0;
    const guardar = async (sql: string, valores: unknown[] = []) =>
      (await db.query(`update public.usuarios_acceso set ${sql}, actualizado_en = now() where id = $1 returning ${COLUMNAS_PANEL}`, [u.id, ...valores])).rows[0] as UsuarioPanel;
    const no = (error: string, estado = 409): Resultado => ({ error, estado });

    switch (accion) {
      case 'aprobar':
        if (!esRol(rol)) return no('Elige el rol del usuario.', 400);
        if (u.estado !== 'pendiente' && u.estado !== 'rechazado') return no('Este usuario ya fue aprobado.');
        return { usuario: await guardar("estado = 'activo', rol = $2, aprobado_por = $3, aprobado_en = now()", [rol, `${yo.nombre} (${yo.cedula})`]) };
      case 'rechazar':
        if (u.estado !== 'pendiente') return no('Solo se puede rechazar un registro pendiente.');
        return { usuario: await guardar("estado = 'rechazado'") };
      case 'desactivar':
        if (esYo) return no('No puedes desactivarte a ti mismo.');
        if (u.estado !== 'activo') return no('Este usuario no está activo.');
        if (await dejaSinAdmins()) return no('Es el único administrador activo: aprueba o nombra otro antes de desactivarlo.');
        return { usuario: await guardar("estado = 'inactivo'") };
      case 'activar':
        if (u.estado !== 'inactivo') return no('Este usuario no está desactivado.');
        return { usuario: await guardar("estado = 'activo'") };
      case 'rol':
        if (!esRol(rol)) return no('Elige un rol válido.', 400);
        if (esYo) return no('No puedes cambiar tu propio rol.');
        if (u.estado !== 'activo' && u.estado !== 'inactivo') return no('Primero aprueba el registro.');
        if (rol !== 'administrador' && (await dejaSinAdmins())) return no('Es el único administrador activo: nombra otro antes de quitarle el rol.');
        return { usuario: await guardar('rol = $2', [rol]) };
      case 'restablecer': {
        if (u.estado === 'pendiente' || u.estado === 'rechazado') return no('Primero aprueba el registro.');
        const temporal = claveTemporal();
        const usuario = await guardar('clave = $2, debe_cambiar = true, intentos_fallidos = 0, bloqueado_hasta = null', [await cifrarClave(temporal)]);
        return { usuario, temporal };
      }
      case 'eliminar':
        if (u.estado !== 'pendiente' && u.estado !== 'rechazado') return no('Solo se borran registros pendientes o rechazados; a un usuario aprobado se le desactiva.');
        await db.query('delete from public.usuarios_acceso where id = $1', [u.id]);
        return { usuario: null };
      default:
        return no('Acción desconocida.', 400);
    }
  }

  return { login, registro, admin, vigente };
}
