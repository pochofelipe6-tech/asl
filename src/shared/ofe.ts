// OFE (réplica de la página "OFE" del Power BI "Seguimiento ATCT"): uso de los montacargas según Data FMS.xlsx.
// Lo usan el navegador, el servidor (validación) y el script de verificación. Verificado contra Power BI.
//
// Reglas del modelo:
// - Cada fila de Data FMS.xlsx es un montacargas (Forklift = # de chasis) en un día y turno, con horas de ralentí,
//   carga y movimiento (pueden venir vacías).
// - El CD y la máquina (placa) salen de la lista de montacargas por el # de chasis (la del Power BI más los montacargas
//   que se agregan o corrigen desde la página, ver listaMontacargas); el Nombre CD y la Gerencia, de la
//   tabla Gerencias por la columna "CD FMS". La página solo cuenta los montacargas con CD (filtro de página del Power BI).
// - OFE = (horas movimiento + horas carga) / 24. % Carga = carga / 8. % Movimiento = (movimiento + carga) / 8.
//   Tiempo encendido = carga + movimiento + ralentí. % Encendido = encendido / 8.
//   Como en Power BI, un vacío suma como 0 si el otro valor existe; si todos están vacíos el resultado queda vacío.
// - Los promedios ignoran los vacíos; las sumas los tratan como 0.
import { GERENCIAS, diaSemana, mesDe, semanaDe } from './t1.ts';
import { MONTACARGAS } from './montacargas.ts';

export const COLUMNAS_FMS = ['Forklift', 'Horas ralenti', 'Horas carga', 'Horas movimiento', 'Fecha', 'Turno'] as const;
export const MAX_FILAS_FMS = 200_000;

const clave = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase('es');
const texto = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const porChasisBase = new Map(MONTACARGAS.map(m => [clave(m.chasis), m]));
const porCdFms = new Map<string, (typeof GERENCIAS)[number]>();
for (const g of GERENCIAS) if (g.cdFms && !porCdFms.has(clave(g.cdFms))) porCdFms.set(clave(g.cdFms), g);

/** Un montacargas de la lista: # de chasis (columna Forklift de Data FMS), CD (como en la columna "CD FMS" de Gerencias) y placa. */
export interface MontacargasFms { chasis: string; cd: string; placa: string }
/** Montacargas agregado o corregido desde la página (se guarda en Supabase, tabla ofe_montacargas). */
export interface CambioMontacargas extends MontacargasFms { usuario_nombre?: string; actualizado_en?: string }
export type OrigenMontacargas = 'lista' | 'agregado' | 'corregido';
export interface MontacargasDeLista extends MontacargasFms { origen: OrigenMontacargas; cambio?: CambioMontacargas; original?: MontacargasFms }

/** Chasis sin espacios a los lados ni diferencia de mayúsculas: "308fgj35-95408 " es el mismo que "308FGJ35-95408". */
export const claveChasis = (chasis: string) => clave(chasis);
/** CD a los que se puede asignar un montacargas (los de la columna "CD FMS" de Gerencias). */
export const CDS_FMS: readonly string[] = [...porCdFms.values()].map(g => g.cdFms).sort(new Intl.Collator('es').compare);

/** La lista de montacargas con los cambios hechos desde la página: un cambio con el chasis de la lista original la corrige;
 *  uno con un chasis nuevo se agrega. */
export function listaMontacargas(cambios: readonly CambioMontacargas[] = []): MontacargasDeLista[] {
  const porClave = new Map(cambios.map(c => [claveChasis(c.chasis), c]));
  const lista: MontacargasDeLista[] = MONTACARGAS.map(m => {
    const c = porClave.get(claveChasis(m.chasis));
    const original = { chasis: m.chasis, cd: m.cd, placa: m.placa };
    return c ? { chasis: m.chasis, cd: c.cd, placa: c.placa, origen: 'corregido', cambio: c, original } : { ...original, origen: 'lista' };
  });
  for (const c of cambios) if (!porChasisBase.has(claveChasis(c.chasis))) lista.push({ chasis: c.chasis, cd: c.cd, placa: c.placa, origen: 'agregado', cambio: c });
  return lista;
}

