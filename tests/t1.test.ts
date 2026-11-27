import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { gzipSync } from 'node:zlib';
import { baseFalsa } from './base-cargas-falsa.ts';
import { combinarColumnas } from '../src/server/cargas.ts';
import {
  calcularT1, cdDeUbicacion, diaDeIso, filasAtct, filasEspera, horasATexto, leerAtct, leerEspera, minutosDelDia, minutosIngreso,
  opcionesT1, semanaDe, tipoDeEncabezado, turnoDe, validarColumnas, COLUMNAS_ATCT, COLUMNAS_ESPERA,
} from '../src/shared/t1.ts';
import { rutasT1 } from '../src/server/t1.ts';

const dia = (iso: string) => diaDeIso(iso);
const hora = (h: number, m: number) => (h * 60 + m) / 1440;
// Filas crudas como las entrega la hoja "Export" de cada Excel.
const atctCrudo = [
  [...COLUMNAS_ATCT],
  [dia('2026-11-02'), '1', 'AAA111', 'GALAPA', 'Zona de atención', '11/2/2026 7:10:00 AM', '11/2/2026 8:40:00 AM', 0, hora(1, 30)],
  [dia('2026-11-02'), '2', 'BBB222', 'GALAPA', 'Zona de atención', '11/2/2026 3:00:00 PM', '11/2/2026 4:00:00 PM', 0, hora(1, 0)],
  [dia('2026-11-02'), '3', 'CCC333', 'MONTERIA', 'Zona de atención', '11/2/2026 11:30:00 PM', '11/3/2026 2:00:00 AM', 0, 1 + hora(2, 30)],
  [dia('2026-11-02'), '4', 'AAA111', 'GALAPA', 'Zona de espera', '11/2/2026 6:00:00 AM', '11/2/2026 7:10:00 AM', 0, hora(1, 10)],
  [dia('2026-11-03'), '5', 'DDD444', 'MONTERIA', 'Zona de atención', '11/3/2026', '11/3/2026 1:00:00 AM', 0, hora(1, 0)],
];
const esperaCruda = [
  [...COLUMNAS_ESPERA],
  ['AAA111', dia('2026-11-02') + hora(6, 0), dia('2026-11-02') + hora(5, 30), dia('2026-11-02') + hora(7, 0), dia('2026-11-02') + hora(8, 0), '00:30', '01:00', '01:30', 'Galapa'],
  ['ZZZ999', dia('2026-11-02') + hora(6, 0), dia('2026-11-02') + hora(5, 0), dia('2026-11-02') + hora(7, 0), dia('2026-11-02') + hora(8, 0), '01:00', '01:00', '02:00', 'Barranquilla'],
  ['CCC333', dia('2026-11-02') + hora(20, 0), dia('2026-11-02') + hora(21, 0), dia('2026-11-02') + hora(23, 0), dia('2026-11-03') + hora(1, 0), '02:00', '02:00', '04:00', 'Montería'],
];
const datos = () => ({ atct: filasAtct(leerAtct(atctCrudo).columnas), espera: filasEspera(leerEspera(esperaCruda).columnas) });

test('reconoce los dos Excel por su encabezado', () => {
  assert.equal(tipoDeEncabezado(COLUMNAS_ATCT), 'atct');
  assert.equal(tipoDeEncabezado(['placa', 'HORA PROGRAMADA', 'Enturnamiento', 'Inicio cargue/descargue', 'Fin cargue/descargue', 'Espera', 'Atencion', 'FTCT', 'UBI']), 'espera');
  assert.equal(tipoDeEncabezado(['Fecha', 'Placa']), null);
  assert.throws(() => leerAtct([['Otra', 'cosa']]), /columnas de ATCT/);
});

