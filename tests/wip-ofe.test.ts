import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { gzipSync } from 'node:zlib';
import type pg from 'pg';
import { diaDeIso, semanaDe } from '../src/shared/t1.ts';
import { COLUMNAS_WIP, calcularWip, esEncabezadoWip, filasWip, leerWip, opcionesWip, validarColumnasWip } from '../src/shared/wip.ts';
import { CDS_FMS, COLUMNAS_FMS, calcularOfe, filasFms, leerFms, listaMontacargas, opcionesOfe, revisarMontacargas, validarColumnasFms } from '../src/shared/ofe.ts';
import { MONTACARGAS } from '../src/shared/montacargas.ts';
import { rutasOfe, rutasWip } from '../src/server/t1.ts';

const d = diaDeIso;
const cerca = (a: number | null | undefined, b: number) => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
const _ = null;

// Fecha, CD, 0. Pendiente … 8. Finalizado, Total DTs
const wipCrudo: unknown[][] = [
  [...COLUMNAS_WIP],
  [d('2026-11-03'), 'La Arenosa', 1, 0, 0, 0, 2, 1, 1, 2, 3, 10],
  [d('2026-11-04'), 'Galapa', 5, _, _, _, _, _, _, _, _, 5],
  [d('2026-10-20'), 'galapa', _, _, _, _, _, _, _, _, 4, 8],
  [d('2026-11-03'), 'CD Desconocido', _, _, _, _, _, _, _, _, 4, 4],
  [d('2026-11-05'), 'Galapa', 1, _, _, _, _, _, _, _, _, 0],
];

test('lee Data WIP y aplica la suma de vacíos como en DAX', () => {
  assert.ok(esEncabezadoWip(COLUMNAS_WIP));
  assert.ok(!esEncabezadoWip(COLUMNAS_FMS));
  const l = leerWip(wipCrudo);
  assert.equal(l.filas, 4);
  assert.deepEqual(l.omitidas, [{ fila: 6, motivo: 'Total DTs o estados no válidos' }]);
  assert.equal(validarColumnasWip(l.columnas), null);
  assert.equal(validarColumnasWip({ ...l.columnas, tipo: 'fms' }), 'El tipo de archivo no coincide.');
  const [arenosa, galapa, galapaOct, desconocido] = filasWip(l.columnas);
  cerca(arenosa.armado, 0.9); cerca(arenosa.verificacion, 0.6); cerca(arenosa.montacargas, 0.5); cerca(arenosa.wip, 2 / 3);
  assert.deepEqual([arenosa.cd, arenosa.gerencia, arenosa.ol], ['La Arenosa', 'Barranquilla', 'LIS']);
  assert.deepEqual([galapa.armado, galapa.verificacion, galapa.montacargas, galapa.wip, galapa.finalizados], [null, null, null, null, 0], 'todo vacío queda vacío');
  assert.equal(galapaOct.cd, 'Galapa', 'el CD no distingue mayúsculas');
  cerca(galapaOct.armado, 0.5);
  assert.equal(desconocido.cd, '');
  assert.deepEqual(opcionesWip(filasWip(l.columnas)).sinCd, ['CD Desconocido']);
});

test('tarjetas, tabla por CD y tendencia semanal del WIP', () => {
  const filas = filasWip(leerWip(wipCrudo).columnas);
  const nov = { desde: d('2026-11-01'), hasta: d('2026-11-30') };
  const r = calcularWip(filas, nov);
  assert.equal(r.tarjetas.filas, 3);
  cerca(r.tarjetas.wip, (2 / 3 + 1) / 2);
  cerca(r.tarjetas.armado, (0.9 + 1) / 2);
  assert.deepEqual([r.tarjetas.finalizados, r.tarjetas.total], [7, 19]);
  const soloGalapa = calcularWip(filas, { ...nov, cds: ['galapa'] });
  assert.equal(soloGalapa.tarjetas.filas, 1);
  assert.equal(soloGalapa.tarjetas.wip, null, 'los vacíos no entran al promedio');
  assert.deepEqual(soloGalapa.porCd.map(c => c.cd), ['Galapa', 'La Arenosa'], 'la tabla por CD no depende del filtro de CD');
  assert.deepEqual(soloGalapa.porSemana.map(s => s.semana), [semanaDe(d('2026-10-20')), semanaDe(d('2026-11-04'))], 'la semana no depende del rango de fechas');
  cerca(soloGalapa.porSemana[0].wip, 0.5);
  assert.deepEqual(r.mapa.cds, ['Galapa', 'La Arenosa']);
  cerca(r.mapa.valores[1][r.mapa.fechas.indexOf(d('2026-11-03'))]!.armado, 0.9);
});

