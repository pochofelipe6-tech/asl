// Seguimiento T1 (réplica de la página "Seguimiento T1" del Power BI "Seguimiento ATCT").
// Lo usan el navegador (lectura de los Excel y todos los cálculos), el servidor (validación de lo que se guarda)
// y el script de carga inicial. Las reglas salen del modelo de Power BI y se verificaron contra sus resultados
// (26/11/2026): cada cifra de la página coincide con Power BI con los mismos filtros.
//
// Reglas del modelo:
// - Cumplimiento ATCT = HORA(hh:mm) + MINUTO(hh:mm)/60 de la columna hh:mm de ATCT.xlsx (solo la hora del día;
//   la columna "Días" no suma). Cumplimiento espera = lo mismo con la columna "Espera" de ESPERA.xlsx.
// - Nombre CD sale de la tabla Gerencias (Ubicación de ATCT o UBI de ESPERA = "CD Rodar", sin distinguir mayúsculas).
//   Gerencia y OL salen de Gerencias por el Nombre CD.
// - Turnos por la hora de "Ingreso": A de 6:00 a 13:59, B de 14:00 a 21:59, C de 22:00 a 5:59. Si el ingreso no
//   trae hora (solo la fecha), Power BI lo toma como medianoche: turno C.
// - Semana = SEMANA(Fecha) de Excel/DAX tipo 1 (la semana empieza el domingo; la del 1 de enero es la 1).
// - ATCT se filtra por "Fecha"; ESPERA por el día de "Enturnamiento".
// - Casi todos los gráficos usan solo ATCT[Zona] = "Zona de atención". La espera no tiene zona: cuando ATCT tiene algún
//   filtro propio (zona, CD, gerencia, semana, turno o el eje del gráfico), la espera se limita a los CD de esas filas
//   de ATCT (relación ATCT–ESPERAS por Nombre CD en ambos sentidos); si no, toma todas las filas de espera de las fechas.
// - FTCT = promedio de atención + promedio de espera.
// - Exclusiones: atención mayor que 1,41 h (zona de atención) y espera mayor que 0,41 h.

export const ZONA_ATENCION = 'Zona de atención';
export const UMBRAL_EXCLUSION_ATENCION = 1.41;
export const UMBRAL_EXCLUSION_ESPERA = 0.41;
export const MAX_FILAS_T1 = 400_000;

export type Turno = 'A' | 'B' | 'C';
export type TipoCarga = 'atct' | 'espera';

/** Una fila de la tabla Gerencias. cdWip y cdFms son los nombres del CD en Data WIP.xlsx y en la lista de montacargas. */
export interface Gerencia { cdRodar: string; cd: string; gerencia: string; lider: string; gerente: string; ol: string; cdWip: string; cdFms: string }

