import assert from 'node:assert/strict';
import test from 'node:test';
import { COLUMNAS_BAJAS, ESQUEMA_BAJAS, calcularBajas, esEncabezadoBajas, filasBajas, leerBajas, motivoDe, opcionesBajas, validarColumnasBajas } from '../src/shared/bajas.ts';
import type { ColumnasBajas } from '../src/shared/bajas.ts';
import { diaDeIso } from '../src/shared/t1.ts';
import { combinarColumnas } from '../src/server/cargas.ts';

const d = diaDeIso;
/** Una fila como la exporta SAP (21 columnas). */
const fila = (ce: string, nombre: string, cmv: string, clase: string, material: string, desc: string, fecha: unknown, cantidad: number, importe: number, doc = '63') =>
  [ce, nombre, cmv, material, desc, 'AG', '1001', '0001', '10:00:00', clase, 'BAJAS OBSOLES', '', doc, 'S753', 'COAV', 'CO0001', fecha, cantidad, 'UN', importe, fecha];
const octubre = [
  [...COLUMNAS_BAJAS],
  fila('AV76', 'CD Galapa', '965', 'BajasExcepcional.PT', '22269', 'AZTECA LATA 310CC X6', d('2026-10-26'), -100, -1_000_000, '6301'),
  fila('AV76', 'CD Galapa', '966', 'AnuBajasExcepcion.PT', '22269', 'AZTECA LATA 310CC X6', d('2026-10-27'), 20, 200_000, '6302'),
  fila('AV10', 'CD Turbaco', '971', 'Rot.y Falt.en Transp', '7584', 'Aguila Lig Lta 269cc X 6.', d('2026-10-26'), -50, -400_000, '6303'),
  fila('AV10', 'CD Turbaco', '971', 'Rot.y Falt.en Transp', '3500005', 'Envase Costeñita 175R', d('2026-10-27'), -300, 0, '6304'),
  fila('AV10', 'CD Turbaco', '701', 'EM Invent.almacén', '7584', 'Aguila Lig Lta 269cc X 6.', d('2026-10-28'), 10, 80_000, '6305'),
  // La fecha también puede venir como fecha (medianoche de Colombia = 05:00 UTC).
  fila('AV99', 'CD Nuevo', '999', 'Movimiento raro', '1', 'Material X', new Date('2026-10-29T05:00:16Z'), -1, -10_000, '6306'),
  [null, null, null],
];
const septiembre = [
  [...COLUMNAS_BAJAS],
  fila('AV76', 'CD Galapa', '945', 'Bajas cargo a Deposi', '22269', 'AZTECA LATA 310CC X6', d('2026-09-15'), -10, -500_000, '6201'),
];

test('lee el Excel de bajas de SAP y valida lo que llega al servidor', () => {
  assert.ok(esEncabezadoBajas(COLUMNAS_BAJAS));
  assert.ok(!esEncabezadoBajas(['Fecha', 'CD']));
  assert.throws(() => leerBajas([['Otra', 'cosa']]), /columnas de bajas/);
  const l = leerBajas(octubre);
  assert.equal(l.filas, 6);
  assert.deepEqual([l.desde, l.hasta], [d('2026-10-26'), d('2026-10-29')], 'la fecha tipo Date se toma en hora de Colombia');
  assert.equal(validarColumnasBajas(l.columnas), null);
  assert.match(validarColumnasBajas({ ...l.columnas, tipo: 'wip' })!, /tipo/);
  assert.match(validarColumnasBajas({ ...l.columnas, centro: [99, 0, 0, 0, 0, 0] })!, /centro/);
});

test('motivos netos, anulaciones, ajustes y cruce del centro con el CD y la gerencia', () => {
  assert.deepEqual(motivoDe('972'), { motivo: '971', nombre: 'Rotura y faltante en transporte', grupo: 'transporte', anulacion: true });
  const filas = filasBajas(leerBajas(octubre).columnas);
  const [baja, anulacion, , envase, ajuste, desconocido] = filas;
  assert.deepEqual([baja.cd, baja.gerencia, baja.ol, baja.valor, baja.unidades], ['Galapa', 'Barranquilla', 'ASL', 1_000_000, 100]);
  assert.deepEqual([anulacion.motivo, anulacion.anulacion, anulacion.valor], ['965', true, -200_000], 'la anulación resta de su baja');
  assert.deepEqual([envase.valor, envase.unidades], [0, 300], 'los envases suman unidades, no pesos');
  assert.deepEqual([ajuste.grupo, ajuste.valor], ['ajustes', -80_000], 'una entrada de inventario reduce las bajas');
  assert.deepEqual([desconocido.cd, desconocido.gerencia, desconocido.grupo, desconocido.nombreMotivo], ['CD Nuevo', '', 'otros', 'Movimiento raro']);

  const r = calcularBajas(filas);
  assert.equal(r.tarjetas.valor, 1_000_000 - 200_000 + 400_000 + 0 - 80_000 + 10_000);
  assert.equal(r.tarjetas.anulado, 200_000);
  assert.equal(r.tarjetas.movimientos, 6);
  assert.deepEqual(r.porMotivo.map(m => [m.nombre, m.valor]), [['Bajas excepcionales PT', 800_000], ['Rotura y faltante en transporte', 400_000], ['Movimiento raro', 10_000], ['Ajuste de inventario en almacén', -80_000]]);
  assert.deepEqual(r.porCd.map(c => [c.cd, c.valor]), [['Galapa', 800_000], ['Turbaco', 320_000], ['CD Nuevo', 10_000]]);
  assert.deepEqual(r.materiales[0], { material: '22269', descripcion: 'AZTECA LATA 310CC X6', valor: 800_000, unidades: 80, movimientos: 2 });

  // Filtros: CD y motivo; el rango de fechas no cambia la tendencia mensual ni el mapa.
  assert.equal(calcularBajas(filas, { cds: ['Turbaco'] }).tarjetas.valor, 320_000);
  assert.equal(calcularBajas(filas, { motivos: ['965'] }).tarjetas.valor, 800_000);
  const unDia = calcularBajas(filas, { desde: d('2026-10-26'), hasta: d('2026-10-26') });
  assert.equal(unDia.tarjetas.valor, 1_400_000);
  assert.equal(unDia.mensual[0].total, r.tarjetas.valor, 'la tendencia mensual muestra todo el mes');
  assert.equal(unDia.mapa.regionalTotal, r.tarjetas.valor);
  assert.deepEqual(opcionesBajas(filas).cds, ['CD Nuevo', 'Galapa', 'Turbaco']);
});

test('dos meses se juntan sin perder nada (como en el servidor)', () => {
  const oct = leerBajas(octubre), sep = leerBajas(septiembre);
  const juntos = combinarColumnas(ESQUEMA_BAJAS, sep.columnas as unknown as Record<string, unknown>, sep.columnas.fecha, oct.columnas as unknown as Record<string, unknown>, oct.columnas.fecha) as unknown as ColumnasBajas;
  assert.equal(validarColumnasBajas(juntos), null);
  const filas = filasBajas(juntos);
  assert.equal(filas.length, 7);
  const r = calcularBajas(filas);
  assert.deepEqual(r.mensual.map(m => [m.mes, m.total]), [['2026-09', 500_000], ['2026-10', 1_130_000]]);
  assert.deepEqual(r.mapa.valores[r.mapa.cds.indexOf('Galapa')], [500_000, 800_000]);
});
