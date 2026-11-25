import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import type pg from 'pg';
import { CENTROS_DESTINO, ID_SOLICITUDES, MATERIALES, buscarCentro, leerCantidad, revisarSolicitud } from '../src/shared/solicitudes.ts';
import { rutasSolicitudes } from '../src/server/solicitudes.ts';

test('cada centro tiene su solicitante, según la lista del usuario', () => {
  assert.equal(CENTROS_DESTINO.length, 15);
  assert.equal(new Set(CENTROS_DESTINO.map(c => c.codigo)).size, 15);
  const de = (codigo: string) => buscarCentro(codigo)?.solicitante;
  assert.equal(de('AV74'), 'Piedad Santiago');
  assert.equal(de('AV10'), 'Camilo Tatis');
  assert.equal(de('AV11'), 'Victor Villa');
  assert.deepEqual(['AV12', 'AV36', 'AV38'].map(de), ['Eduardo Diaz', 'Eduardo Diaz', 'Eduardo Diaz']);
  assert.deepEqual(['AV39', 'AV40'].map(de), ['Jose Acosta', 'Jose Acosta']);
  assert.deepEqual(['AV13', 'AV32'].map(de), ['Jesús Alfonso Iriarte', 'Jesús Alfonso Iriarte']);
});

test('el catálogo trae los 44 materiales de la base, cada uno con su descripción', () => {
  const codigos = Object.keys(MATERIALES);
  assert.equal(codigos.length, 44);
  for (const codigo of codigos) {
    assert.match(codigo, /^\d{6}$/);
    assert.ok(MATERIALES[codigo].trim().length > 0, codigo);
  }
  assert.equal(MATERIALES['401235'], 'TERMO PACK LTA 330/355/473 CAL 2.0X53 cm - 26 TN');
  assert.equal(MATERIALES['404738'], 'SEPARADOR PET 106X128CM RECUBRIMIENTO');
  // Un material de la base no pide descripción: la toma del catálogo.
  assert.equal(revisarSolicitud({ centro: 'AV10', material: '424388', cantidad: 5 }).solicitud?.descripcion, 'CAJA CTON X24U BTA 330 MICHELOB ULTRA TO (LOOSEPACK)');
});

test('el centro se puede escribir en minúsculas o por el nombre del CD', () => {
  assert.equal(buscarCentro(' av10 ')?.codigo, 'AV10');
  assert.equal(buscarCentro('monteria')?.codigo, 'AV39');
  assert.equal(buscarCentro('AV48'), undefined);
  assert.equal(buscarCentro(''), undefined);
});

test('la cantidad es un entero mayor que 0 y acepta puntos de miles', () => {
  assert.equal(leerCantidad('144'), 144);
  assert.equal(leerCantidad('1.100'), 1100);
  assert.equal(leerCantidad('400.000'), 400000);
  assert.equal(leerCantidad(288), 288);
  for (const mala of ['0', '-5', '1,5', '1,100', '2.5', 'abc', '', 1.5]) assert.equal(leerCantidad(mala), null, String(mala));
});

test('la solicitud toma el solicitante del centro y la descripción del catálogo', () => {
  const { solicitud, errores } = revisarSolicitud({ centro: 'av39', material: '400512', cantidad: '432', solicitante: 'Otro', descripcion: 'cualquier cosa' });
  assert.deepEqual(errores, {});
  assert.deepEqual(solicitud, { centro: 'AV39', solicitante: 'Jose Acosta', material: '400512', descripcion: 'PLASTICO STRECH CALIBRE 0.6 MILS', cantidad: 432 });
});

test('un material nuevo pide su descripción y la guarda en mayúsculas', () => {
  assert.ok(revisarSolicitud({ centro: 'AV10', material: '999999', cantidad: '5' }).errores.descripcion);
  const { solicitud } = revisarSolicitud({ centro: 'AV10', material: '999999', cantidad: '5', descripcion: '  caja   prueba x 24 ' });
  assert.equal(solicitud?.descripcion, 'CAJA PRUEBA X 24');
});

test('marca cada campo que falta o no es válido', () => {
  const { solicitud, errores } = revisarSolicitud({ centro: 'AV99', material: '40 00', cantidad: '0' });
  assert.equal(solicitud, null);
  assert.deepEqual(Object.keys(errores).sort(), ['cantidad', 'centro', 'material']);
  assert.match(errores.centro!, /no tiene solicitante/);
});

