// Formularios del módulo "Control de inventarios": copia de las preguntas del
// Microsoft Form de la Regional Norte. Las respuestas se guardan en Supabase
// (tabla formularios_respuestas, ver supabase/formularios_schema.sql).
// Para agregar preguntas basta con añadirlas aquí: el formulario y la tabla se arman solos.
export type TipoPregunta = 'texto' | 'parrafo' | 'numero' | 'fecha' | 'lista' | 'opcion';

export interface Pregunta {
  /** Clave con la que se guarda la respuesta. No cambiarla una vez haya respuestas guardadas. */
  id: string;
  titulo: string;
  /** Nombre corto para encabezados de tablas y gráficos. */
  corto?: string;
  tipo: TipoPregunta;
  obligatoria?: boolean;
  /** Opciones de 'lista' (desplegable) y 'opcion' (botones de selección). */
  opciones?: readonly string[];
  /** 'numero': valor mínimo permitido. */
  minimo?: number;
  /** 'numero': solo números enteros. */
  entero?: boolean;
}

export interface Seccion {
  titulo: string;
  descripcion?: string;
  /** Sus cantidades son de la misma clase y tiene sentido sumarlas (columna Total en el resumen). */
  sumable?: boolean;
  preguntas: readonly Pregunta[];
}

export interface Formulario {
  id: string;
  titulo: string;
  descripcion?: string;
  secciones: readonly Seccion[];
}

export type Valor = string | number | null;
export type Respuestas = Record<string, Valor>;

export const CDS_REGIONAL_NORTE = [
  'Apartado', 'Cartagena KA', 'Caucasia', 'Corozal', 'Cucuta', 'Curumani', 'Fonseca', 'Galapa',
  'La Arenosa', 'Magangue', 'Monteria', 'Riohacha', 'San Andres', 'Santa Marta', 'Turbaco', 'Valledupar',
] as const;

/** Cantidades contadas en unidades: enteras y sin negativos. */
const UNIDADES = { tipo: 'numero', entero: true, minimo: 0 } as const;
const EN_UNIDADES = 'Indique todas las respuestas en unidades';

export const FORMULARIOS: readonly Formulario[] = [
  {
    id: 'control-inventarios',
    titulo: 'Control de inventarios - Regional Norte',
    descripcion: 'Seguimiento al inventario de estibas, isotanques y estibas plásticas',
    secciones: [
      {
        titulo: 'Centro De Distribución',
        preguntas: [
          // En el Microsoft Form no es obligatoria, pero sin CD la respuesta no se puede ubicar.
          { id: 'cd', titulo: 'Seleccione el CD', corto: 'CD', tipo: 'lista', obligatoria: true, opciones: CDS_REGIONAL_NORTE },
        ],
      },
      {
        titulo: 'Información de estibas',
        descripcion: EN_UNIDADES,
        sumable: true,
        preguntas: [
          { id: 'estibas_a', titulo: 'Cantidad de estibas tipo A', corto: 'Tipo A', obligatoria: true, ...UNIDADES },
          { id: 'estibas_b', titulo: 'Cantidad de estibas tipo B', corto: 'Tipo B', obligatoria: true, ...UNIDADES },
          { id: 'estibas_c', titulo: 'Cantidad de estibas tipo C', corto: 'Tipo C', obligatoria: true, ...UNIDADES },
        ],
      },
      {
        titulo: 'Información de HL bloqueados',
        descripcion: EN_UNIDADES,
        preguntas: [
          // Los hectolitros pueden tener decimales.
          { id: 'hl_pendientes_verter', titulo: 'Cantidad de HL pendientes por verter', corto: 'HL pendientes por verter', tipo: 'numero', obligatoria: true, minimo: 0 },
          { id: 'isotanques_vacios', titulo: 'Cantidad de isotanques vacíos', corto: 'Isotanques vacíos', obligatoria: true, ...UNIDADES },
          { id: 'isotanques_llenos', titulo: 'Cantidad de isotanques llenos', corto: 'Isotanques llenos', obligatoria: true, ...UNIDADES },
          { id: 'necesidad_isotanques', titulo: 'Necesidad de isotanques', obligatoria: true, ...UNIDADES },
        ],
      },
      {
        titulo: 'Información de estibas plásticas',
        descripcion: EN_UNIDADES,
        sumable: true,
        preguntas: [
          { id: 'cajas_330cc_x30', titulo: 'Cantidad de estibas plásticas 330cc x 30', corto: '330cc x 30', ...UNIDADES },
          { id: 'cajas_750cc_x16', titulo: 'Cantidad de estibas plásticas 750cc x 16', corto: '750cc x 16', ...UNIDADES },
          { id: 'cajas_1000cc_x13', titulo: 'Cantidad de estibas plásticas 1000cc x 13', corto: '1000cc x 13', ...UNIDADES },
          { id: 'cajas_250cc_x38', titulo: 'Cantidad de estibas plásticas 250cc x 38', corto: '250cc x 38', ...UNIDADES },
          { id: 'cajas_225cc_x38', titulo: 'Cantidad de estibas plásticas 225cc x 38', corto: '225cc x 38', ...UNIDADES },
        ],
      },
    ],
  },
];

