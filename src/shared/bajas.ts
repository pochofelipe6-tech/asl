// Bajas: movimientos de bajas exportados de SAP (un Excel por mes, hoja "Hoja1"). Lo usan el navegador (lectura del
// Excel y cálculos), el servidor (validación) y el script de carga inicial.
//
// Reglas:
// - Cada fila es un movimiento de material en un centro (Ce.) con su clase de movimiento (CMv), fecha contable,
//   cantidad e importe en pesos (Importe ML). Las bajas vienen en negativo; el valor de la baja es -Importe.
// - Las anulaciones (966, 946, 936, 926, 972, 992, 982) se restan de la baja que anulan: todo se muestra NETO por motivo.
//   Los ajustes de inventario (701/702 en almacén y Z71/Z72 COVI) entran con su signo (una entrada reduce las bajas).
// - El centro SAP (AV20, AV76…) se cruza con el CD de la aplicación y, por él, con la gerencia y el OL (tabla Gerencias).
// - Los envases retornables suelen venir con importe 0: suman unidades, no pesos.
import { GERENCIAS, isoDeDia } from './t1.ts';

/** Encabezado del Excel (todas las columnas que trae SAP; las que no se usan se ignoran). */
export const COLUMNAS_BAJAS = ['Ce.', 'Nombre 1', 'CMv', 'Material', 'Texto breve de material', 'Lote', 'Alm.', 'Pos', 'Hora',
  'Texto clase de mov.', 'Texto cab.documento', 'Texto', 'Doc.mat.', 'Cta.mayor', 'Ce.coste', 'Usuario', 'Fe.contab.',
  'Cantidad', 'UME', 'Importe ML', 'Registrado'] as const;
/** Las que hacen falta para el módulo (se buscan por nombre: el orden puede cambiar). */
const NECESARIAS = ['Ce.', 'Nombre 1', 'CMv', 'Material', 'Texto breve de material', 'Fe.contab.', 'Cantidad', 'Importe ML'] as const;
export const MAX_FILAS_BAJAS = 300_000;

const normal = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const posiciones = (cabecera: readonly unknown[]) => {
  const p = new Map<string, number>();
  cabecera.forEach((c, i) => { const k = normal(c); if (k && !p.has(k)) p.set(k, i); });
  return (nombre: string) => p.get(normal(nombre)) ?? -1;
};
export const esEncabezadoBajas = (cabecera: readonly unknown[]) => { const pos = posiciones(cabecera); return NECESARIAS.every(c => pos(c) >= 0); };

/**
 * Bajas en columnas. Las listas guardan "código|nombre" (centro, movimiento, material) para que cada índice lleve todo.
 * fecha: día de Excel (Fe.contab.); documento: Doc.mat.; cabecera: texto del documento (o, si falta, el "Texto").
 */
export interface ColumnasBajas {
  tipo: 'bajas'; version: 1;
  fecha: number[]; documento: string[]; cantidad: number[]; importe: number[];
  centro: number[]; centros: string[];
  mov: number[]; movs: string[];
  material: number[]; materiales: string[];
  almacen: number[]; almacenes: string[];
  ume: number[]; umes: string[];
  usuario: number[]; usuarios: string[];
  cabecera: number[]; cabeceras: string[];
}
/** Cómo están armadas las columnas (para juntar cargas fila por fila en el servidor). */
export const ESQUEMA_BAJAS = {
  filas: ['fecha', 'documento', 'cantidad', 'importe'],
  indices: { centro: 'centros', mov: 'movs', material: 'materiales', almacen: 'almacenes', ume: 'umes', usuario: 'usuarios', cabecera: 'cabeceras' },
} as const;

