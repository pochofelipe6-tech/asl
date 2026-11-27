// Inventario activos: suma de los conteos del formulario "Control de inventarios" (estibas, estibas plásticas,
// isotanques y HL pendientes por verter), igual que la página "Inventario activos" del Power BI.
// Regla para no inflar las cifras: si un CD envía varios conteos el MISMO día, cuenta solo el último de ese día
// (a veces se corrige reenviando el formulario). Los conteos de días distintos sí se suman, como en el Power BI.

/** Las cantidades del conteo, con su clave en el formulario (ver src/shared/formularios.ts). */
export const CANTIDADES = [
  'estibas_a', 'estibas_b', 'estibas_c',
  'cajas_250cc_x38', 'cajas_330cc_x30', 'cajas_750cc_x16', 'cajas_1000cc_x13', 'cajas_225cc_x38',
  'isotanques_llenos', 'isotanques_vacios', 'necesidad_isotanques', 'hl_pendientes_verter',
] as const;
export type Cantidad = typeof CANTIDADES[number];
export type Cantidades = Record<Cantidad, number>;

export interface Referencia { clave: Cantidad; nombre: string; corto: string }

/** En el orden del Power BI. El orden también fija el color de cada serie en los gráficos. */
export const ESTIBAS: readonly Referencia[] = [
  { clave: 'estibas_a', nombre: 'Estibas tipo A', corto: 'Tipo A' },
  { clave: 'estibas_b', nombre: 'Estibas tipo B', corto: 'Tipo B' },
  { clave: 'estibas_c', nombre: 'Estibas tipo C', corto: 'Tipo C' },
];
export const CAJAS: readonly Referencia[] = [
  { clave: 'cajas_250cc_x38', nombre: 'Estibas plásticas 250', corto: '250' },
  { clave: 'cajas_330cc_x30', nombre: 'Estibas plásticas 330', corto: '330' },
  { clave: 'cajas_750cc_x16', nombre: 'Estibas plásticas 750', corto: '750' },
  { clave: 'cajas_1000cc_x13', nombre: 'Estibas plásticas 1000', corto: '1000' },
  { clave: 'cajas_225cc_x38', nombre: 'Estibas plásticas 225', corto: '225' },
];
export const ISOTANQUES: readonly Referencia[] = [
  { clave: 'isotanques_llenos', nombre: 'Isotanques llenos', corto: 'Llenos' },
  { clave: 'isotanques_vacios', nombre: 'Isotanques vacíos', corto: 'Vacíos' },
];
export const HL: Referencia = { clave: 'hl_pendientes_verter', nombre: 'HL pendientes por verter', corto: 'HL' };

/** Un conteo tal como llega de /api/formularios/respuestas. */
export interface Conteo { id?: string; creado_en: string; respuestas: Record<string, unknown> }

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Día en Colombia (UTC−5, sin horario de verano) como "AAAA-MM-DD". Así el día no depende del reloj del equipo. */
export function diaColombia(fecha: Date | string | number): string {
  const ms = fecha instanceof Date ? fecha.getTime() : typeof fecha === 'string' ? Date.parse(fecha) : fecha;
  return new Date(ms - 5 * HORA).toISOString().slice(0, 10);
}

/** Suma (o resta) días a un día "AAAA-MM-DD". */
export function sumarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
}

/** Todos los días entre dos fechas, ambas incluidas (vacío si "desde" es posterior a "hasta"). */
export function diasEntre(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  for (let d = desde; d <= hasta && dias.length < 5000; d = sumarDias(d, 1)) dias.push(d);
  return dias;
}

export const enCero = (): Cantidades => Object.fromEntries(CANTIDADES.map(c => [c, 0])) as Cantidades;

/** Las cantidades de un conteo; las que faltan o vienen vacías (por ejemplo, cajas en null) valen 0. */
export function cantidadesDe(respuestas: Record<string, unknown>): Cantidades {
  const c = enCero();
  for (const clave of CANTIDADES) {
    const valor = respuestas[clave];
    if (typeof valor === 'number' && Number.isFinite(valor)) c[clave] = valor;
  }
  return c;
}

/** Suma "origen" dentro de "destino" y lo devuelve. Redondea a 4 decimales para que los HL no muestren 0,30000000004. */
export function sumarEn(destino: Cantidades, origen: Cantidades): Cantidades {
  for (const clave of CANTIDADES) destino[clave] = Math.round((destino[clave] + origen[clave]) * 1e4) / 1e4;
  return destino;
}

export const totalEstibas = (c: Cantidades) => c.estibas_a + c.estibas_b + c.estibas_c;
export const totalCajas = (c: Cantidades) => c.cajas_250cc_x38 + c.cajas_330cc_x30 + c.cajas_750cc_x16 + c.cajas_1000cc_x13 + c.cajas_225cc_x38;
export const totalIsotanques = (c: Cantidades) => c.isotanques_llenos + c.isotanques_vacios;

const cdDe = (conteo: Conteo) => (typeof conteo.respuestas.cd === 'string' && conteo.respuestas.cd.trim() ? conteo.respuestas.cd : null);

