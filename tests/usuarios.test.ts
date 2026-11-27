import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type pg from 'pg';
import { cifrarClave, claveTemporal, crearAcceso, verificarClave, type SesionUsuario } from '../src/server/usuarios.ts';
import { errorCedula, errorClave, errorNombre, normalizarCedula, normalizarNombre } from '../src/shared/usuarios.ts';

// Base de datos de mentira para public.usuarios_acceso: entiende solo las consultas de src/server/usuarios.ts.
interface Fila {
  id: string; cedula: string; nombre: string; clave: string; rol: string; estado: string; debe_cambiar: boolean;
  intentos_fallidos: number; bloqueado_hasta: Date | null; ultimo_ingreso: Date | null; aprobado_por: string | null;
  aprobado_en: Date | null; creado_en: Date; actualizado_en: Date;
}
function baseFalsa() {
  const filas: Fila[] = [];
  let n = 0;
  const nuevoId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const panel = (f: Fila) => ({ id: f.id, cedula: f.cedula, nombre: f.nombre, rol: f.rol, estado: f.estado, debe_cambiar: f.debe_cambiar, creado_en: f.creado_en, ultimo_ingreso: f.ultimo_ingreso, aprobado_por: f.aprobado_por, aprobado_en: f.aprobado_en });
  const valor = (texto: string, params: unknown[]): unknown => {
    const t = texto.trim();
    if (/^\$\d+$/.test(t)) return params[Number(t.slice(1)) - 1];
    if (/^'.*'$/.test(t)) return t.slice(1, -1);
    if (t === 'now()') return new Date();
    const intervalo = /^now\(\) \+ interval '(\d+) minutes'$/.exec(t);
    if (intervalo) return new Date(Date.now() + Number(intervalo[1]) * 60_000);
    if (t === 'true' || t === 'false') return t === 'true';
    if (t === 'null') return null;
    return Number(t);
  };
  const consulta = async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(begin|commit|rollback)$/.test(s) || s.startsWith('select pg_advisory_xact_lock') || s.startsWith('create table') || s.startsWith('alter table') || s.startsWith('revoke')) return { rows: [] };
    if (s.startsWith('select id, nombre, clave, rol, estado, debe_cambiar, intentos_fallidos, bloqueado_hasta from public.usuarios_acceso where cedula = $1')) {
      return { rows: filas.filter(f => f.cedula === params[0]) };
    }
    if (s.startsWith('select nombre, rol, estado from public.usuarios_acceso where id = $1')) return { rows: filas.filter(f => f.id === params[0]) };
    if (s.startsWith('insert into public.usuarios_acceso')) {
      if (filas.some(f => f.cedula === params[0])) return { rows: [] };
      const f: Fila = { id: nuevoId(), cedula: String(params[0]), nombre: String(params[1]), clave: String(params[2]), rol: 'usuario', estado: 'pendiente', debe_cambiar: false, intentos_fallidos: 0, bloqueado_hasta: null, ultimo_ingreso: null, aprobado_por: null, aprobado_en: null, creado_en: new Date(), actualizado_en: new Date() };
      filas.push(f);
      return { rows: [{ id: f.id }] };
    }
    if (s.startsWith('select id, cedula, nombre, rol, estado') && s.includes('order by')) return { rows: filas.map(panel) };
    if (s.startsWith('select id, cedula, nombre, rol, estado') && s.includes('where id = $1 for update')) return { rows: filas.filter(f => f.id === params[0]).map(panel) };
    if (s.startsWith("select count(*)::int as n from public.usuarios_acceso where rol = 'administrador' and estado = 'activo' and id <> $1")) {
      return { rows: [{ n: filas.filter(f => f.rol === 'administrador' && f.estado === 'activo' && f.id !== params[0]).length }] };
    }
    if (s.startsWith('delete from public.usuarios_acceso where id = $1')) { const i = filas.findIndex(f => f.id === params[0]); if (i >= 0) filas.splice(i, 1); return { rows: [] }; }
    const actualizar = /^update public\.usuarios_acceso set (.+?) where id = \$1( returning .*)?$/.exec(s);
    if (actualizar) {
      const f = filas.find(x => x.id === params[0]);
      if (!f) return { rows: [] };
      for (const asignacion of actualizar[1].split(/,\s*(?=\w+ = )/)) {
        const [columna, ...resto] = asignacion.split(' = ');
        (f as unknown as Record<string, unknown>)[columna.trim()] = valor(resto.join(' = '), params);
      }
      return { rows: actualizar[2] ? [panel(f)] : [] };
    }
    throw new Error('SQL inesperado: ' + s);
  };
  const pool = { query: consulta, connect: async () => ({ query: consulta, release() {} }) } as unknown as pg.Pool;
  return { pool, filas, nuevoId };
}