/** Tabla "Gerencias" del modelo de Power BI (26/11/2026). */
export const GERENCIAS: readonly Gerencia[] = [
  { cdRodar: 'Arenosa', cd: 'La Arenosa', gerencia: 'Barranquilla', lider: 'Piedad Santiago', gerente: 'Jairo Tovar', ol: 'LIS', cdWip: 'La Arenosa', cdFms: 'La Arenosa' },
  { cdRodar: 'Galapa', cd: 'Galapa', gerencia: 'Barranquilla', lider: 'Victor Villa', gerente: 'Jairo Tovar', ol: 'ASL', cdWip: 'Galapa', cdFms: 'Galapa' },
  { cdRodar: 'LA ARENOSA', cd: 'La Arenosa', gerencia: 'Barranquilla', lider: 'Piedad Santiago', gerente: 'Jairo Tovar', ol: 'LIS', cdWip: 'La Arenosa', cdFms: 'La Arenosa' },
  { cdRodar: 'CARTAGENA', cd: 'Cartagena Ka', gerencia: 'Cartagena', lider: 'Adelfa Herrera', gerente: 'Marlon Gonzales', ol: 'CONALCA', cdWip: 'Cartagena Ka', cdFms: 'Cartagena Ka' },
  { cdRodar: 'Cartagena Ka', cd: 'Cartagena Ka', gerencia: 'Cartagena', lider: 'Adelfa Herrera', gerente: 'Marlon Gonzales', ol: 'CONALCA', cdWip: 'Cartagena Ka', cdFms: 'Cartagena Ka' },
  { cdRodar: 'Turbaco', cd: 'Turbaco', gerencia: 'Cartagena', lider: 'Adelfa Herrera', gerente: 'Marlon Gonzales', ol: 'CONALCA', cdWip: 'Turbaco', cdFms: 'Turbaco' },
  { cdRodar: 'CUCUTA', cd: 'Cucuta', gerencia: 'Cucuta', lider: 'Lizeth Martinez', gerente: 'Karen Molina', ol: 'LIS', cdWip: 'Cucuta', cdFms: 'Cúcuta' },
  { cdRodar: 'Cúcuta', cd: 'Cucuta', gerencia: 'Cucuta', lider: 'Lizeth Martinez', gerente: 'Karen Molina', ol: 'LIS', cdWip: 'Cucuta', cdFms: 'Cúcuta' },
  { cdRodar: 'APARTADO', cd: 'Apartado', gerencia: 'Monteria', lider: 'Pedro Osorio', gerente: 'Gerson Vanegas', ol: 'ASL', cdWip: 'Apartado', cdFms: 'Apartado' },
  { cdRodar: 'Apartadó', cd: 'Apartado', gerencia: 'Monteria', lider: 'Pedro Osorio', gerente: 'Gerson Vanegas', ol: 'ASL', cdWip: 'Apartado', cdFms: 'Apartado' },
  { cdRodar: 'CAUCASIA', cd: 'Caucasia', gerencia: 'Monteria', lider: 'Jose Acosta', gerente: 'Gerson Vanegas', ol: 'ASL', cdWip: 'Caucasia', cdFms: 'Caucasia' },
  { cdRodar: 'MONTERIA', cd: 'Monteria', gerencia: 'Monteria', lider: 'Jose Acosta', gerente: 'Gerson Vanegas', ol: 'ASL', cdWip: 'Monteria', cdFms: 'Monteria' },
  { cdRodar: 'Montería', cd: 'Monteria', gerencia: 'Monteria', lider: 'Jose Acosta', gerente: 'Gerson Vanegas', ol: 'ASL', cdWip: 'Monteria', cdFms: 'Monteria' },
  { cdRodar: 'Riohacha', cd: 'Riohacha', gerencia: 'Santa Marta', lider: 'Victor Villa', gerente: 'Juan Vega', ol: 'SEDIAL', cdWip: 'Riohacha', cdFms: 'Riohacha' },
  { cdRodar: 'Santa Marta', cd: 'Santa Marta', gerencia: 'Santa Marta', lider: 'Victor Villa', gerente: 'Juan Vega', ol: 'LIS', cdWip: 'Santa Marta', cdFms: 'Santa Marta' },
  { cdRodar: 'Corozal', cd: 'Corozal', gerencia: 'Sincelejo', lider: 'Alfonso Iriarte', gerente: 'Snaider Polo', ol: 'SEDIAL', cdWip: 'Corozal', cdFms: 'Corozal' },
  { cdRodar: 'MAGANGUE', cd: 'Magangue', gerencia: 'Sincelejo', lider: 'Liseth Peña', gerente: 'Snaider Polo', ol: 'SEDIAL', cdWip: 'Magangue', cdFms: 'Magangué' },
  { cdRodar: 'Magangué', cd: 'Magangue', gerencia: 'Sincelejo', lider: 'Liseth Peña', gerente: 'Snaider Polo', ol: 'SEDIAL', cdWip: 'Magangue', cdFms: 'Magangué' },
  { cdRodar: 'CURUMANI', cd: 'Curumani', gerencia: 'Valledupar', lider: 'Brayan Epalza', gerente: 'Guadalupe Montero', ol: 'SEDIAL', cdWip: 'Curumani', cdFms: 'Curumani' },
  { cdRodar: 'Curumaní', cd: 'Curumani', gerencia: 'Valledupar', lider: 'Brayan Epalza', gerente: 'Guadalupe Montero', ol: 'SEDIAL', cdWip: 'Curumani', cdFms: 'Curumani' },
  { cdRodar: 'Fonseca', cd: 'Fonseca', gerencia: 'Valledupar', lider: 'Eduardo Diaz', gerente: 'Guadalupe Montero', ol: 'SEDIAL', cdWip: 'Fonseca', cdFms: 'Fonseca' },
  { cdRodar: 'Valledupar', cd: 'Valledupar', gerencia: 'Valledupar', lider: 'Eduardo Diaz', gerente: 'Guadalupe Montero', ol: 'SEDIAL', cdWip: 'Valledupar', cdFms: 'Valledupar' },
  { cdRodar: 'San Andres', cd: 'San Andres', gerencia: 'Cartagena', lider: 'Laura Muñoz', gerente: 'Marlon Gonzales', ol: 'IM', cdWip: 'San Andres', cdFms: 'San Andres' },
  { cdRodar: '', cd: 'UDC Torices', gerencia: 'Cartagena', lider: 'Sirith Avecedo', gerente: 'Marlon Gonzales', ol: 'PC', cdWip: '', cdFms: 'UDC Torices' },
];

