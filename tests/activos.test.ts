import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAJAS, ESTIBAS, cantidadesDe, diaColombia, diasEntre, finDeMes, mesesConConteos, primerDiaConConteos, resumirActivos,
  sumarDias, totalCajas, totalEstibas, totalIsotanques, ultimoDiaConConteos, ultimoPorCdYDia,
} from '../src/shared/activos.ts';
import type { Conteo } from '../src/shared/activos.ts';

/** Conteo de prueba: hora de Colombia (UTC−5) y cantidades (lo que no se indica vale 1). */
function conteo(id: string, cd: string, horaColombia: string, cantidades: Record<string, number | null> = {}): Conteo {
  return {
    id,
    creado_en: new Date(`${horaColombia}:00-05:00`).toISOString(),
    respuestas: {
      cd, estibas_a: 1, estibas_b: 1, estibas_c: 1, hl_pendientes_verter: 1, isotanques_vacios: 1, isotanques_llenos: 1, necesidad_isotanques: 1,
      cajas_330cc_x30: 1, cajas_750cc_x16: 1, cajas_1000cc_x13: 1, cajas_250cc_x38: 1, cajas_225cc_x38: 1, ...cantidades,
    },
  };
}

test('si un CD reporta varias veces el mismo día, cuenta solo el último reporte de ese día', () => {
  const conteos = [
    conteo('1', 'Galapa', '2026-11-26T08:00', { estibas_a: 100 }),
    conteo('2', 'Galapa', '2026-11-26T15:30', { estibas_a: 120 }), // corrección: es la que vale
    conteo('3', 'Galapa', '2026-11-26T11:00', { estibas_a: 999 }),
  ];
  const r = resumirActivos(conteos);
  assert.equal(r.total.estibas_a, 120);
  assert.equal(r.conteos, 1);
  assert.equal(r.repetidos, 2);
  assert.deepEqual(ultimoPorCdYDia(conteos).map(c => c.id), ['2']);
});

test('los reportes de días distintos y de CD distintos sí se suman, como en el Power BI', () => {
  const conteos = [
    conteo('1', 'Galapa', '2026-11-25T09:00', { estibas_a: 10 }),
    conteo('2', 'Galapa', '2026-11-26T09:00', { estibas_a: 20 }),
    conteo('3', 'Turbaco', '2026-11-26T10:00', { estibas_a: 5 }),
  ];
  const r = resumirActivos(conteos);
  assert.equal(r.total.estibas_a, 35);
  assert.equal(r.conteos, 3);
  assert.equal(r.repetidos, 0);
  assert.equal(r.porCd.get('Galapa')?.cantidades.estibas_a, 30);
  assert.equal(r.porCd.get('Galapa')?.conteos, 2);
  assert.equal(r.porDia.get('2026-11-26')?.cantidades.estibas_a, 25);
  assert.equal(r.porDia.get('2026-11-25')?.cantidades.estibas_a, 10);
});

test('el día es el de Colombia: un reporte a las 9 p. m. cuenta para ese día aunque en UTC ya sea el siguiente', () => {
  const noche = conteo('1', 'Galapa', '2026-11-25T21:00', { estibas_a: 7 });
  const manana = conteo('2', 'Galapa', '2026-11-26T06:00', { estibas_a: 9 });
  assert.equal(noche.creado_en.slice(0, 10), '2026-11-26'); // en UTC ya es 26
  assert.equal(diaColombia(noche.creado_en), '2026-11-25');
  // Son días distintos en Colombia: los dos se suman.
  assert.equal(resumirActivos([noche, manana]).total.estibas_a, 16);
  assert.equal(resumirActivos([noche, manana], { desde: '2026-11-26', hasta: '2026-11-26' }).total.estibas_a, 9);
});

test('el orden en que llegan los reportes no cambia el resultado', () => {
  const a = conteo('1', 'Galapa', '2026-11-26T08:00', { hl_pendientes_verter: 3 });
  const b = conteo('2', 'Galapa', '2026-11-26T17:00', { hl_pendientes_verter: 4.5 });
  assert.equal(resumirActivos([a, b]).total.hl_pendientes_verter, 4.5);
  assert.equal(resumirActivos([b, a]).total.hl_pendientes_verter, 4.5);
});