function indexador() {
  const lista: string[] = [];
  const mapa = new Map<string, number>();
  return { lista, indice(v: string) { let i = mapa.get(v); if (i === undefined) { i = lista.length; lista.push(v); mapa.set(v, i); } return i; } };
}
const cadena = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
/** Día de Excel desde un número, una fecha o un texto "dd/mm/aaaa". */
function diaExcel(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
  // La fecha contable llega como medianoche de Colombia (05:00 UTC): se toma el día en Colombia.
  if (v instanceof Date && !Number.isNaN(v.getTime())) return Math.floor((v.getTime() - 5 * 3_600_000 - Date.UTC(1899, 11, 30)) / 86_400_000);
  const m = typeof v === 'string' ? /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(v.trim()) : null;
  return m ? Math.round((Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) - Date.UTC(1899, 11, 30)) / 86_400_000) : null;
}

export interface Lectura<T> { columnas: T; filas: number; omitidas: { fila: number; motivo: string }[]; desde: number | null; hasta: number | null }

/** Lee la hoja de bajas (filas crudas; la primera es el encabezado). Lanza un Error si el archivo no sirve. */
export function leerBajas(filas: readonly (readonly unknown[])[]): Lectura<ColumnasBajas> {
  const cabecera = filas[0] ?? [];
  if (!esEncabezadoBajas(cabecera)) throw new Error(`El archivo no tiene las columnas de bajas: ${NECESARIAS.join(', ')}.`);
  const pos = posiciones(cabecera);
  const col = { ce: pos('Ce.'), nombre: pos('Nombre 1'), cmv: pos('CMv'), mat: pos('Material'), desc: pos('Texto breve de material'), alm: pos('Alm.'),
    clase: pos('Texto clase de mov.'), cab: pos('Texto cab.documento'), texto: pos('Texto'), doc: pos('Doc.mat.'), usuario: pos('Usuario'),
    fecha: pos('Fe.contab.'), cant: pos('Cantidad'), ume: pos('UME'), imp: pos('Importe ML') };
  const de = (r: readonly unknown[], i: number) => (i >= 0 ? r[i] : null);
  const centros = indexador(), movs = indexador(), materiales = indexador(), almacenes = indexador(), umes = indexador(), usuarios = indexador(), cabeceras = indexador();
  const c: ColumnasBajas = {
    tipo: 'bajas', version: 1, fecha: [], documento: [], cantidad: [], importe: [],
    centro: [], centros: centros.lista, mov: [], movs: movs.lista, material: [], materiales: materiales.lista,
    almacen: [], almacenes: almacenes.lista, ume: [], umes: umes.lista, usuario: [], usuarios: usuarios.lista, cabecera: [], cabeceras: cabeceras.lista,
  };
  const omitidas: { fila: number; motivo: string }[] = [];
  let desde: number | null = null, hasta: number | null = null;
  for (let i = 1; i < filas.length; i++) {
    const r = filas[i];
    if (!r || !r.some(v => v !== null && v !== undefined && v !== '')) continue;
    const dia = diaExcel(de(r, col.fecha));
    const cantidad = numero(de(r, col.cant));
    const importe = numero(de(r, col.imp)) ?? 0;
    const ce = cadena(de(r, col.ce)), cmv = cadena(de(r, col.cmv));
    if (dia === null) { omitidas.push({ fila: i + 1, motivo: 'Fecha contable no válida' }); continue; }
    if (cantidad === null) { omitidas.push({ fila: i + 1, motivo: 'Cantidad no válida' }); continue; }
    if (!ce || !cmv) { omitidas.push({ fila: i + 1, motivo: 'Sin centro o clase de movimiento' }); continue; }
    if (c.fecha.length >= MAX_FILAS_BAJAS) throw new Error(`El archivo supera ${MAX_FILAS_BAJAS.toLocaleString('es-CO')} filas.`);
    desde = desde === null ? dia : Math.min(desde, dia);
    hasta = hasta === null ? dia : Math.max(hasta, dia);
    c.fecha.push(dia);
    c.documento.push(cadena(de(r, col.doc)).slice(0, 30));
    c.cantidad.push(cantidad);
    c.importe.push(importe);
    c.centro.push(centros.indice(`${ce}|${cadena(de(r, col.nombre))}`));
    c.mov.push(movs.indice(`${cmv}|${cadena(de(r, col.clase))}`));
    c.material.push(materiales.indice(`${cadena(de(r, col.mat))}|${cadena(de(r, col.desc))}`.slice(0, 160)));
    c.almacen.push(almacenes.indice(cadena(de(r, col.alm)).slice(0, 20)));
    c.ume.push(umes.indice(cadena(de(r, col.ume)).slice(0, 10)));
    c.usuario.push(usuarios.indice(cadena(de(r, col.usuario)).slice(0, 40)));
    c.cabecera.push(cabeceras.indice((cadena(de(r, col.cab)) || cadena(de(r, col.texto))).slice(0, 120)));
  }
  if (!c.fecha.length) throw new Error('El archivo no tiene movimientos con fecha contable y cantidad válidas.');
  return { columnas: c, filas: c.fecha.length, omitidas, desde, hasta };
}

