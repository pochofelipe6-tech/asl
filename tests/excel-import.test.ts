import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import express from 'express';
import pg from 'pg';
import { rutasExcel } from '../src/server/excel.ts';
import { COLUMNAS_EXCEL, normalizarFila, validarColumnas, fechaExcel } from '../src/shared/excel.ts';

function valores(material = 'Material de prueba') {
  const fila: (string | number | null)[] = Array(41).fill(null);
  fila[0] = '05/11/2026'; fila[3] = 'TEST-1'; fila[5] = '2027-01-31'; fila[8] = material;
  fila[9] = 'Centro de prueba'; fila[12] = 12.5; fila[21] = '1.25'; fila[28] = 87; fila[33] = 1500;
  return fila;
}

test('valida la plantilla, fechas y números antes de cargar', () => {
  assert.doesNotThrow(() => validarColumnas([...COLUMNAS_EXCEL]));
  assert.throws(() => validarColumnas([...COLUMNAS_EXCEL].reverse()), /columna 1/);
  assert.throws(() => validarColumnas(COLUMNAS_EXCEL.slice(1)), /41 columnas/);
  const fila = normalizarFila(valores(), 2);
  assert.equal(fila[0], fechaExcel('2026-11-05'));
  assert.equal(fila[21], 1.25);
  assert.throws(() => fechaExcel('31/02/2026'), /no existe/);
  const sinFecha = valores(); sinFecha[0] = null;
  assert.throws(() => normalizarFila(sinFecha, 3), /Fila 3: falta/);
  const noNumero = valores(); noNumero[12] = 'abc';
  assert.throws(() => normalizarFila(noNumero, 4), /Fila 4, Hectolitros/);
});