test('las cajas vacías (null) valen 0 y los totales suman lo que dice el Power BI', () => {
  const c = cantidadesDe(conteo('1', 'Galapa', '2026-11-26T08:00', {
    estibas_a: 5, estibas_b: 3, estibas_c: 2,
    cajas_250cc_x38: 10, cajas_330cc_x30: 20, cajas_750cc_x16: null, cajas_1000cc_x13: 40, cajas_225cc_x38: null,
    isotanques_llenos: 4, isotanques_vacios: 6,
  }).respuestas);
  assert.equal(c.cajas_750cc_x16, 0);
  assert.equal(c.cajas_225cc_x38, 0);
  assert.equal(totalEstibas(c), 10);
  assert.equal(totalCajas(c), 70);
  assert.equal(totalIsotanques(c), 10);
  assert.deepEqual(ESTIBAS.map(e => e.corto), ['Tipo A', 'Tipo B', 'Tipo C']);
  assert.deepEqual(CAJAS.map(e => e.nombre), ['Cajas plásticas 250', 'Cajas plásticas 330', 'Cajas plásticas 750', 'Cajas plásticas 1000', 'Cajas plásticas 225']);
});

test('los HL con decimales se suman sin errores de redondeo', () => {
  const conteos = [
    conteo('1', 'Galapa', '2026-11-26T08:00', { hl_pendientes_verter: 0.1 }),
    conteo('2', 'Turbaco', '2026-11-26T08:00', { hl_pendientes_verter: 0.2 }),
  ];
  assert.equal(resumirActivos(conteos).total.hl_pendientes_verter, 0.3);
});

test('el filtro de fechas incluye los dos extremos y el filtro de CD deja solo ese CD', () => {
  const conteos = [
    conteo('1', 'Galapa', '2026-11-20T08:00', { estibas_b: 1 }),
    conteo('2', 'Galapa', '2026-11-22T08:00', { estibas_b: 2 }),
    conteo('3', 'Galapa', '2026-11-24T08:00', { estibas_b: 4 }),
    conteo('4', 'Turbaco', '2026-11-22T08:00', { estibas_b: 8 }),
  ];
  assert.equal(resumirActivos(conteos, { desde: '2026-11-22', hasta: '2026-11-24' }).total.estibas_b, 14);
  assert.equal(resumirActivos(conteos, { desde: '2026-11-22', hasta: '2026-11-24', cd: 'Galapa' }).total.estibas_b, 6);
  assert.equal(resumirActivos(conteos, { desde: '2026-11-25' }).conteos, 0);
  assert.equal(resumirActivos(conteos, { hasta: '2026-11-20' }).total.estibas_b, 1);
});

test('reportes sin CD o con fecha inválida no cuentan', () => {
  const sinCd = conteo('1', '', '2026-11-26T08:00', { estibas_a: 50 });
  const malaFecha = { ...conteo('2', 'Galapa', '2026-11-26T08:00', { estibas_a: 60 }), creado_en: 'no es fecha' };
  const bueno = conteo('3', 'Turbaco', '2026-11-26T08:00', { estibas_a: 5 });
  const r = resumirActivos([sinCd, malaFecha, bueno]);
  assert.equal(r.total.estibas_a, 5);
  assert.equal(r.conteos, 1);
});

test('último y primer día con conteos, también por CD', () => {
  const conteos = [
    conteo('1', 'Galapa', '2026-11-20T08:00'),
    conteo('2', 'Turbaco', '2026-11-25T23:30'),
    conteo('3', 'Galapa', '2026-10-31T10:00'),
  ];
  assert.equal(ultimoDiaConConteos(conteos), '2026-11-25');
  assert.equal(ultimoDiaConConteos(conteos, 'Galapa'), '2026-11-20');
  assert.equal(ultimoDiaConConteos(conteos, 'Fonseca'), null);
  assert.equal(ultimoDiaConConteos([]), null);
  assert.equal(primerDiaConConteos(conteos), '2026-10-31');
  assert.deepEqual(mesesConConteos(conteos), ['2026-11', '2026-10']);
});

test('ayudas de días: sumar, recorrer un rango y fin de mes', () => {
  assert.equal(sumarDias('2026-11-30', 1), '2026-12-01');
  assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(diasEntre('2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(diasEntre('2026-11-29', '2026-11-28'), []);
  assert.equal(finDeMes('2026-02'), '2026-02-28');
  assert.equal(finDeMes('2028-02'), '2028-02-29');
  assert.equal(finDeMes('2026-12'), '2026-12-31');
});