export function validarColumnasBajas(datos: unknown): string | null {
  const d = datos as Partial<ColumnasBajas> | null;
  if (!d || d.tipo !== 'bajas' || d.version !== 1) return 'El tipo de archivo no coincide.';
  const n = d.fecha?.length ?? 0;
  if (n < 1 || n > MAX_FILAS_BAJAS) return 'La cantidad de filas no es válida.';
  const numeros = (a: unknown) => Array.isArray(a) && a.length === n && a.every(v => typeof v === 'number' && Number.isFinite(v));
  if (!numeros(d.fecha) || !numeros(d.cantidad) || !numeros(d.importe)) return 'Las columnas de fecha, cantidad o importe no son válidas.';
  if (!Array.isArray(d.documento) || d.documento.length !== n || !d.documento.every(v => typeof v === 'string' && v.length <= 30)) return 'La columna de documento no es válida.';
  for (const [col, lista] of Object.entries(ESQUEMA_BAJAS.indices)) {
    const l = (d as Record<string, unknown>)[lista];
    const idx = (d as Record<string, unknown>)[col];
    if (!Array.isArray(l) || !l.every(v => typeof v === 'string' && v.length <= 160)) return `La lista ${lista} no es válida.`;
    if (!Array.isArray(idx) || idx.length !== n || !idx.every(i => Number.isInteger(i) && i >= 0 && i < l.length)) return `La columna ${col} no es válida.`;
  }
  return null;
}

// ---------- Motivos (clase de movimiento) ----------

export const GRUPOS = ['producto', 'transporte', 'ajustes', 'otros'] as const;
export type Grupo = (typeof GRUPOS)[number];
export const NOMBRE_GRUPO: Record<Grupo, string> = { producto: 'Bajas de producto', transporte: 'Transporte', ajustes: 'Ajustes de inventario', otros: 'Otros' };