// Comparación como en el modelo: sin distinguir mayúsculas, pero sí tildes ("Montería" ≠ "Monteria").
const clave = (v: unknown) => String(v ?? '').trim().toLocaleLowerCase('es');
const porRodar = new Map(GERENCIAS.filter(g => g.cdRodar).map(g => [clave(g.cdRodar), g]));
const porNombre = new Map<string, Gerencia>();
for (const g of GERENCIAS) if (!porNombre.has(clave(g.cd))) porNombre.set(clave(g.cd), g);
/** Nombre del CD según la tabla Gerencias ('' si la ubicación no está en la tabla). */
export const cdDeUbicacion = (ubicacion: unknown) => porRodar.get(clave(ubicacion))?.cd ?? '';
export const gerenciaDeCd = (cd: string) => porNombre.get(clave(cd));

// ---------- Fechas (días de Excel: 1 = 01/01/1900; 46327 = 01/11/2026) ----------

const EPOCA = Date.UTC(1899, 11, 30);
export const fechaDeDia = (dia: number) => new Date(EPOCA + dia * 86_400_000);
export const diaDeFecha = (f: Date) => Math.round((Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()) - EPOCA) / 86_400_000);
/** Día de Excel de "AAAA-MM-DD". */
export const diaDeIso = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(a, m - 1, d) - EPOCA) / 86_400_000); };
export const isoDeDia = (dia: number) => fechaDeDia(dia).toISOString().slice(0, 10);
/** 0 = domingo … 6 = sábado. */
export const diaSemana = (dia: number) => fechaDeDia(dia).getUTCDay();
export const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'] as const;
/** SEMANA(fecha) de Excel/DAX tipo 1. */
export function semanaDe(dia: number): number {
  const f = fechaDeDia(dia);
  const ene1 = Date.UTC(f.getUTCFullYear(), 0, 1);
  return Math.floor(((f.getTime() - ene1) / 86_400_000 + new Date(ene1).getUTCDay()) / 7) + 1;
}
/** "2026-11" del día. */
export const mesDe = (dia: number) => isoDeDia(dia).slice(0, 7);

// ---------- Lectura de los Excel ----------

export const COLUMNAS_ATCT = ['Fecha', 'Registro', 'Placa', 'Ubicación', 'Zona', 'Ingreso', 'Salida', 'Días', 'hh:mm'] as const;
export const COLUMNAS_ESPERA = ['Placa', 'Hora programada', 'Enturnamiento', 'Inicio cargue/descargue', 'Fin cargue/descargue', 'Espera', 'Atención', 'FTCT', 'UBI'] as const;
const texto = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
/** Qué tipo de archivo es por su encabezado, o null. */
export function tipoDeEncabezado(cabecera: readonly unknown[]): TipoCarga | null {
  const igual = (cols: readonly string[]) => cols.every((c, i) => texto(cabecera[i]) === texto(c));
  return igual(COLUMNAS_ATCT) ? 'atct' : igual(COLUMNAS_ESPERA) ? 'espera' : null;
}

/** Fecha y hora de Excel en segundos desde 1899-12-30 (para guardar sin decimales). null si no es fecha. */
function segundosExcel(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v * 86_400);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return Math.round((v.getTime() - EPOCA) / 1000);
  if (typeof v === 'string') {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?)?$/i.exec(v.trim());
    if (!m) return null;
    let h = Number(m[4] ?? 0);
    if (m[7]) h = (h % 12) + (/p/i.test(m[7]) ? 12 : 0);
    const ms = Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h, Number(m[5] ?? 0), Number(m[6] ?? 0));
    return Math.round((ms - EPOCA) / 1000);
  }
  return null;
}
/** Minutos de la hora del día (HORA*60 + MINUTO) de un valor de hora de Excel o de un texto "HH:MM[:SS]". */
export function minutosDelDia(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    const s = Math.round((v - Math.floor(v)) * 86_400) % 86_400;
    return Math.floor(s / 3600) * 60 + Math.floor((s % 3600) / 60);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getUTCHours() * 60 + v.getUTCMinutes();
  if (typeof v === 'string') {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  return null;
}
/** Hora del "Ingreso" (texto como "1/1/2026 2:30:44 PM") en minutos; sin hora, medianoche (como Power BI). */
export function minutosIngreso(ingreso: string): number {
  const m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]\.?\s?M\.?)?/i.exec(ingreso.slice(-11));
  if (!m) return 0;
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return h * 60 + Number(m[2]);
}
export const turnoDe = (minutos: number): Turno => (minutos >= 360 && minutos < 840 ? 'A' : minutos >= 840 && minutos < 1320 ? 'B' : 'C');

