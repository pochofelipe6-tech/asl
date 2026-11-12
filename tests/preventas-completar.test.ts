import test from 'node:test';
import assert from 'node:assert/strict';
import { completarDatosPreventas } from '../src/shared/preventas-completar.ts';
import { transformarBase } from '../src/shared/preventas-base.ts';

const fila = (material: string) => [46338, 'TODAS', 'AV30', material, 'Producto', 'CA', '', 70, null, 0, 0, 999, 1, 60, 999, 'TAT', 1, .297, 999, 999, 999, 'Riohacha', '', 0, 0, '', '', '', 0, 'Cervezas', null, null, 0, 0, null];
test('completa por código aunque la referencia esté después y recalcula las fórmulas', () => {
  const sin = fila('NUEVO'); for (const c of [16, 17, 21, 29]) sin[c] = null;
  const otro = fila('OTRO'); otro[16] = 24; otro[17] = .0033;
  const r = completarDatosPreventas([sin, otro, fila('NUEVO')]);
  assert.equal(r[0][16], 1); assert.equal(r[0][17], .297);
  assert.equal(r[0][21], 'Riohacha'); assert.equal(r[0][29], 'Cervezas');
  assert.equal(r[0][31], 46); assert.equal(r[0][30], 'November');
  assert.equal(r[0][18], 17.82); assert.equal(r[0][20], 0);
});
test('busca en catálogo y Fuentes y no copia factores de otro producto', () => {
  const sin = fila('22284'); sin[16] = null; sin[17] = null;
  assert.equal(completarDatosPreventas([sin])[0][18], 17.82);
  sin[3] = 'DESCONOCIDO';
  assert.throws(() => completarDatosPreventas([fila('OTRO'), sin]), /positivos/);
  const fuente = ['DESCONOCIDO', 'Producto', '', 'Cervezas', 12, null, null, null, .0033];
  assert.ok(Math.abs(Number(completarDatosPreventas([sin], [[], fuente])[0][18]) - 2.376) < 1e-10);
});
test('rechaza referencias contradictorias en el mismo Excel', () => {
  const distinta = fila('NUEVO'); distinta[16] = 12;
  assert.throws(() => completarDatosPreventas([fila('NUEVO'), distinta]), /contradictorias/);
});
test('archivo base aprende factores de los Datos existentes usando el corte más reciente', () => {
  const anterior = completarDatosPreventas([fila('NUEVO')])[0];
  const reciente = [...anterior]; reciente[0] = 46339; reciente[16] = 2;
  const header = ['Cond de Exp','Centro','Material','Descripcion','UM','Status','Stock Disp',null,'Cant en transito','Cant entrega Pendien','Total Disponible','Cant de pedidos','Cantidad en Pedidos','Disponible Final',null];
  const base = ['TODAS','AV30','NUEVO','Producto','CA','',70,null,0,0,70,1,60,10,'TAT'];
  const r = transformarBase([header, base], '2026-11-12', [reciente, anterior]);
  assert.equal(r.excluidas.length, 0); assert.equal(r.filas[0][16], 2);
  assert.equal(r.filas[0][18], 35.64);
});

test('Datos recupera referencias históricas aunque Fuentes tenga celdas vacías', () => {
  const sin = fila('NUEVO'); sin[16] = null; sin[17] = 0; sin[21] = null; sin[29] = null;
  const fuente = ['NUEVO', 'Producto', '', '', '', null, null, null, ''];
  const anterior = completarDatosPreventas([fila('NUEVO')])[0];
  const result = completarDatosPreventas([sin], [[], fuente], [anterior])[0];
  assert.equal(result[16], 1); assert.equal(result[17], .297); assert.equal(result[21], 'Riohacha'); assert.equal(result[29], 'Cervezas');
});

test('Datos calcula Factor y HL vacíos a partir del empaque de un material nuevo', () => {
  const sin = fila('NUEVO'); sin[4] = 'POKER LTA 330CC X12'; sin[16] = null; sin[17] = null;
  const result = completarDatosPreventas([sin])[0];
  assert.equal(result[16], 12); assert.equal(result[17], .0033);
  assert.ok(Math.abs(Number(result[18]) - 2.376) < 1e-10);
});