/** Motivo de cada clase de movimiento: las anulaciones apuntan a la baja que anulan. */
const MOTIVOS: Record<string, { motivo: string; nombre: string; grupo: Grupo; anulacion?: boolean }> = {
  '965': { motivo: '965', nombre: 'Bajas excepcionales PT', grupo: 'producto' },
  '966': { motivo: '965', nombre: 'Bajas excepcionales PT', grupo: 'producto', anulacion: true },
  '945': { motivo: '945', nombre: 'Cargo a depósito', grupo: 'producto' },
  '946': { motivo: '945', nombre: 'Cargo a depósito', grupo: 'producto', anulacion: true },
  '935': { motivo: '935', nombre: 'Cargo a venta mercado', grupo: 'producto' },
  '936': { motivo: '935', nombre: 'Cargo a venta mercado', grupo: 'producto', anulacion: true },
  '925': { motivo: '925', nombre: 'Cargo a producción', grupo: 'producto' },
  '926': { motivo: '925', nombre: 'Cargo a producción', grupo: 'producto', anulacion: true },
  '971': { motivo: '971', nombre: 'Rotura y faltante en transporte', grupo: 'transporte' },
  '972': { motivo: '971', nombre: 'Rotura y faltante en transporte', grupo: 'transporte', anulacion: true },
  '991': { motivo: '991', nombre: 'Hurto en transporte', grupo: 'transporte' },
  '992': { motivo: '991', nombre: 'Hurto en transporte', grupo: 'transporte', anulacion: true },
  '981': { motivo: '981', nombre: 'Siniestro en transporte', grupo: 'transporte' },
  '982': { motivo: '981', nombre: 'Siniestro en transporte', grupo: 'transporte', anulacion: true },
  '701': { motivo: '70x', nombre: 'Ajuste de inventario en almacén', grupo: 'ajustes' },
  '702': { motivo: '70x', nombre: 'Ajuste de inventario en almacén', grupo: 'ajustes' },
  'Z71': { motivo: 'Z7x', nombre: 'Ajuste de inventario COVI', grupo: 'ajustes' },
  'Z72': { motivo: 'Z7x', nombre: 'Ajuste de inventario COVI', grupo: 'ajustes' },
};
export function motivoDe(cmv: string, texto = '') {
  return MOTIVOS[cmv.toUpperCase()] ?? { motivo: cmv, nombre: texto || `Movimiento ${cmv}`, grupo: 'otros' as Grupo };
}

/** Centro SAP → CD de la aplicación (los de la tabla Gerencias). */
export const CD_DE_CENTRO: Readonly<Record<string, string>> = {
  AV10: 'Turbaco', AV11: 'Santa Marta', AV12: 'Valledupar', AV13: 'Corozal', AV20: 'Cucuta', AV29: 'San Andres', AV30: 'Riohacha',
  AV32: 'Magangue', AV36: 'Fonseca', AV38: 'Curumani', AV39: 'Monteria', AV40: 'Caucasia', AV41: 'Apartado', AV48: 'Cartagena Ka',
  AV69: 'UDC Torices', AV74: 'La Arenosa', AV76: 'Galapa',
};
const gerenciaDeCd = new Map<string, (typeof GERENCIAS)[number]>();
for (const g of GERENCIAS) if (!gerenciaDeCd.has(g.cd)) gerenciaDeCd.set(g.cd, g);

// ---------- Filas listas para calcular ----------

export interface FilaBaja {
  fecha: number; mes: string; centro: string; cd: string; gerencia: string; ol: string;
  cmv: string; motivo: string; nombreMotivo: string; grupo: Grupo; anulacion: boolean;
  material: string; descripcion: string; almacen: string; ume: string; usuario: string; cabecera: string; documento: string;
  /** Unidades y pesos de la baja (positivos = pérdida; las anulaciones y entradas restan). */
  unidades: number; valor: number;
}
const partir = (s: string): [string, string] => { const i = s.indexOf('|'); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]; };

export function filasBajas(c: ColumnasBajas): FilaBaja[] {
  const centros = c.centros.map(s => {
    const [codigo, nombre] = partir(s);
    const cd = CD_DE_CENTRO[codigo.toUpperCase()] ?? (nombre || codigo);
    const g = gerenciaDeCd.get(cd);
    return { codigo, cd, gerencia: g?.gerencia ?? '', ol: g?.ol ?? '' };
  });
  const movs = c.movs.map(s => { const [cmv, texto] = partir(s); return { cmv, ...motivoDe(cmv, texto) }; });
  const materiales = c.materiales.map(partir);
  const meses = new Map<number, string>();
  return c.fecha.map((fecha, i) => {
    const ce = centros[c.centro[i]], m = movs[c.mov[i]], [material, descripcion] = materiales[c.material[i]];
    let mes = meses.get(fecha);
    if (!mes) { mes = isoDeDia(fecha).slice(0, 7); meses.set(fecha, mes); }
    return {
      fecha, mes, centro: ce.codigo, cd: ce.cd, gerencia: ce.gerencia, ol: ce.ol,
      cmv: m.cmv, motivo: m.motivo, nombreMotivo: m.nombre, grupo: m.grupo, anulacion: !!m.anulacion,
      material, descripcion, almacen: c.almacenes[c.almacen[i]], ume: c.umes[c.ume[i]], usuario: c.usuarios[c.usuario[i]],
      cabecera: c.cabeceras[c.cabecera[i]], documento: c.documento[i],
      // "|| 0": un importe 0 no queda como −0.
      unidades: -c.cantidad[i] || 0, valor: -c.importe[i] || 0,
    };
  });
}