/**
 * Deja un solo conteo por CD y por día: el último que se envió ese día. Los demás de ese CD y ese día se descartan
 * (eran correcciones). Conteos sin CD o sin fecha válida no cuentan. Devuelve del más reciente al más antiguo.
 */
export function ultimoPorCdYDia<T extends Conteo>(conteos: readonly T[], diaDe: (ms: number) => string = diaColombia): T[] {
  const ultimos = new Map<string, { conteo: T; ms: number }>();
  for (const conteo of conteos) {
    const cd = cdDe(conteo);
    const ms = Date.parse(conteo.creado_en);
    if (!cd || Number.isNaN(ms)) continue;
    const clave = `${cd}\u0000${diaDe(ms)}`;
    const actual = ultimos.get(clave);
    if (!actual || ms > actual.ms) ultimos.set(clave, { conteo, ms });
  }
  return [...ultimos.values()].sort((a, b) => b.ms - a.ms).map(u => u.conteo);
}

export interface FiltroActivos {
  /** Primer día incluido, "AAAA-MM-DD". Sin él, desde el principio. */
  desde?: string;
  /** Último día incluido, "AAAA-MM-DD". Sin él, hasta el final. */
  hasta?: string;
  /** Solo este CD. Vacío: todos. */
  cd?: string;
}

export interface Fila { cantidades: Cantidades; conteos: number }

export interface ResumenActivos {
  /** Suma de todo lo que pasa el filtro. */
  total: Cantidades;
  /** Suma por CD (solo los CD con conteos en el filtro). */
  porCd: Map<string, Fila>;
  /** Suma por día "AAAA-MM-DD" (solo los días con conteos). */
  porDia: Map<string, Fila>;
  /** Conteos que se sumaron (uno por CD y por día). */
  conteos: number;
  /** Conteos del filtro que no se sumaron porque el mismo CD envió otro después, el mismo día. */
  repetidos: number;
}

/** Suma los conteos que pasan el filtro, con un solo conteo por CD y por día (el último de ese día). */
export function resumirActivos<T extends Conteo>(conteos: readonly T[], filtro: FiltroActivos = {}, diaDe: (ms: number) => string = diaColombia): ResumenActivos {
  const pasa = (conteo: Conteo) => {
    const cd = cdDe(conteo);
    const ms = Date.parse(conteo.creado_en);
    if (!cd || Number.isNaN(ms)) return false;
    if (filtro.cd && cd !== filtro.cd) return false;
    const dia = diaDe(ms);
    return (!filtro.desde || dia >= filtro.desde) && (!filtro.hasta || dia <= filtro.hasta);
  };
  const delFiltro = conteos.filter(pasa);
  const unicos = ultimoPorCdYDia(delFiltro, diaDe);
  const total = enCero();
  const porCd = new Map<string, Fila>();
  const porDia = new Map<string, Fila>();
  const acumular = (mapa: Map<string, Fila>, clave: string, c: Cantidades) => {
    const fila = mapa.get(clave) ?? { cantidades: enCero(), conteos: 0 };
    sumarEn(fila.cantidades, c);
    fila.conteos += 1;
    mapa.set(clave, fila);
  };
  for (const conteo of unicos) {
    const c = cantidadesDe(conteo.respuestas);
    sumarEn(total, c);
    acumular(porCd, cdDe(conteo)!, c);
    acumular(porDia, diaDe(Date.parse(conteo.creado_en)), c);
  }
  return { total, porCd, porDia, conteos: unicos.length, repetidos: delFiltro.length - unicos.length };
}

/** El día más reciente con algún conteo (de un CD, si se indica). Null si no hay ninguno. */
export function ultimoDiaConConteos(conteos: readonly Conteo[], cd = '', diaDe: (ms: number) => string = diaColombia): string | null {
  let ultimo: string | null = null;
  for (const conteo of conteos) {
    const ms = Date.parse(conteo.creado_en);
    if (!cdDe(conteo) || Number.isNaN(ms) || (cd && conteo.respuestas.cd !== cd)) continue;
    const dia = diaDe(ms);
    if (!ultimo || dia > ultimo) ultimo = dia;
  }
  return ultimo;
}

/** El día más antiguo con algún conteo. Null si no hay ninguno. */
export function primerDiaConConteos(conteos: readonly Conteo[], diaDe: (ms: number) => string = diaColombia): string | null {
  let primero: string | null = null;
  for (const conteo of conteos) {
    const ms = Date.parse(conteo.creado_en);
    if (!cdDe(conteo) || Number.isNaN(ms)) continue;
    const dia = diaDe(ms);
    if (!primero || dia < primero) primero = dia;
  }
  return primero;
}

/** Meses "AAAA-MM" con algún conteo, del más reciente al más antiguo. */
export function mesesConConteos(conteos: readonly Conteo[], diaDe: (ms: number) => string = diaColombia): string[] {
  const meses = new Set<string>();
  for (const conteo of conteos) {
    const ms = Date.parse(conteo.creado_en);
    if (cdDe(conteo) && !Number.isNaN(ms)) meses.add(diaDe(ms).slice(0, 7));
  }
  return [...meses].sort().reverse();
}

/** Último día de un mes "AAAA-MM", como "AAAA-MM-DD". */
export function finDeMes(mes: string): string {
  const [anio, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10);
}