/** Datos de ATCT en columnas (compacto para guardar y enviar). Placa, ubicación y zona van como índices de su lista. */
export interface ColumnasAtct {
  tipo: 'atct'; version: 1;
  fecha: number[]; registro: string[]; placa: number[]; ubicacion: number[]; zona: number[];
  ingreso: string[]; salida: string[]; dias: number[]; minutos: number[];
  placas: string[]; ubicaciones: string[]; zonas: string[];
}
/** Datos de ESPERA en columnas. Las fechas y horas, en segundos desde 1899-12-30. */
export interface ColumnasEspera {
  tipo: 'espera'; version: 1;
  placa: number[]; programada: number[]; enturnamiento: number[]; inicio: number[]; fin: number[];
  espera: string[]; atencion: string[]; ftct: string[]; ubi: number[];
  placas: string[]; ubis: string[];
}
export type ColumnasT1 = ColumnasAtct | ColumnasEspera;
export interface Lectura<T> { columnas: T; filas: number; omitidas: { fila: number; motivo: string }[]; desde: number | null; hasta: number | null }

function indexador() {
  const lista: string[] = [];
  const mapa = new Map<string, number>();
  return { lista, indice(v: string) { let i = mapa.get(v); if (i === undefined) { i = lista.length; lista.push(v); mapa.set(v, i); } return i; } };
}
const vacia = (r: readonly unknown[] | undefined) => !r || !r.some(v => v !== null && v !== undefined && v !== '');
const cadena = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v).trim());

/** Lee la hoja "Export" de ATCT.xlsx (filas crudas, la primera es el encabezado). Lanza un Error si el archivo no sirve. */
export function leerAtct(filas: readonly (readonly unknown[])[]): Lectura<ColumnasAtct> {
  if (tipoDeEncabezado(filas[0] ?? []) !== 'atct') throw new Error(`El archivo no tiene las columnas de ATCT: ${COLUMNAS_ATCT.join(', ')}.`);
  const placas = indexador(), ubicaciones = indexador(), zonas = indexador();
  const c: ColumnasAtct = { tipo: 'atct', version: 1, fecha: [], registro: [], placa: [], ubicacion: [], zona: [], ingreso: [], salida: [], dias: [], minutos: [], placas: placas.lista, ubicaciones: ubicaciones.lista, zonas: zonas.lista };
  const omitidas: { fila: number; motivo: string }[] = [];
  let desde: number | null = null, hasta: number | null = null;
  for (let i = 1; i < filas.length; i++) {
    const r = filas[i];
    if (vacia(r)) continue;
    const seg = segundosExcel(r[0]);
    const minutos = minutosDelDia(r[8]);
    if (seg === null) { omitidas.push({ fila: i + 1, motivo: 'Fecha no válida' }); continue; }
    if (minutos === null) { omitidas.push({ fila: i + 1, motivo: 'hh:mm no válido' }); continue; }
    if (c.fecha.length >= MAX_FILAS_T1) throw new Error(`El archivo supera ${MAX_FILAS_T1.toLocaleString('es-CO')} filas.`);
    const dia = Math.floor(seg / 86_400);
    desde = desde === null ? dia : Math.min(desde, dia);
    hasta = hasta === null ? dia : Math.max(hasta, dia);
    c.fecha.push(dia);
    c.registro.push(cadena(r[1]));
    c.placa.push(placas.indice(cadena(r[2])));
    c.ubicacion.push(ubicaciones.indice(cadena(r[3])));
    c.zona.push(zonas.indice(cadena(r[4])));
    c.ingreso.push(cadena(r[5]));
    c.salida.push(cadena(r[6]));
    c.dias.push(Number.isFinite(Number(r[7])) ? Number(r[7]) : 0);
    c.minutos.push(minutos);
  }
  if (!c.fecha.length) throw new Error('La hoja de ATCT no tiene registros.');
  return { columnas: c, filas: c.fecha.length, omitidas, desde, hasta };
}