export const MAX_RESPUESTAS_LISTADO = 5000;
const LIMITE_TEXTO = 500;
const LIMITE_PARRAFO = 4000;

export const buscarFormulario = (id: unknown): Formulario | undefined => FORMULARIOS.find(f => f.id === id);
export const preguntasDe = (formulario: Formulario): Pregunta[] => formulario.secciones.flatMap(s => s.preguntas);

const invalida = (p: Pregunta) => new Error(`La respuesta de "${p.titulo}" no es válida.`);

/** Valida y limpia la respuesta de una pregunta. Lanza un Error con el mensaje para el usuario. */
export function normalizarValor(p: Pregunta, valor: unknown): Valor {
  if (valor === undefined || valor === null || (typeof valor === 'string' && !valor.trim())) {
    if (p.obligatoria) throw new Error(`Responde "${p.titulo}".`);
    return null;
  }
  switch (p.tipo) {
    case 'texto':
    case 'parrafo': {
      if (typeof valor !== 'string') throw invalida(p);
      if (valor.trim().length > (p.tipo === 'texto' ? LIMITE_TEXTO : LIMITE_PARRAFO)) throw new Error(`La respuesta de "${p.titulo}" es demasiado larga.`);
      return valor.trim();
    }
    case 'numero': {
      const numero = typeof valor === 'number' ? valor
        : typeof valor === 'string' && /^-?\d+([.,]\d+)?$/.test(valor.trim()) ? Number(valor.trim().replace(',', '.')) : NaN;
      if (!Number.isFinite(numero) || Math.abs(numero) > 1e12) throw new Error(`"${p.titulo}": el valor debe ser un número.`);
      if (p.entero && !Number.isInteger(numero)) throw new Error(`"${p.titulo}": escribe un número entero.`);
      if (p.minimo !== undefined && numero < p.minimo) throw new Error(`"${p.titulo}": el valor debe ser ${p.minimo} o más.`);
      return numero;
    }
    case 'fecha': {
      if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) throw invalida(p);
      const fecha = new Date(`${valor}T00:00:00Z`);
      if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) throw invalida(p);
      return valor;
    }
    case 'lista':
    case 'opcion':
      if (typeof valor !== 'string' || !p.opciones?.includes(valor)) throw invalida(p);
      return valor;
  }
}

/** Valida todas las respuestas contra el formulario; ignora claves que no son preguntas. */
export function normalizarRespuestas(formulario: Formulario, datos: unknown): Respuestas {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new Error('Las respuestas no son válidas.');
  const entrada = datos as Record<string, unknown>;
  return Object.fromEntries(preguntasDe(formulario).map(p => [p.id, normalizarValor(p, entrada[p.id])]));
}

/**
 * Último reporte de cada CD hasta una fecha (exclusiva) y, si se indica, desde otra (inclusiva). Cada respuesta
 * es un conteo de inventario, así que los reportes de un mismo CD no se suman: manda el más reciente.
 */
export function ultimoPorCd<T extends { creado_en: string; respuestas: Record<string, unknown> }>(registros: readonly T[], hasta?: Date, desde?: Date): Map<string, T> {
  const limite = hasta?.getTime() ?? Infinity;
  // Con "desde", solo cuentan los reportes de ese periodo (el resumen mira un solo día).
  const inicio = desde?.getTime() ?? -Infinity;
  const ultimos = new Map<string, T>();
  for (const registro of registros) {
    const cd = registro.respuestas.cd;
    const fecha = Date.parse(registro.creado_en);
    if (typeof cd !== 'string' || !(fecha < limite) || !(fecha >= inicio)) continue;
    const actual = ultimos.get(cd);
    if (!actual || fecha > Date.parse(actual.creado_en)) ultimos.set(cd, registro);
  }
  return ultimos;
}

/** Texto de una respuesta para mostrarla en la tabla. */
export function textoRespuesta(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return valor.toLocaleString('es-CO', { maximumFractionDigits: 4 });
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return `${valor.slice(8, 10)}/${valor.slice(5, 7)}/${valor.slice(0, 4)}`;
  return String(valor);
}