// ---------- Cálculos ----------

export interface FiltrosBajas { desde?: number; hasta?: number; cds?: string[]; motivos?: string[] }
export interface Suma { valor: number; unidades: number; movimientos: number }
export interface ResultadoBajas {
  tarjetas: Suma & { anulado: number; materiales: number };
  /** Todos los meses (no le afecta el rango de fechas): valor por grupo. */
  mensual: { mes: string; grupos: Record<Grupo, number>; total: number }[];
  diaria: { fecha: number; valor: number; unidades: number }[];
  porCd: ({ cd: string; gerencia: string } & Suma)[];
  porGerencia: ({ gerencia: string } & Suma)[];
  porMotivo: ({ motivo: string; nombre: string; grupo: Grupo } & Suma)[];
  materiales: ({ material: string; descripcion: string } & Suma)[];
  /** CD × mes (todos los meses), con el total de cada CD y la fila Regional. */
  mapa: { cds: string[]; meses: string[]; valores: number[][]; total: number[]; regional: number[]; regionalTotal: number };
  detalle: FilaBaja[];
}

const nueva = (): Suma => ({ valor: 0, unidades: 0, movimientos: 0 });
const sumarEn = (s: Suma, f: FilaBaja) => { s.valor += f.valor; s.unidades += f.unidades; s.movimientos++; };
const porValor = <T extends Suma>(a: T, b: T) => b.valor - a.valor;