test('contraseñas cifradas con scrypt y reglas de cédula, nombre y contraseña', async () => {
  const hash = await cifrarClave('Camion2026');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.ok(!hash.includes('Camion2026'), 'nunca en claro');
  assert.ok(await verificarClave('Camion2026', hash));
  assert.ok(!(await verificarClave('camion2026', hash)));
  assert.notEqual(await cifrarClave('Camion2026'), hash, 'cada una con su propia sal');
  assert.equal(normalizarCedula(' 1.234.567 '), '1234567');
  assert.equal(errorCedula('1234567'), null);
  assert.match(errorCedula('12a45')!, /solo lleva números/);
  assert.match(errorCedula('123')!, /entre 5 y 12/);
  assert.equal(normalizarNombre('  Ana   María  Pérez '), 'Ana María Pérez');
  assert.equal(errorNombre('Ana María Pérez'), null);
  assert.match(errorNombre('Ana <script>')!, /letras/);
  assert.equal(errorClave('Camion2026', '1234567'), null);
  assert.match(errorClave('corta1')!, /al menos 8/);
  assert.match(errorClave('sololetras')!, /letras y números/);
  assert.match(errorClave('abc1234567x', '1234567')!, /cédula/);
  const temporal = claveTemporal();
  assert.equal(temporal.length, 10);
  assert.equal(errorClave(temporal), null, 'la temporal cumple las reglas');
});