/** Lee la hoja "Export" de ESPERA.xlsx. Lanza un Error si el archivo no sirve. */
export function leerEspera(filas: readonly (readonly unknown[])[]): Lectura<ColumnasEspera> {
  if (tipoDeEncabezado(filas[0] ?? []) !== 'espera') throw new Error(`El archivo no tiene las columnas de ESPERA: ${COLUMNAS_ESPERA.join(', ')}.`);
  const placas = indexador(), ubis = indexador();
  const c: ColumnasEspera = { tipo: 'espera', version: 1, placa: [], programada: [], enturnamiento: [], inicio: [], fin: [], espera: [], atencion: [], ftct: [], ubi: [], placas: placas.lista, ubis: ubis.lista };
  const omitidas: { fila: number; motivo: string }[] = [];
  let desde: number | null = null, hasta: number | null = null;
  for (let i = 1; i < filas.length; i++) {
    const r = filas[i];
    if (vacia(r)) continue;
    const entur = segundosExcel(r[2]);
    if (entur === null) { omitidas.push({ fila: i + 1, motivo: 'Enturnamiento no válido' }); continue; }
    if (minutosDelDia(r[5]) === null) { omitidas.push({ fila: i + 1, motivo: 'Espera no válida' }); continue; }
    if (c.placa.length >= MAX_FILAS_T1) throw new Error(`El archivo supera ${MAX_FILAS_T1.toLocaleString('es-CO')} filas.`);
    const dia = Math.floor(entur / 86_400);
    desde = desde === null ? dia : Math.min(desde, dia);
    hasta = hasta === null ? dia : Math.max(hasta, dia);
    c.placa.push(placas.indice(cadena(r[0])));
    c.programada.push(segundosExcel(r[1]) ?? 0);
    c.enturnamiento.push(entur);
    c.inicio.push(segundosExcel(r[3]) ?? 0);
    c.fin.push(segundosExcel(r[4]) ?? 0);
    c.espera.push(cadena(r[5]));
    c.atencion.push(cadena(r[6]));
    c.ftct.push(cadena(r[7]));
    c.ubi.push(ubis.indice(cadena(r[8])));
  }
  if (!c.placa.length) throw new Error('La hoja de ESPERA no tiene registros.');
  return { columnas: c, filas: c.placa.length, omitidas, desde, hasta };
}

/** Revisa que lo recibido tenga la forma de ColumnasAtct o ColumnasEspera (lo usa el servidor antes de guardar). */
export function validarColumnas(datos: unknown, tipo: TipoCarga): string | null {
  if (!datos || typeof datos !== 'object') return 'Los datos no son válidos.';
  const d = datos as Record<string, unknown>;
  if (d.tipo !== tipo || d.version !== 1) return 'El tipo de archivo no coincide.';
  const listas = tipo === 'atct'
    ? { numeros: ['fecha', 'placa', 'ubicacion', 'zona', 'dias', 'minutos'], textos: ['registro', 'ingreso', 'salida'], diccionarios: ['placas', 'ubicaciones', 'zonas'] }
    : { numeros: ['placa', 'programada', 'enturnamiento', 'inicio', 'fin', 'ubi'], textos: ['espera', 'atencion', 'ftct'], diccionarios: ['placas', 'ubis'] };
  const n = (d[listas.numeros[0]] as unknown[] | undefined)?.length ?? -1;
  if (n < 1 || n > MAX_FILAS_T1) return 'La cantidad de filas no es válida.';
  for (const k of listas.numeros) { const a = d[k]; if (!Array.isArray(a) || a.length !== n || !a.every(v => typeof v === 'number' && Number.isFinite(v))) return `La columna ${k} no es válida.`; }
  for (const k of listas.textos) { const a = d[k]; if (!Array.isArray(a) || a.length !== n || !a.every(v => typeof v === 'string' && v.length <= 120)) return `La columna ${k} no es válida.`; }
  for (const k of listas.diccionarios) { const a = d[k]; if (!Array.isArray(a) || a.length > MAX_FILAS_T1 || !a.every(v => typeof v === 'string' && v.length <= 120)) return `La lista ${k} no es válida.`; }
  const rango = (col: string, dic: string) => { const max = (d[dic] as unknown[]).length; return (d[col] as number[]).every(i => Number.isInteger(i) && i >= 0 && i < max); };
  const ok = tipo === 'atct'
    ? rango('placa', 'placas') && rango('ubicacion', 'ubicaciones') && rango('zona', 'zonas') && (d.minutos as number[]).every(m => m >= 0 && m < 1440)
    : rango('placa', 'placas') && rango('ubi', 'ubis');
  return ok ? null : 'Hay índices fuera de rango.';
}

// ---------- Filas listas para calcular ----------

export interface FilaAtct {
  fecha: number; registro: string; placa: string; ubicacion: string; zona: string; atencion: boolean;
  ingreso: string; salida: string; dias: number; minutos: number; horas: number;
  cd: string; gerencia: string; ol: string; turno: Turno; semana: number; diaSemana: number; mes: string;
}
export interface FilaEspera {
  placa: string; programada: number; enturnamiento: number; inicio: number; fin: number;
  espera: string; atencionTexto: string; ftct: string; ubi: string;
  fecha: number; horas: number; cd: string; diaSemana: number; mes: string;
}
export interface DatosT1 { atct: FilaAtct[]; espera: FilaEspera[] }

