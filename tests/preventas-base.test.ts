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
  const unknown = [...row]; unknown[2]='99999999';
  const r = transformarBase([header,row,unknown], '2026-11-10');
  assert.equal(r.filas.length,1); assert.equal(r.excluidas.length,1); assert.equal(r.excluidas[0].fila,3);
  assert.throws(()=>transformarBase([header,unknown],'2026-11-10'),/referencias/);
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
