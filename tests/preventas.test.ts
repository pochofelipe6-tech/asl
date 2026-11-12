import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import { normalizarPreventa, metricasPreventa } from '../src/shared/preventas.ts';
import { rutasPreventas } from '../src/server/preventas.ts';

const inicial = JSON.parse(await readFile('datos/preventas/inicial.json', 'utf8'));
test('las fórmulas conservan el corte real y no compensan agotados entre materiales', () => {
  assert.equal(inicial.filas.length, 954);
  const primera = normalizarPreventa(inicial.filas[0]);
  assert.ok(Math.abs(Number(primera[18]) - 2.6136) < 1e-10);
  assert.ok(Math.abs(Number(primera[20]) - 0.5742) < 1e-10);
  const m = inicial.filas.reduce((s: number, f: unknown) => s + metricasPreventa(normalizarPreventa(f)).agotados, 0);
  assert.ok(Math.abs(m - 760.47326) < 0.01);
  const anterior = inicial.snapshot.reduce((s: number, f: { agotados: number }) => s + f.agotados, 0);
  assert.ok(Math.abs(anterior - 2870.78) < 0.01);
  assert.notEqual(inicial.snapshot[0].fecha, inicial.filas[0][0]);
});
test('valida fechas y cantidades y recalcula valores derivados recibidos', () => {
  const f = [...inicial.filas[0]]; f[18] = 999999; f[20] = 999999;
  assert.ok(Number(normalizarPreventa(f)[18]) < 3);
  f[16] = 0; assert.throws(() => normalizarPreventa(f), /positivos/);
  f[16] = 6; f[0] = '31/02/2026'; assert.throws(() => normalizarPreventa(f), /no existe/);
  f[0] = 46336; f[13] = 'invalido'; assert.throws(() => normalizarPreventa(f), /numérico/);
  assert.throws(() => normalizarPreventa([]), /35 columnas/);
});
test('schema, carga inicial y guardado transaccional en un esquema aislado', { skip: !process.env.SUPABASE_DB_URL }, async () => {
  const schema = 'test_preventas_' + randomBytes(5).toString('hex');
  const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1, connectionTimeoutMillis: 15000 });
  let server: ReturnType<express.Express['listen']> | undefined;
  const adaptar = (sql: string) => sql.replaceAll('public.', `${schema}.`).replaceAll("'preventas:guardar'", `'${schema}:guardar'`);
  const fachada = {
    query: (sql: string, params?: unknown[]) => pool.query(adaptar(sql), params),
    connect: async () => {
      const c = await pool.connect();
      return { query: (sql: string, params?: unknown[]) => c.query(adaptar(sql), params), release: () => c.release() };
    },
  } as unknown as pg.Pool;
  try {
    await pool.query(`create schema ${schema}`);
    await pool.query(adaptar(await readFile('supabase/preventas_schema.sql', 'utf8')));
    const seed = adaptar(await readFile('supabase/preventas_datos_iniciales.sql', 'utf8'));
    await pool.query(seed); await pool.query(seed); // carga inicial repetible, sin duplicar registros
    const app = express(); app.use(express.json({ limit: '20mb' }));
    app.use('/api/preventas', rutasPreventas(fachada, req => req.get('x-test-user') ? { sub: 'test-user' } : null));
    server = app.listen(0);
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const port = (server.address() as { port: number }).port, url = `http://127.0.0.1:${port}/api/preventas`;
    assert.equal((await fetch(url + '/datos')).status, 401);
    const headers = { 'x-test-user': '1', 'Content-Type': 'application/json' };
    const get = async () => (await fetch(url + '/datos', { headers })).json();
    const data = await get(); assert.equal(data.filas.length, 954); assert.equal(data.persistido, true); assert.ok(data.snapshot.length > 0);
    const post = (body: unknown, extra = {}) => fetch(url + '/guardar', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    const body = { archivo: 'prueba.xlsx', modo: 'importar', filas: [inicial.filas[0]], loteBase: data.lote.id };
    assert.equal((await post(body, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post({ ...body, filas: [[]] })).status, 400);
    assert.equal((await get()).filas.length, 954);
    assert.equal((await post({ ...body, snapshot: inicial.snapshot })).status, 200);
    const imported = await get(); assert.equal(imported.filas.length, 1); assert.equal(imported.snapshot.length, inicial.snapshot.length);
    assert.equal((await post(body)).status, 409);
    assert.equal((await post({ ...body, modo: 'agregar', loteBase: imported.lote.id })).status, 200);
    assert.equal((await get()).filas.length, 2);
    assert.equal((await pool.query(`select count(*)::int as n from ${schema}.preventas_lotes`)).rows[0].n, 2);
    const diaAnterior = Number(inicial.filas[0][0]);
    const nuevoDia = [...inicial.filas[0]]; nuevoDia[0] = diaAnterior + 1;
    const previo = await get();
    assert.equal((await post({ ...body, filas: [nuevoDia], loteBase: previo.lote.id })).status, 200);
    const manana = await get();
    assert.equal(manana.filas.length, 3); // dos del día anterior y una del nuevo
    const actualizado = [...nuevoDia]; actualizado[13] = 200;
    assert.equal((await post({ ...body, filas: [actualizado], loteBase: manana.lote.id })).status, 200);
    const tarde = await get();
    assert.equal(tarde.filas.length, 3);
    assert.equal(tarde.filas.filter((f: { valores: unknown[] }) => f.valores[0] === diaAnterior).length, 2);
    const actuales = tarde.filas.filter((f: { valores: unknown[] }) => f.valores[0] === diaAnterior + 1);
    assert.equal(actuales.length, 1);
    assert.equal(actuales[0].valores[13], 200);
    assert.equal((await post({ ...body, filas: [actualizado], loteBase: tarde.lote.id })).status, 200);
    assert.equal((await get()).filas.length, 3); // reimportar no duplica
    const view = await pool.query(`select * from ${schema}.preventas_detalle limit 1`);
    assert.ok(Number(view.rows[0].agotados_hl) > 0);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    await pool.query(`drop schema if exists ${schema} cascade`);
    await pool.end();
  }
});