export function filasAtct(c: ColumnasAtct): FilaAtct[] {
  const cdPorUbicacion = c.ubicaciones.map(cdDeUbicacion);
  const filas: FilaAtct[] = new Array(c.fecha.length);
  for (let i = 0; i < c.fecha.length; i++) {
    const cd = cdPorUbicacion[c.ubicacion[i]];
    const g = gerenciaDeCd(cd);
    const zona = c.zonas[c.zona[i]];
    filas[i] = {
      fecha: c.fecha[i], registro: c.registro[i], placa: c.placas[c.placa[i]], ubicacion: c.ubicaciones[c.ubicacion[i]], zona, atencion: zona === ZONA_ATENCION,
      ingreso: c.ingreso[i], salida: c.salida[i], dias: c.dias[i], minutos: c.minutos[i], horas: c.minutos[i] / 60,
      cd, gerencia: g?.gerencia ?? '', ol: g?.ol ?? '', turno: turnoDe(minutosIngreso(c.ingreso[i])),
      semana: semanaDe(c.fecha[i]), diaSemana: diaSemana(c.fecha[i]), mes: mesDe(c.fecha[i]),
    };
  }
  return filas;
}
export function filasEspera(c: ColumnasEspera): FilaEspera[] {
  const cdPorUbi = c.ubis.map(cdDeUbicacion);
  const filas: FilaEspera[] = new Array(c.placa.length);
  for (let i = 0; i < c.placa.length; i++) {
    const fecha = Math.floor(c.enturnamiento[i] / 86_400);
    filas[i] = {
      placa: c.placas[c.placa[i]], programada: c.programada[i], enturnamiento: c.enturnamiento[i], inicio: c.inicio[i], fin: c.fin[i],
      espera: c.espera[i], atencionTexto: c.atencion[i], ftct: c.ftct[i], ubi: c.ubis[c.ubi[i]],
      fecha, horas: (minutosDelDia(c.espera[i]) ?? 0) / 60, cd: cdPorUbi[c.ubi[i]], diaSemana: diaSemana(fecha), mes: mesDe(fecha),
    };
  }
  return filas;
}

// ---------- Cálculos de la página ----------

export interface FiltrosT1 {
  /** Rango de fechas en días de Excel (incluye ambos extremos). */
  desde?: number | null; hasta?: number | null;
  cds?: readonly string[]; gerencias?: readonly string[]; semanas?: readonly number[];
  /** 0 = domingo … 6 = sábado. */
  diasSemana?: readonly number[]; turnos?: readonly Turno[];
}
export interface Par { atencion: number | null; espera: number | null }
export interface ResultadoT1 {
  tarjetas: { vehiculos: number; atencion: number | null; espera: number | null; ftct: number | null };
  /** Todos los meses (como en Power BI, no le afectan el rango de fechas ni la semana). */
  mensual: ({ mes: string } & Par)[];
  diaria: ({ fecha: number } & Par)[];
  porCd: { cd: string; atencion: number | null; espera: number | null; ftct: number | null }[];
  porDiaSemana: ({ dia: number } & Par)[];
  porTurno: ({ turno: Turno } & Par)[];
  porGerencia: { gerencia: string; atencion: number | null }[];
  porOl: { ol: string; atencion: number | null }[];
  /** Solo atención y sin filtro de zona, como el gráfico "Tendencia semanal" del Power BI. */
  porSemana: { semana: number; atencion: number | null }[];
  mapaAtencion: Mapa; mapaEspera: Mapa;
  detalleAtencion: { fecha: number; placa: string; minutos: number; horas: number }[];
  detalleEspera: { fecha: number; placa: string; espera: string; horas: number }[];
  atencionPorPlaca: { placa: string; horas: number }[];
  esperaPorPlaca: { placa: string; horas: number }[];
  exclusionesAtencion: FilaAtct[];
  exclusionesEspera: FilaEspera[];
}
export interface Mapa { cds: string[]; fechas: number[]; valores: (number | null)[][] }
export interface OpcionesT1 { cds: string[]; gerencias: string[]; semanas: number[]; turnos: Turno[]; desde: number | null; hasta: number | null; ultimaEspera: number | null }

const promedio = (filas: readonly { horas: number }[]) => { if (!filas.length) return null; let s = 0; for (const f of filas) s += f.horas; return s / filas.length; };
const sumar = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
function agrupar<T, K>(lista: readonly T[], clave: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of lista) { const k = clave(x); const g = m.get(k); if (g) g.push(x); else m.set(k, [x]); }
  return m;
}
const orden = new Intl.Collator('es', { numeric: true }).compare;