test('la API guarda, lista, edita y elimina solo solicitudes', async () => {
  const filas: { id: string; formulario: string; usuario_nombre: string; creado_en: string; respuestas: unknown }[] = [
    { id: '00000000-0000-4000-8000-0000000000aa', formulario: 'control-inventarios', usuario_nombre: 'X', creado_en: '2026-11-25T10:00:00Z', respuestas: {} },
  ];
  let n = 0;
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      const sinForm = ({ formulario: _f, ...resto }: typeof filas[number]) => resto;
      if (sql.startsWith('select')) return { rows: filas.filter(f => f.formulario === params[0]).map(sinForm) };
      if (sql.startsWith('insert')) {
        // Una fila por artículo del arreglo, como jsonb_array_elements.
        const nuevas = (JSON.parse(String(params[1])) as unknown[]).map(respuestas => ({ id: `00000000-0000-4000-8000-00000000000${++n}`, formulario: String(params[0]), usuario_nombre: String(params[3]), creado_en: new Date().toISOString(), respuestas }));
        filas.push(...nuevas);
        return { rows: nuevas.map(sinForm) };
      }
      if (sql.trimStart().startsWith('update')) {
        const fila = filas.find(f => f.id === params[0] && f.formulario === params[1]);
        if (fila) fila.respuestas = JSON.parse(String(params[2]));
        return { rows: fila ? [sinForm(fila)] : [] };
      }
      if (sql.startsWith('delete')) {
        const i = filas.findIndex(f => f.id === params[0] && f.formulario === params[1]);
        if (i >= 0) filas.splice(i, 1);
        return { rows: [], rowCount: i >= 0 ? 1 : 0 };
      }
      throw new Error(`SQL inesperado: ${sql}`);
    },
  } as unknown as pg.Pool;
  const app = express();
  app.use(express.json());
  app.use('/api/solicitudes', rutasSolicitudes(pool, req => req.get('x-test-user') ? { sub: 'u1', nombre: 'Operador' } : null));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/solicitudes`;
    const headers = { 'Content-Type': 'application/json', 'x-test-user': '1' };
    assert.equal((await fetch(url)).status, 401);

    const enviar = (solicitudes: unknown) => fetch(url, { method: 'POST', headers, body: JSON.stringify({ solicitudes }) });
    // Si un artículo está mal no se guarda ninguno, y el mensaje dice cuál.
    const malo = await enviar([{ centro: 'AV74', material: '400090', cantidad: 1 }, { centro: 'AV48', material: '400090', cantidad: 1 }]);
    assert.equal(malo.status, 400);
    assert.match((await malo.json()).error, /Artículo 2: .*AV48/);
    assert.equal(filas.length, 1);
    assert.equal((await enviar([])).status, 400);

    const creada = await enviar([{ centro: 'AV74', material: '400090', cantidad: '144' }, { centro: 'AV74', material: '404431', cantidad: '2.400' }]);
    assert.equal(creada.status, 201);
    const { solicitudes } = await creada.json();
    assert.deepEqual(solicitudes.map((s: { respuestas: { material: string; cantidad: number } }) => [s.respuestas.material, s.respuestas.cantidad]), [['400090', 144], ['404431', 2400]]);
    const solicitud = solicitudes[0];
    assert.equal(solicitud.respuestas.solicitante, 'Piedad Santiago');
    assert.equal(filas.at(-1)!.formulario, ID_SOLICITUDES);

    const lista = await (await fetch(url, { headers })).json();
    assert.equal(lista.solicitudes.length, 2, 'no mezcla los reportes de Control de inventarios');

    const editada = await fetch(`${url}/${solicitud.id}`, { method: 'PUT', headers, body: JSON.stringify({ solicitud: { centro: 'AV11', material: '400090', cantidad: '200' } }) });
    assert.equal(editada.status, 200);
    assert.equal((await editada.json()).solicitud.respuestas.solicitante, 'Victor Villa');

    // Un id de otro módulo no se toca desde aquí.
    assert.equal((await fetch(`${url}/${filas[0].id}`, { method: 'DELETE', headers })).status, 404);
    assert.equal((await fetch(`${url}/${solicitud.id}`, { method: 'DELETE', headers })).status, 204);
    assert.equal(filas.length, 2);
  } finally {
    server.close();
  }
});
