import type pg from 'pg';

// Supabase de mentira para las cargas de Excel (public.t1_cargas y public.t1_consolidado), en memoria.
// Entiende solo las consultas de src/server/cargas.ts; cualquier otra falla para que la prueba lo note.

export interface CargaFalsa { id: string; tipo: string; archivo: string; filas: number; desde: string; hasta: string; datos: Buffer; usuario_nombre: string; creado_en: Date }
export interface JuntadoFalso { carga_id: string; filas: number; desde: string | null; hasta: string | null; datos: Buffer }

export function baseFalsa({ conTablaJuntado = true } = {}) {
  const cargas: CargaFalsa[] = [];
  const juntado = new Map<string, JuntadoFalso>();
  const estado = { tablaJuntado: conTablaJuntado, pedidasJuntado: 0, borrados: 0 };
  let reloj = Date.UTC(2026, 10, 1);
  const consulta = async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(begin|commit|rollback)$/.test(s) || s.startsWith('select pg_advisory_xact_lock')) return { rows: [] };
    if (s.startsWith('delete')) { estado.borrados++; return { rows: [] }; }
    if (s.startsWith('create table if not exists public.t1_consolidado')) { estado.tablaJuntado = true; return { rows: [] }; }
    if (s.startsWith('alter table public.t1_consolidado') || s.startsWith('revoke all on public.t1_consolidado')) return { rows: [] };
    if (s.includes('t1_consolidado') && !estado.tablaJuntado) {
      throw Object.assign(new Error('relation "public.t1_consolidado" does not exist'), { code: '42P01' });
    }
    if (s.startsWith('insert into public.t1_cargas')) {
      const f: CargaFalsa = {
        id: `id${cargas.length + 1}`, tipo: String(params[0]), archivo: String(params[1]), filas: Number(params[2]),
        desde: String(params[3]), hasta: String(params[4]), datos: params[5] as Buffer, usuario_nombre: String(params[7]), creado_en: new Date(reloj += 1000),
      };
      cargas.push(f);
      return { rows: [{ id: f.id, creado_en: f.creado_en }] };
    }
    if (s.startsWith('insert into public.t1_consolidado')) {
      juntado.set(String(params[0]), { carga_id: String(params[1]), filas: Number(params[2]), desde: params[3] as string | null, hasta: params[4] as string | null, datos: params[5] as Buffer });
      return { rows: [] };
    }
    if (s.startsWith('select c.tipo')) {
      const rows = [...juntado].filter(([tipo]) => (params[0] as string[]).includes(tipo)).map(([tipo, j]) => {
        const l = cargas.find(c => c.id === j.carga_id)!;
        return { tipo, id: j.carga_id, filas: j.filas, desde: j.desde, hasta: j.hasta, archivo: l.archivo, usuario_nombre: l.usuario_nombre, creado_en: l.creado_en, cargas: cargas.filter(c => c.tipo === tipo).length };
      });
      return { rows };
    }
    if (s.startsWith('select distinct tipo from public.t1_cargas')) {
      return { rows: [...new Set(cargas.filter(c => (params[0] as string[]).includes(c.tipo)).map(c => c.tipo))].map(tipo => ({ tipo })) };
    }
    if (s.startsWith('select carga_id from public.t1_consolidado')) {
      const j = juntado.get(String(params[0]));
      return { rows: j ? [{ carga_id: j.carga_id }] : [] };
    }
    if (s.startsWith("select encode(datos, 'base64') as datos from public.t1_consolidado")) {
      estado.pedidasJuntado++;
      const j = juntado.get(String(params[0]));
      return { rows: j && j.carga_id === params[1] ? [{ datos: j.datos.toString('base64') }] : [] };
    }
    if (s.startsWith('select id from public.t1_cargas')) {
      return { rows: cargas.filter(c => c.tipo === params[0]).sort((a, b) => +a.creado_en - +b.creado_en).map(c => ({ id: c.id })) };
    }
    if (s.startsWith("select encode(datos, 'base64') as datos from public.t1_cargas")) {
      const c = cargas.find(x => x.id === params[0]);
      return { rows: c ? [{ datos: c.datos.toString('base64') }] : [] };
    }
    throw new Error('SQL inesperado: ' + s);
  };
  const pool = { query: consulta, connect: async () => ({ query: consulta, release() {} }) } as unknown as pg.Pool;
  return { pool, cargas, juntado, estado };
}