/** Valores de los filtros (como los segmentadores del Power BI, que salen de ATCT) y el rango de fechas de los datos. */
export function opcionesT1(datos: DatosT1): OpcionesT1 {
  const cds = new Set<string>(), gerencias = new Set<string>(), semanas = new Set<number>();
  let desde: number | null = null, hasta: number | null = null;
  for (const f of datos.atct) {
    if (f.cd) cds.add(f.cd);
    if (f.gerencia) gerencias.add(f.gerencia);
    semanas.add(f.semana);
    desde = desde === null ? f.fecha : Math.min(desde, f.fecha);
    hasta = hasta === null ? f.fecha : Math.max(hasta, f.fecha);
  }
  let ultimaEspera: number | null = null;
  for (const e of datos.espera) ultimaEspera = ultimaEspera === null ? e.fecha : Math.max(ultimaEspera, e.fecha);
  return { cds: [...cds].sort(orden), gerencias: [...gerencias].sort(orden), semanas: [...semanas].sort((a, b) => a - b), turnos: ['A', 'B', 'C'], desde, hasta, ultimaEspera };
}

/** Espera agrupada por día (se arma una vez por juego de datos): así no se recorren las ~28.000 filas en cada cálculo. */
interface IndiceEspera { fechas: number[]; porFecha: Map<number, FilaEspera[]> }
const indices = new WeakMap<readonly FilaEspera[], IndiceEspera>();
function indiceEspera(espera: readonly FilaEspera[]): IndiceEspera {
  let indice = indices.get(espera);
  if (!indice) {
    const porFecha = agrupar(espera, e => e.fecha);
    indice = { fechas: [...porFecha.keys()].sort((a, b) => a - b), porFecha };
    indices.set(espera, indice);
  }
  return indice;
}