/** Revisa un montacargas que llega de la página y lo deja limpio (CD con el nombre exacto de la lista de CD). */
export function revisarMontacargas(datos: unknown): { error: string } | { montacargas: MontacargasFms } {
  const d = (datos ?? {}) as Record<string, unknown>;
  const chasis = typeof d.chasis === 'string' ? d.chasis.trim() : '';
  const placa = typeof d.placa === 'string' ? d.placa.trim() : '';
  const cd = typeof d.cd === 'string' ? CDS_FMS.find(x => clave(x) === clave(d.cd)) : undefined;
  if (chasis.length < 3 || chasis.length > 60 || !/^[\p{L}\p{N}][\p{L}\p{N} ._/-]*$/u.test(chasis)) return { error: 'Escribe el número de chasis tal como sale en Data FMS (columna Forklift).' };
  if (!cd) return { error: 'Elige el CD del montacargas.' };
  if (!placa || placa.length > 20 || /[<>]/.test(placa)) return { error: 'Escribe la placa o número de máquina (máximo 20 caracteres).' };
  return { montacargas: { chasis, cd, placa } };
}

export const esEncabezadoFms = (cabecera: readonly unknown[]) => COLUMNAS_FMS.every((c, i) => texto(cabecera[i]) === texto(c));

/** Data FMS en columnas. Las horas vacías van como null. */
export interface ColumnasFms { tipo: 'fms'; version: 1; forklift: number[]; forklifts: string[]; ralenti: (number | null)[]; carga: (number | null)[]; movimiento: (number | null)[]; fecha: number[]; turno: string[] }

const horas = (v: unknown): number | null | typeof NaN => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
};
function diaExcel(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return Math.floor((v.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
  const m = typeof v === 'string' ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v.trim()) : null;
  return m ? Math.round((Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) - Date.UTC(1899, 11, 30)) / 86_400_000) : null;
}

export function leerFms(filas: readonly (readonly unknown[])[]) {
  if (!esEncabezadoFms(filas[0] ?? [])) throw new Error(`El archivo no tiene las columnas de Data FMS: ${COLUMNAS_FMS.join(', ')}.`);
  const forklifts: string[] = [], indice = new Map<string, number>();
  const c: ColumnasFms = { tipo: 'fms', version: 1, forklift: [], forklifts, ralenti: [], carga: [], movimiento: [], fecha: [], turno: [] };
  const omitidas: { fila: number; motivo: string }[] = [];
  let desde: number | null = null, hasta: number | null = null;
  for (let i = 1; i < filas.length; i++) {
    const r = filas[i];
    if (!r || !r.some(v => v !== null && v !== undefined && v !== '')) continue;
    const dia = diaExcel(r[4]);
    const [ral, car, mov] = [horas(r[1]), horas(r[2]), horas(r[3])];
    if (dia === null) { omitidas.push({ fila: i + 1, motivo: 'Fecha no válida' }); continue; }
    if ([ral, car, mov].some(v => typeof v === 'number' && Number.isNaN(v))) { omitidas.push({ fila: i + 1, motivo: 'Horas no válidas' }); continue; }
    if (c.fecha.length >= MAX_FILAS_FMS) throw new Error('El archivo tiene demasiadas filas.');
    const fk = String(r[0] ?? '').trim();
    let k = indice.get(fk);
    if (k === undefined) { k = forklifts.length; forklifts.push(fk); indice.set(fk, k); }
    // Power BI no distingue mayúsculas: "c" y "C" son el mismo turno.
    c.forklift.push(k); c.ralenti.push(ral); c.carga.push(car); c.movimiento.push(mov); c.fecha.push(dia); c.turno.push(String(r[5] ?? '').trim().toUpperCase());
    desde = desde === null ? dia : Math.min(desde, dia);
    hasta = hasta === null ? dia : Math.max(hasta, dia);
  }
  if (!c.fecha.length) throw new Error('La hoja de Data FMS no tiene registros.');
  return { columnas: c, filas: c.fecha.length, omitidas, desde, hasta };
}