test('horas, turnos, semanas y CD con las reglas del Power BI', () => {
  assert.equal(minutosDelDia(1 + hora(2, 30)), 150, 'hh:mm toma solo la hora del día, no los días');
  assert.equal(minutosDelDia('23:54'), 1434);
  assert.equal(minutosIngreso('1/1/2026 2:30:44 PM'), 870);
  assert.equal(minutosIngreso('11/8/2026'), 0, 'sin hora = medianoche');
  assert.deepEqual([turnoDe(359), turnoDe(360), turnoDe(839), turnoDe(840), turnoDe(1319), turnoDe(1320)], ['C', 'A', 'A', 'B', 'B', 'C']);
  assert.equal(semanaDe(dia('2026-01-01')), 1);
  assert.equal(semanaDe(dia('2026-01-04')), 2, 'la semana empieza el domingo');
  assert.equal(semanaDe(dia('2026-11-25')), 48);
  assert.equal(cdDeUbicacion('SANTA MARTA'), 'Santa Marta');
  assert.equal(cdDeUbicacion('Cartagena'), 'Cartagena Ka');
  assert.equal(cdDeUbicacion('Barranquilla'), '', 'no está en la tabla Gerencias');
  assert.equal(horasATexto(1.4166667), '1:25');
});

test('tarjetas y gráficos: zona de atención, espera por CD y FTCT', () => {
  const d = datos();
  const r = calcularT1(d, { desde: dia('2026-11-01'), hasta: dia('2026-11-30') });
  assert.equal(r.tarjetas.vehiculos, 4, 'solo la zona de atención');
  assert.equal(r.tarjetas.atencion, (1.5 + 1 + 2.5 + 1) / 4);
  // Sin filtros de ATCT, la espera toma todas sus filas (también la de Barranquilla, que no tiene CD).
  assert.equal(r.tarjetas.espera, (0.5 + 1 + 2) / 3);
  // El FTCT usa la zona de atención: la espera se limita a los CD que tienen atención (Galapa y Monteria).
  assert.equal(r.tarjetas.ftct, (1.5 + 1 + 2.5 + 1) / 4 + (0.5 + 2) / 2);
  const galapa = r.porCd.find(c => c.cd === 'Galapa')!;
  assert.equal(galapa.atencion, 1.25);
  assert.equal(galapa.espera, 0.5);
  assert.deepEqual(r.porTurno.map(t => [t.turno, t.atencion]), [['A', 1.5], ['B', 1], ['C', 1.75]]);
  assert.equal(r.porTurno.find(t => t.turno === 'C')!.espera, 2, 'turno C solo tiene Monteria');
  assert.equal(r.exclusionesAtencion.length, 2, 'mayores que 1,41 h');
  assert.equal(r.exclusionesEspera.length, 3, 'mayores que 0,41 h (sin filtros de ATCT, todas las filas de espera)');
  assert.deepEqual(r.mapaAtencion.cds, ['Galapa', 'Monteria']);
  assert.equal(r.mapaEspera.valores[1][r.mapaEspera.fechas.indexOf(dia('2026-11-02'))], 2);
  assert.equal(r.porSemana[0].atencion, (1.5 + 1 + 2.5 + 1.1666666666666667 + 1) / 5, 'la tendencia semanal incluye todas las zonas');
});

test('un filtro de CD limita también la espera', () => {
  const r = calcularT1(datos(), { cds: ['galapa'] });
  assert.equal(r.tarjetas.vehiculos, 2);
  assert.equal(r.tarjetas.espera, 0.5);
  const o = opcionesT1(datos());
  assert.deepEqual(o.cds, ['Galapa', 'Monteria']);
  assert.equal(o.ultimaEspera, dia('2026-11-02'));
});

test('la tendencia mensual no depende del rango de fechas', () => {
  const r = calcularT1(datos(), { desde: dia('2026-12-01'), hasta: dia('2026-12-31') });
  assert.equal(r.tarjetas.vehiculos, 0);
  assert.equal(r.mensual.length, 1);
  assert.equal(r.mensual[0].mes, '2026-11');
});

test('valida lo que llega al servidor', () => {
  const { columnas } = leerAtct(atctCrudo);
  assert.equal(validarColumnas(columnas, 'atct'), null);
  assert.match(validarColumnas(columnas, 'espera')!, /tipo/);
  assert.match(validarColumnas({ ...columnas, placa: [99, 0, 0, 0, 0] }, 'atct')!, /índices/);
  assert.match(validarColumnas({ ...columnas, minutos: [1, 2] }, 'atct')!, /minutos/);
});


