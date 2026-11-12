import test from 'node:test';
import assert from 'node:assert/strict';
import { esBase, transformarBase } from '../src/shared/preventas-base.ts';
const header = ['Cond de Exp','Centro','Material','Descripcion','UM','Status','Stock Disp',null,'Cant en transito','Cant entrega Pendien','Total Disponible','Cant de pedidos','Cantidad en Pedidos','Disponible Final',null];
const row = ['TODAS','AV10','1428','Poker Lta 330cc X 6','SXP','',111,null,0,8,999,7,132,999,'TAT'];
test('base: completa referencias y recalcula cantidades, fecha y llaves', () => {
  const r = transformarBase([header,row], '2026-11-10'); const f = r.filas[0];
  assert.equal(f[0],46336); assert.equal(f[11],103); assert.equal(f[14],-29);
  assert.equal(f[16],6); assert.equal(f[17],.0033); assert.equal(f[21],'Turbaco');
  assert.equal(f[22],'AV10142846336'); assert.equal(f[31],46);
  assert.ok(Math.abs(Number(f[20])-.5742)<1e-10);
});
test('base: no inventa referencias ni descarta filas silenciosamente', () => {
  const unknown = [...row]; unknown[2]='99999999'; unknown[3]='Producto sin presentación';
  const resultado = transformarBase([header,row,unknown], '2026-11-10');
  assert.equal(resultado.filas.length, 1);
  assert.equal(resultado.excluidas.length, 1);
  assert.equal(resultado.excluidas[0].material, '99999999');
  assert.throws(()=>transformarBase([header,unknown],'2026-11-10'),/referencias/);
});

test('base: permite cargar las filas válidas e informa centros y materiales pendientes', () => {
  const historico = [...row]; historico[2] = '21662'; historico[3] = 'Electrolit Maracuya 625mlx3und';
  const resultado = transformarBase([header, row, historico], '2026-11-12');
  assert.equal(resultado.filas.length, 1);
  assert.equal(resultado.excluidas.length, 1);
  const centroNuevo = [...row]; centroNuevo[1] = 'NUEVO';
  const centro = transformarBase([header, row, centroNuevo], '2026-11-12');
  assert.equal(centro.filas.length, 1);
  assert.match(centro.excluidas[0].motivo, /Centro NUEVO sin referencia/);
  historico[1] = 'NUEVO';
  assert.equal(transformarBase([header, row, historico], '2026-11-12').excluidas.length, 1);
});

test('base: incorpora el barril de Riohacha y el shrinkpack de Montería', () => {
  const barril = ['TODAS', 'AV30', '22284', 'BBC LAGER BR 29.7L X1', 'BRL', '', 70, null, 0, 0, 70, 1, 60, 10, 'TAT'];
  const lata = ['TODAS', 'AV39', '22256', 'POKER LTA 330CC X12 SHRINKPACK', 'DCP', '@08@', 5056, null, 0, 0, 5056, 1, 2, 5054, 'TAT'];
  const resultado = transformarBase([header, barril, lata], '2026-11-12');
  assert.equal(resultado.excluidas.length, 0);
  assert.equal(resultado.filas.length, 2);
  assert.equal(resultado.filas[0][21], 'Riohacha');
  assert.ok(Math.abs(Number(resultado.filas[0][18]) - 17.82) < 1e-10);
  assert.ok(Math.abs(Number(resultado.filas[1][18]) - .0792) < 1e-10);
  assert.equal(resultado.filas[0][20], 0);
  assert.equal(resultado.filas[1][20], 0);
});
test('base: rechaza fecha ausente, esquema incorrecto y números inválidos', () => {
  assert.equal(esBase(['Personal']),false);
  assert.throws(()=>transformarBase([header,row],''),/fecha/);
  assert.throws(()=>transformarBase([header,row],'2026-02-30'),/existe/);
  const bad=[...row];bad[6]='abc'; assert.throws(()=>transformarBase([header,bad],'2026-11-10'),/numérico/);
});

test('base: usa las referencias del corte conciliado del 11/11/2026', () => {
  // Valores de Datos en Stock Disp Regional Norte Base - copia.xlsx.
  const referencias = [
    ['22102', 6, .00269],
    ['21159', 4, .00269],
    ['22271', 6, .0031],
    ['5630', 6, .00473],
  ] as const;
  const entradas = referencias.map(([material]) => {
    const entrada = [...row]; entrada[2] = material; entrada[6] = 0;
    entrada[9] = 0; entrada[12] = 100;
    return entrada;
  });
  const resultado = transformarBase([header, ...entradas], '2026-11-11');
  assert.equal(resultado.excluidas.length, 0);
  assert.equal(resultado.filas.length, 4);
  referencias.forEach(([material, factor, hl], i) => {
    const f = resultado.filas[i];
    assert.equal(f[3], material); assert.equal(f[16], factor); assert.equal(f[17], hl);
    assert.ok(Math.abs(Number(f[18]) - 100 * factor * hl) < 1e-10);
  });
});

test('base: recupera Barranquilla y el inventario omitido en planta del corte 13', () => {
  const corona = ['TODAS', 'AV03', 17155, 'CORONA EXTRA 269 LTA X6 REM', 'SXP', '', 0, null, 0, 0, 549, 1, 100, 449, 'TAT'];
  const costena = ['TODAS', 'AV03', 22102, 'COSTEÑA BACANA LTA 269CC X6', 'SXP', '', 0, null, 0, 0, 0, 1, 50, -50, 'TAT'];
  const result = transformarBase([header, corona, costena], '2026-11-13');
  assert.equal(result.excluidas.length, 0);
  assert.equal(result.filas[0][21], 'Barranquilla');
  assert.equal(result.filas[0][8], 549);
  assert.equal(result.filas[0][11], 549);
  assert.equal(result.filas[0][20], 0);
  assert.ok(Math.abs(Number(result.filas[1][20]) - .807) < 1e-10);
  assert.ok(Math.abs(result.filas.reduce((s, f) => s + Number(f[18]), 0) - 2.421) < 1e-10);
});

test('base: calcula factores de una referencia nueva a partir de su presentación', () => {
  const nuevo = [...row]; nuevo[2] = '99999999'; nuevo[3] = 'POKER LTA 330CC X12';
  const result = transformarBase([header, nuevo], '2026-11-13');
  assert.equal(result.excluidas.length, 0);
  assert.equal(result.completadas.length, 1);
  assert.equal(result.filas[0][16], 12);
  assert.equal(result.filas[0][17], .0033);
  assert.equal(result.filas[0][29], 'Cervezas');
});