export function validarColumnasFms(datos: unknown): string | null {
  const d = datos as Partial<ColumnasFms> | null;
  if (!d || d.tipo !== 'fms' || d.version !== 1) return 'El tipo de archivo no coincide.';
  const n = d.fecha?.length ?? 0;
  const numeros = (a: unknown, vacios = false) => Array.isArray(a) && a.length === n && a.every(v => (vacios && v === null) || (typeof v === 'number' && Number.isFinite(v)));
  if (n < 1 || n > MAX_FILAS_FMS || !numeros(d.fecha) || !numeros(d.forklift) || !numeros(d.ralenti, true) || !numeros(d.carga, true) || !numeros(d.movimiento, true)) return 'Las columnas no son válidas.';
  if (!Array.isArray(d.turno) || d.turno.length !== n || !d.turno.every(t => typeof t === 'string' && t.length <= 20)) return 'La columna Turno no es válida.';
  if (!Array.isArray(d.forklifts) || !d.forklifts.every(v => typeof v === 'string' && v.length <= 120)) return 'La lista de montacargas no es válida.';
  if (!d.forklift!.every(i => Number.isInteger(i) && i >= 0 && i < d.forklifts!.length)) return 'Hay valores fuera de rango.';
  return null;
}

export interface FilaFms {
  forklift: string; fecha: number; turno: string;
  ralenti: number | null; carga: number | null; movimiento: number | null;
  cdLista: string; maquina: string; cd: string; gerencia: string;
  ofe: number | null; pCarga: number | null; pMovimiento: number | null; encendido: number | null; pEncendido: number | null; pRalenti: number | null;
  semana: number; diaSemana: number; mes: string;
}

/** Suma como DAX: vacío + número = número; vacío + vacío = vacío. */
const mas = (...v: (number | null)[]) => (v.every(x => x === null) ? null : v.reduce<number>((s, x) => s + (x ?? 0), 0));
const entre = (v: number | null, d: number) => (v === null ? null : v / d);

/** Filas de Data FMS con su CD y máquina. "lista" es la lista de montacargas (por defecto, la del Power BI). */
export function filasFms(c: ColumnasFms, lista: readonly MontacargasFms[] = MONTACARGAS): FilaFms[] {
  const porChasis = lista === MONTACARGAS ? porChasisBase : new Map(lista.map(m => [clave(m.chasis), m]));
  return c.fecha.map((fecha, i) => {
    const forklift = c.forklifts[c.forklift[i]];
    const m = porChasis.get(clave(forklift));
    const g = m ? porCdFms.get(clave(m.cd)) : undefined;
    const ralenti = c.ralenti[i], carga = c.carga[i], movimiento = c.movimiento[i];
    const encendido = mas(carga, movimiento, ralenti);
    return {
      forklift, fecha, turno: c.turno[i].toUpperCase(), ralenti, carga, movimiento,
      cdLista: m?.cd ?? '', maquina: m?.placa ?? '', cd: g?.cd ?? '', gerencia: g?.gerencia ?? '',
      ofe: entre(mas(movimiento, carga), 24), pCarga: entre(carga, 8), pMovimiento: entre(mas(movimiento, carga), 8),
      encendido, pEncendido: entre(encendido, 8), pRalenti: entre(ralenti, 8),
      semana: semanaDe(fecha), diaSemana: diaSemana(fecha), mes: mesDe(fecha),
    };
  });
}

export interface FiltrosOfe { desde?: number | null; hasta?: number | null; cds?: readonly string[]; maquinas?: readonly string[]; turnos?: readonly string[] }
type Num = number | null;
export interface ResultadoOfe {
  tarjetas: { filas: number; ralenti: number; carga: number; movimiento: number; encendido: number; ofe: Num; maquinas: number };
  porTurno: { turno: string; ralenti: Num; carga: Num; movimiento: Num }[];
  composicion: { carga: number; movimiento: number; ralenti: number };
  porMaquina: { maquina: string; cd: string; ralenti: number; ofe: Num }[];
  porDia: { fecha: number; encendido: Num; movimiento: Num; carga: Num }[];
  porCd: { cd: string; carga: number; movimiento: number; ralenti: number; ofe: Num }[];
  porGerencia: { gerencia: string; ralenti: number }[];
  /** Filas del rango que no cuentan porque su montacargas no está en la lista (sin CD). */
  sinCd: { filas: number; forklifts: string[] };
}