export function calcularBajas(filas: readonly FilaBaja[], filtro: FiltrosBajas = {}): ResultadoBajas {
  const cds = filtro.cds?.length ? new Set(filtro.cds) : null;
  const motivos = filtro.motivos?.length ? new Set(filtro.motivos) : null;
  const pasaOtros = (f: FilaBaja) => (!cds || cds.has(f.cd)) && (!motivos || motivos.has(f.motivo));
  const enRango = (f: FilaBaja) => (filtro.desde === undefined || f.fecha >= filtro.desde) && (filtro.hasta === undefined || f.fecha <= filtro.hasta);
  const sinFecha = filas.filter(pasaOtros);
  const base = sinFecha.filter(enRango);

  const tarjetas = { ...nueva(), anulado: 0, materiales: 0 };
  const materialesVistos = new Set<string>();
  const diaria = new Map<number, { fecha: number; valor: number; unidades: number }>();
  const porCd = new Map<string, { cd: string; gerencia: string } & Suma>();
  const porGerencia = new Map<string, { gerencia: string } & Suma>();
  const porMotivo = new Map<string, { motivo: string; nombre: string; grupo: Grupo } & Suma>();
  const porMaterial = new Map<string, { material: string; descripcion: string } & Suma>();
  for (const f of base) {
    sumarEn(tarjetas, f);
    if (f.anulacion) tarjetas.anulado -= f.valor;
    materialesVistos.add(f.material);
    const d = diaria.get(f.fecha) ?? { fecha: f.fecha, valor: 0, unidades: 0 };
    d.valor += f.valor; d.unidades += f.unidades; diaria.set(f.fecha, d);
    let cd = porCd.get(f.cd);
    if (!cd) { cd = { cd: f.cd, gerencia: f.gerencia, ...nueva() }; porCd.set(f.cd, cd); }
    sumarEn(cd, f);
    if (f.gerencia) {
      let g = porGerencia.get(f.gerencia);
      if (!g) { g = { gerencia: f.gerencia, ...nueva() }; porGerencia.set(f.gerencia, g); }
      sumarEn(g, f);
    }
    let m = porMotivo.get(f.motivo);
    if (!m) { m = { motivo: f.motivo, nombre: f.nombreMotivo, grupo: f.grupo, ...nueva() }; porMotivo.set(f.motivo, m); }
    sumarEn(m, f);
    let mat = porMaterial.get(f.material);
    if (!mat) { mat = { material: f.material, descripcion: f.descripcion, ...nueva() }; porMaterial.set(f.material, mat); }
    sumarEn(mat, f);
  }
  tarjetas.materiales = materialesVistos.size;

  // Tendencia mensual y mapa CD × mes: todos los meses (solo los filtros de CD y motivo).
  const mensual = new Map<string, { mes: string; grupos: Record<Grupo, number>; total: number }>();
  const celdas = new Map<string, number>();
  for (const f of sinFecha) {
    let m = mensual.get(f.mes);
    if (!m) { m = { mes: f.mes, grupos: { producto: 0, transporte: 0, ajustes: 0, otros: 0 }, total: 0 }; mensual.set(f.mes, m); }
    m.grupos[f.grupo] += f.valor;
    m.total += f.valor;
    const k = `${f.cd}|${f.mes}`;
    celdas.set(k, (celdas.get(k) ?? 0) + f.valor);
  }
  const meses = [...mensual.keys()].sort();
  const cdsMapa = [...new Set(sinFecha.map(f => f.cd))].sort((a, b) => a.localeCompare(b, 'es'));
  const valores = cdsMapa.map(cd => meses.map(mes => celdas.get(`${cd}|${mes}`) ?? 0));
  const regional = meses.map(mes => mensual.get(mes)!.total);

  return {
    tarjetas,
    mensual: meses.map(m => mensual.get(m)!),
    diaria: [...diaria.values()].sort((a, b) => a.fecha - b.fecha),
    porCd: [...porCd.values()].sort(porValor),
    porGerencia: [...porGerencia.values()].sort(porValor),
    porMotivo: [...porMotivo.values()].sort(porValor),
    materiales: [...porMaterial.values()].sort(porValor),
    mapa: { cds: cdsMapa, meses, valores, total: valores.map(fila => fila.reduce((s, v) => s + v, 0)), regional, regionalTotal: regional.reduce((s, v) => s + v, 0) },
    detalle: [...base].sort((a, b) => b.valor - a.valor),
  };
}

/** Opciones de los filtros: CD y motivos presentes, y el rango de fechas de los datos. */
export function opcionesBajas(filas: readonly FilaBaja[]) {
  const cds = [...new Set(filas.map(f => f.cd))].sort((a, b) => a.localeCompare(b, 'es'));
  const motivos = new Map<string, { motivo: string; nombre: string; grupo: Grupo }>();
  let desde: number | null = null, hasta: number | null = null;
  for (const f of filas) {
    if (!motivos.has(f.motivo)) motivos.set(f.motivo, { motivo: f.motivo, nombre: f.nombreMotivo, grupo: f.grupo });
    desde = desde === null ? f.fecha : Math.min(desde, f.fecha);
    hasta = hasta === null ? f.fecha : Math.max(hasta, f.fecha);
  }
  const orden = (g: Grupo) => GRUPOS.indexOf(g);
  return { cds, motivos: [...motivos.values()].sort((a, b) => orden(a.grupo) - orden(b.grupo) || a.nombre.localeCompare(b.nombre, 'es')), desde, hasta };
}