// Forklift (# de chasis), Horas ralenti, Horas carga, Horas movimiento, Fecha, Turno
const fmsCrudo: unknown[][] = [
  [...COLUMNAS_FMS],
  ['308FGJ35-35321', 2, 3, 3, d('2026-10-01'), ' a '],
  ['308FGJ35-68176', _, _, 6, d('2026-10-01'), 'B'],
  ['XYZ-NO-EXISTE', 1, 1, 1, d('2026-10-02'), 'C'],
  ['308FGJ35-35321', _, _, _, d('2026-10-02'), 'c'],
  ['308FGJ35-35321', 'abc', 1, 1, d('2026-10-03'), 'A'],
];

test('lee Data FMS y cruza el chasis con la lista de montacargas', () => {
  const l = leerFms(fmsCrudo);
  assert.equal(l.filas, 4);
  assert.deepEqual(l.omitidas, [{ fila: 6, motivo: 'Horas no válidas' }]);
  assert.equal(validarColumnasFms(l.columnas), null);
  assert.equal(validarColumnasFms(leerWip(wipCrudo).columnas), 'El tipo de archivo no coincide.');
  const [a, b, sinLista, vacia] = filasFms(l.columnas);
  assert.deepEqual([a.cd, a.maquina, a.turno], ['La Arenosa', '328', 'A']);
  cerca(a.ofe, 0.25); cerca(a.pCarga, 3 / 8); cerca(a.pMovimiento, 6 / 8); cerca(a.encendido, 8);
  assert.equal(b.pCarga, null); cerca(b.ofe, 0.25); cerca(b.encendido, 6);
  assert.equal(sinLista.cd, '');
  assert.deepEqual([vacia.turno, vacia.encendido, vacia.ofe], ['C', null, null]);
  const o = opcionesOfe(filasFms(l.columnas));
  assert.deepEqual(o.cds, ['Galapa', 'La Arenosa']);
  assert.deepEqual(o.turnos, ['A', 'B', 'C']);
});

test('indicadores de OFE solo con montacargas con CD', () => {
  const filas = filasFms(leerFms(fmsCrudo).columnas);
  const oct = { desde: d('2026-10-01'), hasta: d('2026-10-31') };
  const r = calcularOfe(filas, oct);
  assert.deepEqual([r.tarjetas.filas, r.tarjetas.ralenti, r.tarjetas.carga, r.tarjetas.movimiento, r.tarjetas.encendido, r.tarjetas.maquinas], [3, 2, 3, 9, 14, 2]);
  cerca(r.tarjetas.ofe, 0.25);
  assert.deepEqual(r.sinCd, { filas: 1, forklifts: ['XYZ-NO-EXISTE'] });
  assert.deepEqual(r.porMaquina.map(m => m.maquina), ['328', '571'], 'ordenado por ralentí');
  assert.equal(r.porTurno.find(t => t.turno === 'C')!.ralenti, null);
  assert.equal(calcularOfe(filas, { ...oct, maquinas: ['571'] }).tarjetas.filas, 1);
  assert.equal(calcularOfe(filas, { ...oct, turnos: ['C'] }).tarjetas.ofe, null);
  assert.equal(calcularOfe(filas, { ...oct, cds: ['galapa'] }).tarjetas.maquinas, 1);
});