test('registro, aprobación, bloqueo por intentos, restablecer contraseña y panel', async () => {
  const { pool, filas, nuevoId } = baseFalsa();
  // Administrador ya aprobado.
  const idAdmin = nuevoId();
  filas.push({ id: idAdmin, cedula: '1000001', nombre: 'Andrés', clave: await cifrarClave('Admin2026x'), rol: 'administrador', estado: 'activo', debe_cambiar: false, intentos_fallidos: 0, bloqueado_hasta: null, ultimo_ingreso: null, aprobado_por: null, aprobado_en: null, creado_en: new Date(), actualizado_en: new Date() });
  const abiertas: SesionUsuario[] = [];
  // En la prueba, la sesión viaja en una cabecera (en la aplicación va firmada en una cookie).
  const sesion = (req: express.Request) => { const v = req.get('x-sesion'); return v ? JSON.parse(v) as SesionUsuario : null; };
  const acceso = crearAcceso(pool, (_res, s) => { abiertas.push(s); }, sesion);
  const app = express();
  app.use(express.json());
  app.post('/api/login', acceso.login);
  app.post('/api/registro', acceso.registro);
  app.use('/api/usuarios', acceso.admin);
  const server = app.listen(0);
  await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const json = { 'Content-Type': 'application/json' };
  const enviar = (ruta: string, cuerpo: unknown, extra: Record<string, string> = {}) => fetch(`${base}${ruta}`, { method: 'POST', headers: { ...json, ...extra }, body: JSON.stringify(cuerpo) });
  const comoAdmin = { 'x-sesion': JSON.stringify({ sub: idAdmin, cedula: '1000001', nombre: 'Andrés', rol: 'administrador' }) };
  try {
    // Registro: queda pendiente; la misma cédula no se registra dos veces.
    assert.equal((await enviar('/registro', { cedula: '1.234.567', nombre: 'Ana Pérez', password: 'corta' })).status, 400);
    assert.equal((await enviar('/registro', { cedula: '1.234.567', nombre: 'Ana Pérez', password: 'Camion2026' })).status, 201);
    assert.equal((await enviar('/registro', { cedula: '1234567', nombre: 'Otra', password: 'Camion2026' })).status, 409);
    const ana = filas.find(f => f.cedula === '1234567')!;
    assert.equal(ana.estado, 'pendiente');
    assert.notEqual(ana.clave, 'Camion2026');

    // Ingreso: clave mala → genérico; buena pero pendiente → se le avisa.
    const malo = await enviar('/login', { cedula: '1234567', password: 'Otra2026xx' });
    assert.deepEqual([malo.status, (await malo.json()).error], [401, 'Cédula o contraseña incorrectas.']);
    assert.equal((await enviar('/login', { cedula: '9999999', password: 'Camion2026' })).status, 401, 'cédula que no existe: mismo mensaje');
    const pendiente = await enviar('/login', { cedula: '1234567', password: 'Camion2026' });
    assert.equal(pendiente.status, 403);
    assert.match((await pendiente.json()).error, /pendiente/);

    // Panel: solo administradores.
    assert.equal((await fetch(`${base}/usuarios`)).status, 401);
    assert.equal((await fetch(`${base}/usuarios`, { headers: { 'x-sesion': JSON.stringify({ sub: ana.id, cedula: '1234567', nombre: 'Ana', rol: 'administrador' }) } })).status, 403, 'el rol se confirma en la base, no en la cookie');
    const lista = await (await fetch(`${base}/usuarios`, { headers: comoAdmin })).json();
    assert.deepEqual(lista.usuarios.map((u: { cedula: string }) => u.cedula).sort(), ['1000001', '1234567']);
    assert.ok(lista.usuarios.every((u: Record<string, unknown>) => !('clave' in u)), 'el panel nunca recibe contraseñas');

    // Aprobar con rol y entrar.
    assert.equal((await enviar(`/usuarios/${ana.id}`, { accion: 'aprobar' }, comoAdmin)).status, 400, 'hay que elegir rol');
    const aprobada = await (await enviar(`/usuarios/${ana.id}`, { accion: 'aprobar', rol: 'usuario' }, comoAdmin)).json();
    assert.deepEqual([aprobada.usuario.estado, aprobada.usuario.rol, aprobada.usuario.aprobado_por], ['activo', 'usuario', 'Andrés (1000001)']);
    assert.equal((await enviar('/login', { cedula: '1234567', password: 'Camion2026' })).status, 200);
    assert.deepEqual(abiertas.at(-1), { sub: ana.id, cedula: '1234567', nombre: 'Ana Pérez', rol: 'usuario' });

    // 5 intentos fallidos bloquean la cédula, aunque después llegue la contraseña correcta.
    for (let i = 0; i < 5; i++) assert.equal((await enviar('/login', { cedula: '1234567', password: 'Mala12345' })).status, 401);
    const bloqueada = await enviar('/login', { cedula: '1234567', password: 'Camion2026' });
    assert.equal(bloqueada.status, 429);
    assert.match((await bloqueada.json()).error, /Espera \d+ minutos/);

    // Restablecer: contraseña temporal (desbloquea); al entrar con ella hay que crear una nueva.
    const { temporal } = await (await enviar(`/usuarios/${ana.id}`, { accion: 'restablecer' }, comoAdmin)).json();
    assert.equal(typeof temporal, 'string');
    const debe = await enviar('/login', { cedula: '1234567', password: temporal });
    assert.deepEqual([debe.status, (await debe.json()).code], [409, 'DEBE_CAMBIAR']);
    assert.equal((await enviar('/login', { cedula: '1234567', password: temporal, nueva: 'corta' })).status, 400);
    assert.equal((await enviar('/login', { cedula: '1234567', password: temporal, nueva: 'Nueva2026x' })).status, 200);
    assert.equal((await enviar('/login', { cedula: '1234567', password: temporal })).status, 401, 'la temporal ya no sirve');
    assert.equal((await enviar('/login', { cedula: '1234567', password: 'Nueva2026x' })).status, 200);

    // Desactivar: ya no entra y su sesión deja de valer.
    assert.equal((await enviar(`/usuarios/${idAdmin}`, { accion: 'desactivar' }, comoAdmin)).status, 409, 'no a sí mismo');
    assert.equal((await enviar(`/usuarios/${idAdmin}`, { accion: 'rol', rol: 'usuario' }, comoAdmin)).status, 409, 'no se quita su propio rol');
    assert.equal((await enviar(`/usuarios/${ana.id}`, { accion: 'desactivar' }, comoAdmin)).status, 200);
    assert.equal(await acceso.vigente(ana.id), null, 'la sesión de Ana deja de valer');
    const inactiva = await enviar('/login', { cedula: '1234567', password: 'Nueva2026x' });
    assert.deepEqual([inactiva.status, (await inactiva.json()).error], [403, 'Tu usuario está desactivado. Contacta con el administrador.']);
    assert.equal((await enviar(`/usuarios/${ana.id}`, { accion: 'eliminar' }, comoAdmin)).status, 409, 'a un usuario aprobado se le desactiva, no se borra');

    // Un registro rechazado se puede borrar (libera la cédula).
    await enviar('/registro', { cedula: '7654321', nombre: 'Error Tipeo', password: 'Camion2026' });
    const id2 = filas.find(f => f.cedula === '7654321')!.id;
    assert.equal((await enviar(`/usuarios/${id2}`, { accion: 'rechazar' }, comoAdmin)).status, 200);
    assert.equal((await enviar(`/usuarios/${id2}`, { accion: 'eliminar' }, comoAdmin)).status, 200);
    assert.ok(!filas.some(f => f.cedula === '7654321'));
  } finally { server.close(); }
});