/** Levanta las rutas en un puerto libre; devuelve la dirección y cómo cerrarlo. */
async function levantar(base: ReturnType<typeof baseFalsa>) {
  const app = express();
  app.use('/api/t1', rutasT1(base.pool, req => (req.get('x-test-user') ? { sub: 'u1', nombre: 'Operador' } : null)));
  const server = app.listen(0);
  await new Promise<void>(r => server.once('listening', r));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/api/t1`, cerrar: () => server.close() };
}
const h = { 'x-test-user': '1' };
const subirA = (url: string, tipo: string, body: Buffer, archivo: string) => fetch(`${url}/cargar/${tipo}`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/octet-stream', 'x-t1-archivo': encodeURIComponent(archivo) }, body });
const comprimir = (crudo: unknown[][]) => gzipSync(JSON.stringify(leerAtct(crudo).columnas));

test('la API guarda cargas comprimidas y entrega los datos', async () => {
  const base = baseFalsa();
  const { url, cerrar } = await levantar(base);
  try {
    assert.equal((await fetch(`${url}/estado`)).status, 401);
    const cuerpo = comprimir(atctCrudo);
    assert.equal((await subirA(url, 'espera', cuerpo, 'ATCT nov.xlsx')).status, 400, 'tipo cruzado');
    assert.equal((await subirA(url, 'atct', Buffer.from('no es gzip'), 'ATCT nov.xlsx')).status, 400);
    const ok = await subirA(url, 'atct', cuerpo, 'ATCT nov.xlsx');
    assert.equal(ok.status, 201);
    assert.deepEqual(await ok.json(), {
      tipo: 'atct', archivo: 'ATCT nov.xlsx', filas: 5, desde: '2026-11-02', hasta: '2026-11-03', creado_en: base.cargas[0].creado_en.toISOString(),
      total: { filas: 5, desde: '2026-11-02', hasta: '2026-11-03' },
    });
    const estado = await (await fetch(`${url}/estado`, { headers: h })).json();
    assert.deepEqual([estado.atct.archivo, estado.atct.filas, estado.atct.cargas], ['ATCT nov.xlsx', 5, 1]);
    assert.equal(estado.espera, null);
    const datosRecibidos = await (await fetch(`${url}/datos/atct`, { headers: h })).json();
    assert.equal(datosRecibidos.fecha.length, 5, 'el navegador recibe el JSON descomprimido');
    assert.equal(base.estado.pedidasJuntado, 0, 'lo recién subido sale de la memoria del servidor, sin volver a pedirlo');
    assert.equal((await fetch(`${url}/datos/espera`, { headers: h })).status, 404);
  } finally { cerrar(); }
});

test('cada archivo llena sus fechas y nada se borra', async () => {
  // Sin la tabla de lo juntado: el servidor la crea sola.
  const base = baseFalsa({ conTablaJuntado: false });
  const { url, cerrar } = await levantar(base);
  // El archivo del día: corrige el 3 de noviembre (otra placa) y agrega el 4.
  const delDia = [
    [...COLUMNAS_ATCT],
    [dia('2026-11-03'), '9', 'EEE555', 'MONTERIA', 'Zona de atención', '11/3/2026 9:00:00 AM', '11/3/2026 10:00:00 AM', 0, hora(1, 0)],
    [dia('2026-11-04'), '10', 'FFF666', 'GALAPA', 'Zona de atención', '11/4/2026 9:00:00 AM', '11/4/2026 11:00:00 AM', 0, hora(2, 0)],
  ];
  const placas = (c: ReturnType<typeof leerAtct>['columnas']) => filasAtct(c).map(f => `${f.fecha - dia('2026-11-01') + 1}:${f.placa}`);
  try {
    assert.equal((await subirA(url, 'atct', comprimir(atctCrudo), 'ATCT histórico.xlsx')).status, 201);
    assert.ok(base.estado.tablaJuntado, 'la tabla se creó');
    const ok = await subirA(url, 'atct', comprimir(delDia), 'ATCT 4 nov.xlsx');
    assert.deepEqual((await ok.json()).total, { filas: 6, desde: '2026-11-02', hasta: '2026-11-04' });
    const juntos = await (await fetch(`${url}/datos/atct`, { headers: h })).json();
    assert.equal(validarColumnas(juntos, 'atct'), null, 'lo juntado sigue siendo una carga válida');
    assert.deepEqual(placas(juntos), ['2:AAA111', '2:BBB222', '2:CCC333', '2:AAA111', '3:EEE555', '4:FFF666'], 'el 2 se conserva, el 3 se reemplaza, el 4 se suma');
    assert.equal(base.cargas.length, 2, 'los dos archivos quedan guardados');
    assert.equal(base.estado.borrados, 0, 'no se borra ninguna carga');
    const estado = await (await fetch(`${url}/estado`, { headers: h })).json();
    assert.deepEqual([estado.atct.archivo, estado.atct.filas, estado.atct.desde, estado.atct.hasta, estado.atct.cargas], ['ATCT 4 nov.xlsx', 6, '2026-11-02', '2026-11-04', 2]);
  } finally { cerrar(); }

  // Otro servidor (sin memoria) y sin lo juntado: se rehace con todas las cargas guardadas, de la más vieja a la más nueva.
  base.juntado.clear();
  const otro = await levantar(base);
  try {
    const estado = await (await fetch(`${otro.url}/estado`, { headers: h })).json();
    assert.deepEqual([estado.atct.filas, estado.atct.desde, estado.atct.hasta], [6, '2026-11-02', '2026-11-04']);
    assert.deepEqual(placas(await (await fetch(`${otro.url}/datos/atct`, { headers: h })).json()), ['2:AAA111', '2:BBB222', '2:CCC333', '2:AAA111', '3:EEE555', '4:FFF666']);
  } finally { otro.cerrar(); }
});

test('al juntar no se pierde ninguna columna', () => {
  const esquema = { filas: ['fecha'] };
  const base = { tipo: 'x', version: 1, fecha: [1] };
  assert.deepEqual(combinarColumnas(esquema, base, [1], { tipo: 'x', version: 1, fecha: [2] }, [2]), { tipo: 'x', version: 1, fecha: [1, 2] });
  assert.throws(() => combinarColumnas(esquema, { ...base, otra: [5] }, [1], base, [1]), /otra/);
});

test('ESPERA también se junta por fecha', async () => {
  const base = baseFalsa();
  const { url, cerrar } = await levantar(base);
  const gz = (crudo: unknown[][]) => gzipSync(JSON.stringify(leerEspera(crudo).columnas));
  try {
    assert.equal((await subirA(url, 'espera', gz(esperaCruda), 'ESPERA.xlsx')).status, 201);
    // Un archivo del 3 de noviembre: el 2 (tres filas) se conserva.
    const del3 = [[...COLUMNAS_ESPERA], ['GGG777', dia('2026-11-03') + hora(6, 0), dia('2026-11-03') + hora(5, 0), dia('2026-11-03') + hora(7, 0), dia('2026-11-03') + hora(8, 0), '01:00', '01:00', '02:00', 'Galapa']];
    assert.deepEqual((await (await subirA(url, 'espera', gz(del3), 'ESPERA 3 nov.xlsx')).json()).total, { filas: 4, desde: '2026-11-02', hasta: '2026-11-03' });
    const juntos = await (await fetch(`${url}/datos/espera`, { headers: h })).json();
    assert.equal(validarColumnas(juntos, 'espera'), null);
    assert.deepEqual(filasEspera(juntos).map(f => f.placa), ['AAA111', 'ZZZ999', 'CCC333', 'GGG777']);
  } finally { cerrar(); }
});

test('mapa de calor: fila Regional y columna MTD como los totales del Power BI', () => {
  const m = calcularT1(datos(), { desde: dia('2026-11-01'), hasta: dia('2026-11-30') }).mapaAtencion;
  assert.deepEqual(m.cds, ['Galapa', 'Monteria']);
  // Regional del 2/11: todas las filas del día (1,5 + 1 + 2,5) / 3, no el promedio de los promedios de cada CD.
  assert.equal(m.regional[m.fechas.indexOf(dia('2026-11-02'))], (1.5 + 1 + 2.5) / 3);
  assert.equal(m.regional[m.fechas.indexOf(dia('2026-11-03'))], 1);
  assert.deepEqual(m.mtd, [1.25, (2.5 + 1) / 2], 'MTD: todo el rango de cada CD');
  assert.equal(m.mtdRegional, (1.5 + 1 + 2.5 + 1) / 4, 'en la esquina, todo junto');
});