export function calcularT1(datos: DatosT1, f: FiltrosT1 = {}): ResultadoT1 {
  const cds = f.cds?.length ? new Set(f.cds.map(clave)) : null;
  const gerencias = f.gerencias?.length ? new Set(f.gerencias) : null;
  const semanas = f.semanas?.length ? new Set(f.semanas) : null;
  const diasSem = f.diasSemana?.length ? new Set(f.diasSemana) : null;
  const turnos = f.turnos?.length ? new Set(f.turnos) : null;
  const enRango = (dia: number) => (f.desde == null || dia >= f.desde) && (f.hasta == null || dia <= f.hasta);
  const fechaOk = (dia: number) => enRango(dia) && (!diasSem || diasSem.has(diaSemana(dia)));
  /** Filtros de los segmentadores que caen sobre columnas de ATCT (sin fechas). */
  const pasaAtct = (x: FilaAtct, conSemana = true) => (!cds || cds.has(clave(x.cd))) && (!gerencias || gerencias.has(x.gerencia))
    && (!conSemana || !semanas || semanas.has(x.semana)) && (!turnos || turnos.has(x.turno));
  const hayFiltroAtct = !!(cds || gerencias || semanas || turnos);

  const indice = indiceEspera(datos.espera);
  /** Espera de las fechas que pasan "fecha" (o solo del día "unico"), limitada a los CD de "atct" (sin límite si es null). */
  const esperaDe = (atct: readonly FilaAtct[] | null, fecha: (dia: number) => boolean, unico?: number) => {
    const cdsAtct = atct ? new Set(atct.map(x => x.cd)) : null;
    const salida: FilaEspera[] = [];
    for (const dia of unico === undefined ? indice.fechas.filter(fecha) : [unico]) {
      for (const e of indice.porFecha.get(dia) ?? []) if (!cdsAtct || cdsAtct.has(e.cd)) salida.push(e);
    }
    return salida;
  };

  const base = datos.atct.filter(x => fechaOk(x.fecha) && pasaAtct(x));
  const zona = base.filter(x => x.atencion);
  const atencionZona = promedio(zona);
  const esperaZona = esperaDe(zona, fechaOk);

  // Tendencia mensual: no le afectan el rango de fechas ni la semana.
  const sinFechas = datos.atct.filter(x => x.atencion && (!diasSem || diasSem.has(x.diaSemana)) && pasaAtct(x, false));
  const meses = new Set([...sinFechas.map(x => x.mes), ...datos.espera.map(e => e.mes)]);
  const sinFechasPorMes = agrupar(sinFechas, x => x.mes);
  const mensual = [...meses].sort().map(mes => {
    const at = sinFechasPorMes.get(mes) ?? [];
    return { mes, atencion: promedio(at), espera: promedio(esperaDe(at, dia => mesDe(dia) === mes && (!diasSem || diasSem.has(diaSemana(dia))))) };
  }).filter(m => m.atencion !== null || m.espera !== null);

  const zonaPorFecha = agrupar(zona, x => x.fecha);
  const fechas = [...new Set([...zonaPorFecha.keys(), ...esperaZona.map(e => e.fecha)])].sort((a, b) => a - b);
  const diaria = fechas.map(fecha => { const at = zonaPorFecha.get(fecha) ?? []; return { fecha, atencion: promedio(at), espera: promedio(esperaDe(at, () => true, fecha)) }; });

  const basePorCd = agrupar(base, x => x.cd);
  const porCd = [...basePorCd.keys()].filter(Boolean).sort(orden).map(cd => {
    const todas = basePorCd.get(cd)!;
    const at = todas.filter(x => x.atencion);
    const atencion = promedio(at);
    return { cd, atencion, espera: promedio(esperaDe(todas, fechaOk)), ftct: at.length ? sumar(atencion, promedio(esperaDe(at, fechaOk))) : null };
  });

  const porDiaSemana = [1, 2, 3, 4, 5, 6, 0].map(dia => { const at = zona.filter(x => x.diaSemana === dia); return { dia, atencion: promedio(at), espera: promedio(esperaDe(at, d => fechaOk(d) && diaSemana(d) === dia)) }; })
    .filter(d => d.atencion !== null || d.espera !== null);
  const porTurno = (['A', 'B', 'C'] as const).map(turno => { const at = zona.filter(x => x.turno === turno); return { turno, atencion: promedio(at), espera: promedio(esperaDe(at, fechaOk)) }; })
    .filter(t => t.atencion !== null);
  const porGerencia = [...agrupar(zona, x => x.gerencia)].filter(([g]) => g).sort(([a], [b]) => orden(a, b)).map(([gerencia, g]) => ({ gerencia, atencion: promedio(g) }));
  const porOl = [...agrupar(zona, x => x.ol)].filter(([o]) => o).sort(([a], [b]) => orden(a, b)).map(([ol, g]) => ({ ol, atencion: promedio(g) }));
  const porSemana = [...agrupar(base, x => x.semana)].sort(([a], [b]) => a - b).map(([semana, g]) => ({ semana, atencion: promedio(g) }));

  const mapa = (valor: (cd: string, fecha: number, at: FilaAtct[]) => number | null): Mapa => {
    const porCdFecha = agrupar(zona, x => `${x.cd}|${x.fecha}`);
    const cdsMapa = [...new Set(zona.map(x => x.cd))].filter(Boolean).sort(orden);
    const fechasMapa = [...zonaPorFecha.keys()].sort((a, b) => a - b);
    return { cds: cdsMapa, fechas: fechasMapa, valores: cdsMapa.map(cd => fechasMapa.map(fecha => valor(cd, fecha, porCdFecha.get(`${cd}|${fecha}`) ?? []))) };
  };
  const mapaAtencion = mapa((_cd, _f, at) => promedio(at));
  const mapaEspera = mapa((_cd, fecha, at) => (at.length ? promedio(esperaDe(at, () => true, fecha)) : null));

  const detalleAtencion = [...agrupar(zona, x => `${x.fecha}|${x.placa}|${x.minutos}`).values()]
    .map(g => ({ fecha: g[0].fecha, placa: g[0].placa, minutos: g[0].minutos, horas: g.reduce((s, x) => s + x.horas, 0) }))
    .sort((a, b) => b.fecha - a.fecha || b.horas - a.horas);
  const detalleEspera = [...agrupar(esperaZona, e => `${e.fecha}|${e.placa}|${e.espera}`).values()]
    .map(g => ({ fecha: g[0].fecha, placa: g[0].placa, espera: g[0].espera, horas: g.reduce((s, x) => s + x.horas, 0) }))
    .sort((a, b) => b.fecha - a.fecha || b.horas - a.horas);
  const atencionPorPlaca = [...agrupar(zona, x => x.placa)].map(([placa, g]) => ({ placa, horas: promedio(g)! })).sort((a, b) => b.horas - a.horas);
  const esperaPorPlaca = [...agrupar(esperaZona, e => e.placa)].map(([placa, g]) => ({ placa, horas: g.reduce((s, x) => s + x.horas, 0) })).sort((a, b) => b.horas - a.horas);

  return {
    tarjetas: { vehiculos: zona.length, atencion: atencionZona, espera: promedio(esperaDe(hayFiltroAtct ? base : null, fechaOk)), ftct: zona.length ? sumar(atencionZona, promedio(esperaZona)) : null },
    mensual, diaria, porCd, porDiaSemana, porTurno, porGerencia, porOl, porSemana, mapaAtencion, mapaEspera,
    detalleAtencion, detalleEspera, atencionPorPlaca, esperaPorPlaca,
    exclusionesAtencion: zona.filter(x => x.horas > UMBRAL_EXCLUSION_ATENCION),
    exclusionesEspera: esperaDe(hayFiltroAtct ? base : null, fechaOk).filter(e => e.horas > UMBRAL_EXCLUSION_ESPERA),
  };
}

/** Horas decimales en "h:mm" (1,42 h → "1:25"). */
export function horasATexto(horas: number | null): string {
  if (horas === null || !Number.isFinite(horas)) return '—';
  const minutos = Math.round(horas * 60);
  return `${Math.floor(minutos / 60)}:${String(minutos % 60).padStart(2, '0')}`;
}