const promedio = (l: readonly FilaFms[], k: keyof FilaFms): Num => { let s = 0, n = 0; for (const x of l) { const v = x[k]; if (typeof v === 'number') { s += v; n++; } } return n ? s / n : null; };
const suma = (l: readonly FilaFms[], k: keyof FilaFms) => { let s = 0; for (const x of l) { const v = x[k]; if (typeof v === 'number') s += v; } return s; };
function agrupar<T, K>(lista: readonly T[], clave: (x: T) => K) { const m = new Map<K, T[]>(); for (const x of lista) { const k = clave(x); const g = m.get(k); if (g) g.push(x); else m.set(k, [x]); } return m; }
const orden = new Intl.Collator('es', { numeric: true }).compare;

export function opcionesOfe(filas: readonly FilaFms[]) {
  let desde: number | null = null, hasta: number | null = null;
  for (const f of filas) { desde = desde === null ? f.fecha : Math.min(desde, f.fecha); hasta = hasta === null ? f.fecha : Math.max(hasta, f.fecha); }
  const conCd = filas.filter(f => f.cd);
  return {
    cds: [...new Set(conCd.map(f => f.cd))].sort(orden),
    maquinas: [...new Map(conCd.map(f => [f.maquina, f.cd])).entries()].sort(([a], [b]) => orden(a, b)).map(([maquina, cd]) => ({ maquina, cd })),
    turnos: [...new Set(filas.map(f => f.turno).filter(Boolean))].sort(orden),
    desde, hasta,
  };
}

export function calcularOfe(filas: readonly FilaFms[], f: FiltrosOfe = {}): ResultadoOfe {
  const cds = f.cds?.length ? new Set(f.cds.map(clave)) : null;
  const maquinas = f.maquinas?.length ? new Set(f.maquinas) : null;
  const turnos = f.turnos?.length ? new Set(f.turnos) : null;
  const enRango = (dia: number) => (f.desde == null || dia >= f.desde) && (f.hasta == null || dia <= f.hasta);
  const enFechas = filas.filter(x => enRango(x.fecha));
  const base = enFechas.filter(x => x.cd && (!cds || cds.has(clave(x.cd))) && (!maquinas || maquinas.has(x.maquina)) && (!turnos || turnos.has(x.turno)));
  const sinCd = enFechas.filter(x => !x.cd);
  return {
    tarjetas: { filas: base.length, ralenti: suma(base, 'ralenti'), carga: suma(base, 'carga'), movimiento: suma(base, 'movimiento'), encendido: suma(base, 'encendido'), ofe: promedio(base, 'ofe'), maquinas: new Set(base.map(x => x.maquina)).size },
    porTurno: [...agrupar(base, x => x.turno)].sort(([a], [b]) => orden(a, b)).map(([turno, g]) => ({ turno, ralenti: promedio(g, 'ralenti'), carga: promedio(g, 'carga'), movimiento: promedio(g, 'movimiento') })),
    composicion: { carga: suma(base, 'carga'), movimiento: suma(base, 'movimiento'), ralenti: suma(base, 'ralenti') },
    porMaquina: [...agrupar(base, x => x.maquina)].map(([maquina, g]) => ({ maquina, cd: g[0].cd, ralenti: suma(g, 'ralenti'), ofe: promedio(g, 'ofe') })).sort((a, b) => b.ralenti - a.ralenti || orden(a.maquina, b.maquina)),
    porDia: [...agrupar(base, x => x.fecha)].sort(([a], [b]) => a - b).map(([fecha, g]) => ({ fecha, encendido: promedio(g, 'pEncendido'), movimiento: promedio(g, 'pMovimiento'), carga: promedio(g, 'pCarga') })),
    porCd: [...agrupar(base, x => x.cd)].sort(([a], [b]) => orden(a, b)).map(([cd, g]) => ({ cd, carga: suma(g, 'carga'), movimiento: suma(g, 'movimiento'), ralenti: suma(g, 'ralenti'), ofe: promedio(g, 'ofe') })),
    porGerencia: [...agrupar(base, x => x.gerencia)].filter(([g]) => g).sort(([a], [b]) => orden(a, b)).map(([gerencia, g]) => ({ gerencia, ralenti: suma(g, 'ralenti') })),
    sinCd: { filas: sinCd.length, forklifts: [...new Set(sinCd.map(x => x.forklift))].sort(orden) },
  };
}