test('importación y exportación aisladas del informe real', { skip: !process.env.SUPABASE_DB_URL }, async t => {
  const schema = 'test_excel_' + randomBytes(6).toString('hex');
  const admin = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
  await admin.connect();
  const original = await admin.query('select id from public.frescura_consolidado_lotes order by cargado_en desc limit 1');
  await admin.query(`create schema ${schema}`);
  const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, options: `-c search_path=${schema},public`, max: 3 });
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use('/api/excel', rutasExcel(pool, req => req.get('x-test-user') ? { sub: req.get('x-test-user')! } : null, () => {}));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/excel`;
  async function request(method: string, ruta: string, body?: unknown, usuario = 'usuario-prueba') {
    const response = await fetch(base + ruta, { method, headers: { 'Content-Type': 'application/json', ...(usuario ? { 'x-test-user': usuario } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); return { status: response.status, data: text ? JSON.parse(text) : null, bytes: Buffer.byteLength(text) };
  }
  const iniciar = (filas = 2) => request('POST', '/importaciones', { archivo: 'prueba.xlsx', filas, columnas: COLUMNAS_EXCEL });
  const bloque = (id: string, offset: number, filas: unknown[], usuario?: string) => request('PUT', `/importaciones/${id}/filas`, { offset, filas }, usuario);
  try {
    await admin.query(`create table ${schema}.frescura_consolidado_lotes (like public.frescura_consolidado_lotes including all)`);
    await admin.query(`create table ${schema}.frescura_consolidado (lote_id text references ${schema}.frescura_consolidado_lotes(id),fila_excel integer,valores jsonb,primary key(lote_id,fila_excel))`);
    const migration = await readFile(new URL('../supabase/importaciones_excel.sql', import.meta.url), 'utf8');
    await admin.query(migration.replaceAll('public.', schema + '.'));
    await pool.query("insert into frescura_consolidado_lotes(id,archivo,filas) values ('anterior','anterior.xlsx',0)");

    await t.test('exige sesión y rechaza columnas o cantidades inválidas', async () => {
      assert.equal((await request('GET', '/archivo', undefined, '')).status, 401);
      assert.equal((await request('POST', '/importaciones', { archivo: 'x.xlsx', filas: 1, columnas: [] })).status, 400);
      assert.equal((await iniciar(0)).status, 400);
    });
    await t.test('carga por partes, reintenta sin duplicados y publica de forma atómica', async () => {
      const inicio = await iniciar(); assert.equal(inicio.status, 201); const id = inicio.data.id;
      const primera = [{ fila_excel: 2, valores: valores() }];
      assert.equal((await bloque(id, 0, primera, 'otro-usuario')).status, 404);
      assert.equal((await request('GET', `/importaciones/${id}`, undefined, 'otro-usuario')).status, 404);
      assert.equal((await bloque(id, 0, primera)).data.recibidas, 1);
      assert.equal((await bloque(id, 0, primera)).data.recibidas, 1);
      assert.equal((await bloque(id, 0, [{ fila_excel: 2, valores: valores('Cambió') }])).status, 409);
      assert.equal((await request('POST', `/importaciones/${id}/finalizar`, {})).status, 409);
      assert.equal((await request('GET', '/archivo')).data.id, 'anterior');
      assert.equal((await bloque(id, 1, [{ fila_excel: 4, valores: valores('Segunda fila') }])).data.recibidas, 2);
      const fin = await request('POST', `/importaciones/${id}/finalizar`, {}); assert.equal(fin.status, 200);
      assert.equal((await request('POST', `/importaciones/${id}/finalizar`, {})).data.lote, fin.data.lote);
      const meta = await request('GET', '/archivo'); assert.equal(meta.data.filas, 2); assert.equal(meta.data.id, fin.data.lote);
      const descarga = await request('GET', '/datos?lote=' + fin.data.lote);
      assert.equal(descarga.data.filas.length, 2); assert.equal(descarga.data.siguiente, null);
      assert.deepEqual(descarga.data.filas[0].valores, normalizarFila(valores(), 2));
      assert.equal((await pool.query('select count(*)::int as n from frescura_importacion_filas')).rows[0].n, 0);
    });
    await t.test('rechaza valores inválidos y la cancelación conserva el lote visible', async () => {
      const antes = (await request('GET', '/archivo')).data.id;
      const id = (await iniciar(1)).data.id;
      const mala = valores(); mala[12] = 'texto';
      assert.equal((await bloque(id, 0, [{ fila_excel: 2, valores: mala }])).status, 400);
      assert.equal((await request('GET', `/importaciones/${id}`)).data.recibidas, 0);
      assert.equal((await bloque(id, 0, [{ fila_excel: 2, valores: valores() }])).status, 200);
      assert.equal((await request('DELETE', `/importaciones/${id}`)).status, 204);
      assert.equal((await request('POST', `/importaciones/${id}/finalizar`, {})).status, 409);
      assert.equal((await request('GET', '/archivo')).data.id, antes);
    });
    await t.test('dos importaciones concurrentes no se sobrescriben sin revisión', async () => {
      const a = (await iniciar(1)).data.id, b = (await iniciar(1)).data.id;
      await bloque(a, 0, [{ fila_excel: 2, valores: valores() }]);
      await bloque(b, 0, [{ fila_excel: 2, valores: valores() }]);
      const activa = await request('POST', `/importaciones/${a}/finalizar`, {});
      assert.equal(activa.status, 200);
      assert.equal((await request('POST', `/importaciones/${b}/finalizar`, {})).status, 409);
      assert.equal((await request('GET', '/archivo')).data.id, activa.data.lote);
      await request('DELETE', `/importaciones/${b}`);
    });
    await t.test('descarga todas las filas en respuestas pequeñas sin perder el orden', async () => {
      await pool.query("insert into frescura_consolidado_lotes(id,archivo,filas) values ('grande','grande.xlsx',3001)");
      const fila = normalizarFila(valores('A'.repeat(1900)), 2);
      await pool.query("insert into frescura_consolidado select 'grande',n,$1::jsonb from generate_series(2,3002) n", [JSON.stringify(fila)]);
      let siguiente: number | null = 1, total = 0, ultima = 1;
      do {
        const pagina = await request('GET', '/datos?lote=grande&despues=' + siguiente);
        assert.equal(pagina.status, 200); assert.ok(pagina.bytes < 1100000);
        for (const row of pagina.data.filas) { assert.equal(row.fila_excel, ++ultima); total++; }
        siguiente = pagina.data.siguiente;
      } while (siguiente !== null);
      assert.equal(total, 3001);
    });
    const despues = await admin.query('select id from public.frescura_consolidado_lotes order by cargado_en desc limit 1');
    assert.deepEqual(despues.rows, original.rows, 'El lote de producción no debe cambiar durante las pruebas');
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
    assert.match(schema, /^test_excel_[a-f0-9]{12}$/);
    await admin.query(`drop schema ${schema} cascade`); await admin.end();
  }
});
