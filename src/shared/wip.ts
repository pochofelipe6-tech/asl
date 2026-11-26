// Seguimiento WIP (réplica de la página "Seguimiento WIP" del Power BI "Seguimiento ATCT"). Lo usan el navegador
// (lectura de Data WIP.xlsx y cálculos), el servidor (validación) y el script de verificación. Verificado contra Power BI.
//
// Reglas del modelo:
// - Cada fila de Data WIP.xlsx es un CD en un día, con los DTs por estado (0. Pendiente … 8. Finalizado) y el Total DTs.
//   Como en DAX, un estado vacío suma como 0 si algún otro tiene valor; si todos los de una usabilidad están vacíos,
//   esa usabilidad queda vacía y no entra en los promedios.
// - Usabilidad Armado = (4. Armado + 5. En verificación + 6. Verificados + 7. En Cargue + 8. Finalizado) / Total DTs.
//   Usabilidad Verificación = (6. Verificados + 7. En Cargue + 8. Finalizado) / Total DTs.
//   Usabilidad Montacargas = (7. En Cargue + 8. Finalizado) / Total DTs.
//   Usabilidad WIP = promedio de las tres. Los indicadores son el promedio de las filas (un CD-día pesa lo mismo).
// - Nombre CD, Gerencia y OL (Contratista) salen de la tabla Gerencias por la columna "CD WIP".
// - La tendencia por semana no depende del rango de fechas (como en Power BI); la tabla por CD no depende del filtro de CD.
import { GERENCIAS, diaSemana, isoDeDia, mesDe, semanaDe } from './t1.ts';

export const COLUMNAS_WIP = ['Fecha', 'CD', '0. Pendiente', '1. En Pausa', '2. Liberado', '3. Asignado', '4. Armado', '5. En verificación', '6. Verificados', '7. En Cargue', '8. Finalizado', 'Total DTs'] as const;
export const ESTADOS_WIP = COLUMNAS_WIP.slice(2, 11);
export const MAX_FILAS_WIP = 100_000;

const clave = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase('es');
const texto = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const porCdWip = new Map<string, (typeof GERENCIAS)[number]>();
for (const g of GERENCIAS) if (g.cdWip && !porCdWip.has(clave(g.cdWip))) porCdWip.set(clave(g.cdWip), g);

export const esEncabezadoWip = (cabecera: readonly unknown[]) => COLUMNAS_WIP.every((c, i) => texto(cabecera[i]) === texto(c));

/** Data WIP en columnas: fecha (día de Excel), CD (índice de la lista "cds") y los 9 estados más el total. */
export interface ColumnasWip { tipo: 'wip'; version: 1; fecha: number[]; cd: number[]; cds: string[]; estados: (number | null)[][]; total: number[] }

