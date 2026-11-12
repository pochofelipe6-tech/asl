import test from 'node:test';
import assert from 'node:assert/strict';
import { conversionPresentacion } from '../src/shared/preventas-presentacion.ts';

test('convierte volumen y unidades explícitos sin depender del código del material', () => {
  assert.deepEqual(conversionPresentacion('Poker Lta 330cc X 6'), {factor:6,hl:.0033});
  assert.deepEqual(conversionPresentacion('Pony Malta Pet 1,5LX 6'), {factor:6,hl:.015});
  assert.deepEqual(conversionPresentacion('BBC LAGER BR 29.7L X1'), {factor:1,hl:.297});
  assert.deepEqual(conversionPresentacion('Electrolit Fresa 625mlx3und'), {factor:3,hl:.00625});
});

test('no asigna factores a presentaciones incompletas, ambiguas o no líquidas', () => {
  for (const descripcion of ['Producto', 'Poker Lta 330cc', 'COMBO 700ML X1 + 200ML X1', 'Poker 330CC X6 X4', 'Quipitos 8g x24', '330cc X0']) assert.equal(conversionPresentacion(descripcion), undefined);
});
