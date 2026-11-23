import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type pg from 'pg';
import { FORMULARIOS, normalizarRespuestas, preguntasDe, textoRespuesta, ultimoPorCd } from '../src/shared/formularios.ts';
import { rutasFormularios } from '../src/server/formularios.ts';

const formulario = FORMULARIOS[0];
const completas = {
  cd: 'Galapa', estibas_a: '12', estibas_b: '0', estibas_c: 3,
  hl_pendientes_verter: '2,5', isotanques_vacios: '4', isotanques_llenos: '1', necesidad_isotanques: '6',
};

test('el formulario conserva las 13 preguntas del Microsoft Form con claves únicas', () => {
  const ids = preguntasDe(formulario).map(p => p.id);
  assert.equal(ids.length, 13);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(formulario.secciones.map(s => s.titulo), ['Centro De Distribución', 'Información de estibas', 'Información de HL bloqueados', 'Información de cajas plásticas']);
});

test('normaliza números, acepta coma decimal en HL y deja vacías las cajas opcionales', () => {
  const r = normalizarRespuestas(formulario, { ...completas, cajas_330cc_x30: ' 40 ', extra: 'se ignora' });
  assert.equal(r.cd, 'Galapa');
  assert.equal(r.estibas_a, 12);
  assert.equal(r.hl_pendientes_verter, 2.5);
  assert.equal(r.cajas_330cc_x30, 40);
  assert.equal(r.cajas_750cc_x16, null);
  assert.equal('extra' in r, false);
});

test('rechaza respuestas incompletas o fuera de las reglas', () => {
  const sin = (clave: string) => Object.fromEntries(Object.entries(completas).filter(([k]) => k !== clave));
  assert.throws(() => normalizarRespuestas(formulario, sin('cd')), /Seleccione el CD/);
  assert.throws(() => normalizarRespuestas(formulario, sin('estibas_b')), /estibas tipo B/);
  assert.throws(() => normalizarRespuestas(formulario, { ...completas, cd: 'Bogota' }), /no es válida/);
  assert.throws(() => normalizarRespuestas(formulario, { ...completas, estibas_a: '1.5' }), /entero/);
  assert.throws(() => normalizarRespuestas(formulario, { ...completas, isotanques_vacios: '-1' }), /0 o más/);
  assert.throws(() => normalizarRespuestas(formulario, { ...completas, estibas_c: '12abc' }), /número/);
  assert.throws(() => normalizarRespuestas(formulario, { ...completas, cajas_225cc_x38: '2e3' }), /número/);
  assert.throws(() => normalizarRespuestas(formulario, null), /no son válidas/);
});

test('el resumen toma el último reporte de cada CD sin sumar reportes repetidos', () => {
  const r = (id: string, cd: unknown, creado_en: string) => ({ id, creado_en, respuestas: { cd } });
  const registros = [
    r('3', 'Galapa', '2026-11-22T15:00:00Z'),
    r('2', 'Galapa', '2026-11-20T15:00:00Z'),
    r('1', 'Monteria', '2026-11-21T10:00:00Z'),
    r('0', null, '2026-11-23T10:00:00Z'),
  ];
  const actuales = ultimoPorCd(registros);
  assert.deepEqual([...actuales.keys()].sort(), ['Galapa', 'Monteria']);
  assert.equal(actuales.get('Galapa')?.id, '3');
  // Con fecha de corte, el reporte posterior no cuenta y manda el anterior.
  const alCorte = ultimoPorCd(registros, new Date('2026-11-21T00:00:00Z'));
  assert.equal(alCorte.get('Galapa')?.id, '2');
  assert.equal(alCorte.has('Monteria'), false);
});

test('cada parte con varias cantidades tiene nombres cortos para los encabezados', () => {
  for (const seccion of formulario.secciones) for (const p of seccion.preguntas) assert.ok(p.corto || p.titulo.length <= 30, p.id);
});

test('muestra los valores en formato colombiano', () => {
  assert.equal(textoRespuesta(1234.5), '1.234,5');
  assert.equal(textoRespuesta(null), '');
  assert.equal(textoRespuesta('2026-11-23'), '23/11/2026');
});

test('la API exige sesión, valida y guarda la respuesta con el usuario', async () => {
  const guardadas: unknown[][] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('insert into')) {
        guardadas.push(params);
        return { rows: [{ id: 'r1', usuario_nombre: params[3], creado_en: new Date('2026-11-23T15:00:00Z'), respuestas: JSON.parse(String(params[1])) }] };
      }
      return { rows: guardadas.map(p => ({ id: 'r1', usuario_nombre: p[3], creado_en: new Date('2026-11-23T15:00:00Z'), respuestas: JSON.parse(String(p[1])) })) };
    },
  } as unknown as pg.Pool;
  const app = express();
  app.use(express.json());
  app.use('/api/formularios', rutasFormularios(pool, req => req.get('x-test-user') ? { sub: 'u1', nombre: 'Operador' } : null));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://localhost:${(server.address() as { port: number }).port}/api/formularios`;
    const headers = { 'x-test-user': '1', 'Content-Type': 'application/json' };
    const post = (body: unknown) => fetch(`${url}/respuestas`, { method: 'POST', headers, body: JSON.stringify(body) });

    assert.equal((await fetch(`${url}/respuestas?formulario=${formulario.id}`)).status, 401);
    assert.equal((await fetch(`${url}/respuestas?formulario=otro`, { headers })).status, 404);
    assert.equal((await post({ formulario: formulario.id, respuestas: { cd: 'Galapa' } })).status, 400);
    assert.equal(guardadas.length, 0);

    const creada = await post({ formulario: formulario.id, respuestas: completas });
    assert.equal(creada.status, 201);
    assert.deepEqual(guardadas[0].slice(2), ['u1', 'Operador']);
    assert.equal(JSON.parse(String(guardadas[0][1])).hl_pendientes_verter, 2.5);

    const lista = await (await fetch(`${url}/respuestas?formulario=${formulario.id}`, { headers })).json();
    assert.equal(lista.respuestas.length, 1);
    assert.equal(lista.respuestas[0].respuestas.cd, 'Galapa');
    assert.equal(lista.truncado, false);
  } finally {
    server.close();
  }
});