test('las API de WIP y OFE guardan solo su propio archivo', async () => {
  const filas: { id: string; tipo: string; archivo: string; filas: number; datos: Buffer; creado_en: Date }[] = [];
  const consulta = async (sql: string, params: unknown[] = []) => {
    if (/^(begin|commit|rollback)/.test(sql) || sql.trimStart().startsWith('delete')) return { rows: [] };
    if (sql.trimStart().startsWith('insert')) { const f = { id: `id${filas.length + 1}`, tipo: String(params[0]), archivo: String(params[1]), filas: Number(params[2]), datos: params[5] as Buffer, creado_en: new Date() }; filas.push(f); return { rows: [f] }; }
    if (sql.includes('distinct on')) return { rows: filas.filter(f => (params[0] as string[]).includes(f.tipo)).map(({ id, tipo, archivo, filas: n }) => ({ id, tipo, archivo, filas: n })) };
    if (sql.includes('select id from')) return { rows: filas.filter(f => f.tipo === params[0]).slice(-1) };
    if (sql.includes('encode(datos')) { const f = filas.find(x => x.id === params[0]); return { rows: f ? [{ datos: f.datos.toString('base64') }] : [] }; }
    throw new Error('SQL inesperado: ' + sql);
  };
  const pool = { query: consulta, connect: async () => ({ query: consulta, release() {} }) } as unknown as pg.Pool;
  const sesion = (req: express.Request) => (req.get('x-test-user') ? { sub: 'u1', nombre: 'Operador' } : null);
  const app = express();
  app.use('/api/wip', rutasWip(pool, sesion));
  app.use('/api/ofe', rutasOfe(pool, sesion));
  const server = app.listen(0);
  await new Promise<void>(r => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const h = { 'x-test-user': '1' };
    const wip = gzipSync(JSON.stringify(leerWip(wipCrudo).columnas));
    const fms = gzipSync(JSON.stringify(leerFms(fmsCrudo).columnas));
    const subir = (ruta: string, body: Buffer) => fetch(`${base}/${ruta}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/octet-stream', 'x-archivo': encodeURIComponent('Data WIP.xlsx') }, body });
    assert.equal((await fetch(`${base}/wip/estado`)).status, 401);
    assert.equal((await subir('wip/cargar/fms', fms)).status, 404, 'WIP no acepta el tipo de OFE');
    assert.equal((await subir('wip/cargar/wip', fms)).status, 400, 'archivo cruzado');
    const ok = await subir('wip/cargar/wip', wip);
    assert.equal(ok.status, 201);
    const respuesta = await ok.json();
    assert.deepEqual([respuesta.tipo, respuesta.filas, respuesta.desde, respuesta.hasta], ['wip', 4, '2026-10-20', '2026-11-04']);
    assert.equal((await subir('ofe/cargar/fms', fms)).status, 201);
    assert.deepEqual(Object.keys(await (await fetch(`${base}/wip/estado`, { headers: h })).json()), ['wip']);
    assert.equal((await (await fetch(`${base}/ofe/estado`, { headers: h })).json()).fms.filas, 4);
    assert.equal((await (await fetch(`${base}/ofe/datos/fms`, { headers: h })).json()).tipo, 'fms');
    assert.equal((await fetch(`${base}/ofe/datos/wip`, { headers: h })).status, 404);
  } finally { server.close(); }
});

test('la lista de montacargas se corrige y crece desde la página', () => {
  assert.deepEqual(revisarMontacargas({ chasis: ' 308fgj35-95408 ', cd: 'galapa', placa: ' 999 ' }), { montacargas: { chasis: '308fgj35-95408', cd: 'Galapa', placa: '999' } });
  assert.ok('error' in revisarMontacargas({ chasis: '308FGJ35-95408', cd: 'Bogotá', placa: '1' }), 'CD que no existe');
  assert.ok('error' in revisarMontacargas({ chasis: '<script>', cd: 'Galapa', placa: '1' }));
  assert.ok('error' in revisarMontacargas({ chasis: '308FGJ35-95408', cd: 'Galapa', placa: '' }));
  assert.ok(CDS_FMS.includes('Galapa') && CDS_FMS.includes('UDC Torices'));
  const lista = listaMontacargas([
    { chasis: 'XYZ-no-existe', cd: 'Galapa', placa: '999', usuario_nombre: 'Operador' },
    { chasis: '308FGJ35-35321', cd: 'Turbaco', placa: '328B' },
  ]);
  assert.equal(lista.length, MONTACARGAS.length + 1);
  const corregido = lista.find(m => m.chasis === '308FGJ35-35321')!;
  assert.deepEqual([corregido.origen, corregido.cd, corregido.placa, corregido.original?.cd], ['corregido', 'Turbaco', '328B', 'La Arenosa']);
  assert.equal(lista.at(-1)!.origen, 'agregado');
  const filas = filasFms(leerFms(fmsCrudo).columnas, lista);
  const r = calcularOfe(filas, { desde: d('2026-10-01'), hasta: d('2026-10-31') });
  assert.equal(r.sinCd.filas, 0, 'el chasis agregado ya cuenta');
  assert.equal(r.tarjetas.filas, 4);
  assert.deepEqual(r.porMaquina.map(m => m.maquina).sort(), ['328B', '571', '999']);
  assert.deepEqual(filasFms(leerFms(fmsCrudo).columnas).map(f => f.maquina), ['328', '571', '', '328'], 'sin cambios, la lista original');
});

test('la API guarda, lista y quita montacargas', async () => {
  const tabla = new Map<string, Record<string, unknown>>();
  const consulta = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('from public.ofe_montacargas order by')) return { rows: [...tabla.values()] };
    if (sql.trimStart().startsWith('insert into public.ofe_montacargas')) {
      const fila = { chasis: params[1], cd: params[2], placa: params[3], usuario_nombre: params[5], actualizado_en: new Date().toISOString() };
      tabla.set(String(params[0]), fila); return { rows: [fila] };
    }
    if (sql.trimStart().startsWith('delete from public.ofe_montacargas')) { const ok = tabla.delete(String(params[0])); return { rows: [], rowCount: ok ? 1 : 0 }; }
    throw new Error('SQL inesperado: ' + sql);
  };
  const pool = { query: consulta, connect: async () => ({ query: consulta, release() {} }) } as unknown as pg.Pool;
  const app = express();
  app.use(express.json());
  app.use('/api/ofe', rutasOfe(pool, req => (req.get('x-test-user') ? { sub: 'u1', nombre: 'Operador' } : null)));
  const server = app.listen(0);
  await new Promise<void>(r => server.once('listening', r));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/ofe/montacargas`;
    const h = { 'x-test-user': '1', 'Content-Type': 'application/json' };
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify({ chasis: '308FGJ35-95408', cd: 'Marte', placa: '1' }) })).status, 400);
    assert.equal((await fetch(url, { method: 'PUT', headers: { ...h, 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ chasis: '308FGJ35-95408', cd: 'Galapa', placa: '999' }) })).status, 403);
    const guardado = await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify({ chasis: '308FGJ35-95408', cd: 'galapa', placa: '999' }) });
    assert.equal(guardado.status, 200);
    assert.deepEqual(((await guardado.json()) as { cambio: { cd: string } }).cambio.cd, 'Galapa');
    await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify({ chasis: '308fgj35-95408', cd: 'Galapa', placa: '1000' }) });
    const { cambios } = (await (await fetch(url, { headers: h })).json()) as { cambios: { placa: string }[] };
    assert.deepEqual(cambios.map(c => c.placa), ['1000'], 'el mismo chasis se actualiza, no se repite');
    assert.equal((await fetch(`${url}?chasis=${encodeURIComponent('308FGJ35-95408 ')}`, { method: 'DELETE', headers: h })).status, 200);
    assert.equal((await fetch(`${url}?chasis=308FGJ35-95408`, { method: 'DELETE', headers: h })).status, 404);
  } finally { server.close(); }
});