const entero = (v: unknown): number | null => { if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null; const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
function diaExcel(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return Math.floor((v.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
  const m = typeof v === 'string' ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v.trim()) : null;
  return m ? Math.round((Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) - Date.UTC(1899, 11, 30)) / 86_400_000) : null;
}

export function leerWip(filas: readonly (readonly unknown[])[]) {
  if (!esEncabezadoWip(filas[0] ?? [])) throw new Error(`El archivo no tiene las columnas de Data WIP: ${COLUMNAS_WIP.join(', ')}.`);
  const cds: string[] = [], indice = new Map<string, number>();
  const c: ColumnasWip = { tipo: 'wip', version: 1, fecha: [], cd: [], cds, estados: ESTADOS_WIP.map(() => []), total: [] };
  const omitidas: { fila: number; motivo: string }[] = [];
  let desde: number | null = null, hasta: number | null = null;
  for (let i = 1; i < filas.length; i++) {
    const r = filas[i];
    if (!r || !r.some(v => v !== null && v !== undefined && v !== '')) continue;
    const dia = diaExcel(r[0]);
    const total = entero(r[11]);
    const estados = ESTADOS_WIP.map((_, k) => entero(r[2 + k]));
    if (dia === null) { omitidas.push({ fila: i + 1, motivo: 'Fecha no válida' }); continue; }
    if (!(total !== null && total > 0) || estados.some(v => v !== null && Number.isNaN(v))) { omitidas.push({ fila: i + 1, motivo: 'Total DTs o estados no válidos' }); continue; }
    if (c.fecha.length >= MAX_FILAS_WIP) throw new Error('El archivo tiene demasiadas filas.');
    const cd = String(r[1] ?? '').trim();
    let k = indice.get(cd);
    if (k === undefined) { k = cds.length; cds.push(cd); indice.set(cd, k); }
    c.fecha.push(dia); c.cd.push(k); c.total.push(total!);
    estados.forEach((v, j) => c.estados[j].push(v));
    desde = desde === null ? dia : Math.min(desde, dia);
    hasta = hasta === null ? dia : Math.max(hasta, dia);
  }
  if (!c.fecha.length) throw new Error('La hoja de Data WIP no tiene registros.');
  return { columnas: c, filas: c.fecha.length, omitidas, desde, hasta };
}

export function validarColumnasWip(datos: unknown): string | null {
  const d = datos as Partial<ColumnasWip> | null;
  if (!d || d.tipo !== 'wip' || d.version !== 1) return 'El tipo de archivo no coincide.';
  const n = d.fecha?.length ?? 0;
  const numeros = (a: unknown, largo = n) => Array.isArray(a) && a.length === largo && a.every(v => typeof v === 'number' && Number.isFinite(v));
  if (n < 1 || n > MAX_FILAS_WIP || !numeros(d.fecha) || !numeros(d.cd) || !numeros(d.total)) return 'Las columnas no son válidas.';
  if (!Array.isArray(d.cds) || !d.cds.every(v => typeof v === 'string' && v.length <= 120)) return 'La lista de CD no es válida.';
  if (!Array.isArray(d.estados) || d.estados.length !== ESTADOS_WIP.length || !d.estados.every(e => Array.isArray(e) && e.length === n && e.every(v => v === null || (typeof v === 'number' && Number.isFinite(v))))) return 'Los estados no son válidos.';
  if (!d.cd!.every(i => Number.isInteger(i) && i >= 0 && i < d.cds!.length) || !d.total!.every(t => t > 0)) return 'Hay valores fuera de rango.';
  return null;
}

export interface FilaWip {
  fecha: number; cdArchivo: string; cd: string; gerencia: string; ol: string;
  estados: (number | null)[]; total: number; finalizados: number;
  armado: number | null; verificacion: number | null; montacargas: number | null; wip: number | null;
  semana: number; diaSemana: number; mes: string;
}

/** Suma como DAX: vacío + número = número; todo vacío = vacío. */
const mas = (...v: (number | null)[]) => (v.every(x => x === null) ? null : v.reduce<number>((s, x) => s + (x ?? 0), 0));
const entre = (v: number | null, d: number) => (v === null ? null : v / d);

export function filasWip(c: ColumnasWip): FilaWip[] {
  return c.fecha.map((fecha, i) => {
    const estados = c.estados.map(e => e[i]);
    const [, , , , armado4, verif5, verif6, cargue7, fin8] = estados;
    const total = c.total[i];
    const armado = entre(mas(armado4, verif5, verif6, cargue7, fin8), total);
    const verificacion = entre(mas(verif6, cargue7, fin8), total);
    const montacargas = entre(mas(cargue7, fin8), total);
    const g = porCdWip.get(clave(c.cds[c.cd[i]]));
    return {
      fecha, cdArchivo: c.cds[c.cd[i]], cd: g?.cd ?? '', gerencia: g?.gerencia ?? '', ol: g?.ol ?? '',
      estados, total, finalizados: fin8 ?? 0, armado, verificacion, montacargas, wip: entre(mas(armado, verificacion, montacargas), 3),
      semana: semanaDe(fecha), diaSemana: diaSemana(fecha), mes: mesDe(fecha),
    };
  });
}

export interface FiltrosWip { desde?: number | null; hasta?: number | null; cds?: readonly string[] }
export interface Usabilidades { wip: number | null; armado: number | null; verificacion: number | null; montacargas: number | null }
export interface ResultadoWip {
  tarjetas: Usabilidades & { filas: number; finalizados: number; total: number };
  porCd: ({ cd: string } & Usabilidades)[];
  porDia: ({ fecha: number; finalizados: number; total: number } & Usabilidades)[];
  porSemana: { semana: number; wip: number | null }[];
  porGerencia: { gerencia: string; wip: number | null }[];
  porOl: { ol: string; wip: number | null }[];
  /** Usabilidad de armado, verificación y montacargas por CD y día. */
  mapa: { cds: string[]; fechas: number[]; valores: (Usabilidades | null)[][] };
}

const prom = (filas: readonly FilaWip[], k: 'wip' | 'armado' | 'verificacion' | 'montacargas') => {
  let s = 0, n = 0; for (const f of filas) { const v = f[k]; if (v !== null) { s += v; n++; } } return n ? s / n : null;
};
const usabilidades = (filas: readonly FilaWip[]): Usabilidades => ({ wip: prom(filas, 'wip'), armado: prom(filas, 'armado'), verificacion: prom(filas, 'verificacion'), montacargas: prom(filas, 'montacargas') });
function agrupar<T, K>(lista: readonly T[], clave: (x: T) => K) { const m = new Map<K, T[]>(); for (const x of lista) { const k = clave(x); const g = m.get(k); if (g) g.push(x); else m.set(k, [x]); } return m; }
const orden = new Intl.Collator('es').compare;

export function opcionesWip(filas: readonly FilaWip[]) {
  let desde: number | null = null, hasta: number | null = null;
  for (const f of filas) { desde = desde === null ? f.fecha : Math.min(desde, f.fecha); hasta = hasta === null ? f.fecha : Math.max(hasta, f.fecha); }
  return { cds: [...new Set(filas.map(f => f.cd).filter(Boolean))].sort(orden), desde, hasta, sinCd: [...new Set(filas.filter(f => !f.cd).map(f => f.cdArchivo))] };
}

export function calcularWip(filas: readonly FilaWip[], f: FiltrosWip = {}): ResultadoWip {
  const cds = f.cds?.length ? new Set(f.cds.map(clave)) : null;
  const enRango = (dia: number) => (f.desde == null || dia >= f.desde) && (f.hasta == null || dia <= f.hasta);
  const delCd = (x: FilaWip) => !cds || cds.has(clave(x.cd));
  const enFechas = filas.filter(x => enRango(x.fecha));
  const base = enFechas.filter(delCd);
  const sumar = (l: readonly FilaWip[], k: 'finalizados' | 'total') => l.reduce((s, x) => s + x[k], 0);

  const porCd = [...agrupar(enFechas, x => x.cd)].filter(([cd]) => cd).sort(([a], [b]) => orden(a, b)).map(([cd, g]) => ({ cd, ...usabilidades(g) }));
  const porDia = [...agrupar(base, x => x.fecha)].sort(([a], [b]) => a - b).map(([fecha, g]) => ({ fecha, finalizados: sumar(g, 'finalizados'), total: sumar(g, 'total'), ...usabilidades(g) }));
  const porSemana = [...agrupar(filas.filter(delCd), x => x.semana)].sort(([a], [b]) => a - b).map(([semana, g]) => ({ semana, wip: prom(g, 'wip') }));
  const porGerencia = [...agrupar(base, x => x.gerencia)].filter(([g]) => g).sort(([a], [b]) => orden(a, b)).map(([gerencia, g]) => ({ gerencia, wip: prom(g, 'wip') }));
  const porOl = [...agrupar(base, x => x.ol)].filter(([o]) => o).sort(([a], [b]) => orden(a, b)).map(([ol, g]) => ({ ol, wip: prom(g, 'wip') }));
  const porCdFecha = agrupar(base, x => `${x.cd}|${x.fecha}`);
  const cdsMapa = [...new Set(base.map(x => x.cd))].filter(Boolean).sort(orden);
  const fechasMapa = [...new Set(base.map(x => x.fecha))].sort((a, b) => a - b);
  return {
    tarjetas: { filas: base.length, finalizados: sumar(base, 'finalizados'), total: sumar(base, 'total'), ...usabilidades(base) },
    porCd, porDia, porSemana, porGerencia, porOl,
    mapa: { cds: cdsMapa, fechas: fechasMapa, valores: cdsMapa.map(cd => fechasMapa.map(fecha => { const g = porCdFecha.get(`${cd}|${fecha}`); return g ? usabilidades(g) : null; })) },
  };
}

export const fechaIsoWip = isoDeDia;
