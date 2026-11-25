// Módulo "Solicitudes de material": cada centro destino tiene un solicitante fijo, así el formulario
// solo pide centro, código de material y cantidad. Las solicitudes se guardan en la tabla
// public.formularios_respuestas (ver supabase/formularios_schema.sql) con formulario = ID_SOLICITUDES.
// Lo usan el servidor (validación) y el navegador (formulario y tabla).

export const ID_SOLICITUDES = 'solicitudes-material';
export const MAX_SOLICITUDES_LISTADO = 5000;
/** Artículos que se pueden guardar juntos desde el formulario. */
export const MAX_LOTE = 50;

export interface CentroDestino { codigo: string; cd: string; solicitante: string }

/** Solicitante de cada centro destino (lista entregada por el usuario el 25/11/2026). */
export const CENTROS_DESTINO: readonly CentroDestino[] = [
  { codigo: 'AV10', cd: 'Turbaco', solicitante: 'Camilo Tatis' },
  { codigo: 'AV11', cd: 'Santa Marta', solicitante: 'Victor Villa' },
  { codigo: 'AV12', cd: 'Valledupar', solicitante: 'Eduardo Diaz' },
  { codigo: 'AV13', cd: 'Corozal', solicitante: 'Jesús Alfonso Iriarte' },
  { codigo: 'AV20', cd: 'Cúcuta', solicitante: 'Karen Paredes' },
  { codigo: 'AV29', cd: 'San Andrés', solicitante: 'Laura Muñoz' },
  { codigo: 'AV30', cd: 'Riohacha', solicitante: 'Jordin Virguez' },
  { codigo: 'AV32', cd: 'Magangué', solicitante: 'Jesús Alfonso Iriarte' },
  { codigo: 'AV36', cd: 'Fonseca', solicitante: 'Eduardo Diaz' },
  { codigo: 'AV38', cd: 'Curumaní', solicitante: 'Eduardo Diaz' },
  { codigo: 'AV39', cd: 'Montería', solicitante: 'Jose Acosta' },
  { codigo: 'AV40', cd: 'Caucasia', solicitante: 'Jose Acosta' },
  { codigo: 'AV41', cd: 'Apartadó', solicitante: 'Pedro Osorio' },
  { codigo: 'AV74', cd: 'La Arenosa', solicitante: 'Piedad Santiago' },
  { codigo: 'AV76', cd: 'Galapa', solicitante: 'Oscar Celis' },
];

/**
 * Base de SKU del usuario (Cod_Mat y Nom_Mat, 25/11/2026): todos salen en la lista del formulario con su descripción.
 * Un código que no esté aquí pide su descripción la primera vez; después la página la toma de las solicitudes guardadas.
 */
export const MATERIALES: Readonly<Record<string, string>> = {
  '401235': 'TERMO PACK LTA 330/355/473 CAL 2.0X53 cm - 26 TN',
  '404234': 'TERMO 24 PACK LATA 269 CAL 2,0 X 48cm - 95 TN',
  '414100': 'BANDEJA CTON LTA 269X24 GENERICA LINEA',
  '407874': 'BANDEJA CARTON KRAFT 24LTA 330/355 GENER',
  '404431': 'PAD CARTON X 24 LATA 330/355 GENERICO',
  '404435': 'PAD CARTON X 24 LATA 269',
  '400090': 'PLASTICO SUPER STRECH CALIBRE 0.8 MILS',
  '400512': 'PLASTICO STRECH CALIBRE 0.6 MILS',
  '414562': 'CAJA TERC KRAFT 4X6P AGUILA 330NR MANUAL',
  '419470': 'CAJA TERC KRAFT 4X6P CLUB COL 330NR MANU',
  '421509': 'CANASTILLA CLUB COL 330 R NEW VBI',
  '414867': 'CANASTILLA 6 BOTNR PONY EXP',
  '409190': 'BANDEJA CRTON PONY MLTA 330NRX24 TXT LEG',
  '423932': 'CANASTILLA 6 CLUB COL 330CC EXP USA',
  '423933': 'CAJA CARTON CLUB COL 330 X24 USA NVBI',
  '421016': 'CANASTILLA PONY MALTA 330cc X6P CH',
  '414695': 'CAJA CARTON AGUILA LIG 330NR X 24 MAN CI',
  '423438': 'CANASTILLA 6BOT 330NR CORONITA NL VALLE',
  '424357': 'CAJA CARTON 4X6U BTA 330 CORONA ATL',
  '423431': 'CANASTILLA 6BOT 210NR CORONITA NL VALLE',
  '424356': 'CAJA CARTON 4X6U BTA 210 CORONITA ATL',
  '424453': 'CAJA SIXPACK CORONA EXTRA LATA 269 ATL',
  '420369': 'CAJA 24 PACK CORONA LATA 269',
  '424386': 'CANASTILLA 6BOT 330ML MICHELOB ULTRA',
  '424606': 'CAJA CTON 4X6 BTA 330 MICHELOB ULTRA ATL',
  '424608': 'CAJA CTON 24 BTA 330 MICHELOB ULTRA ATL',
  '424804': 'CAJA CTON 4X6U BTA 210 MICHELOB ULTRA',
  '424807': 'CAJA CTON X24 LOOSP 210NR MICHELOB ULTRA',
  '424805': 'CANASTILLA 6BOT 210ML MICHELOB ULTRA',
  '423430': 'CANASTILLA 6BOT 210NR CORONITA WR NL TOC',
  '423760': 'CAJA CTON 4X6U BTA 210 CORONITA AHORRO',
  '422776': 'CANASTILLA WR 6BOT 330 CORONA CERO TOC',
  '424601': 'CANASTILLA WR 6P 330 CORONA CERO TOC CI',
  '422750': 'CAJA CTON 4X6U BTA 330 CORONA CERO TOC',
  '423759': 'CANASTILLA 6BOT 330 CORONA VALLE AHORRO',
  '423437': 'CANASTILLA 6BOT 330 CORONA VALLE AHORRO',
  '423758': 'CAJA CTON 4X6U BTA 330 CORONA TOC AHORRO',
  '420367': 'CAJA SIXPACK CORONA LATA 269',
  '409750': 'BANDEJA KRAFT BUD 269 LTA 2PX12U',
  '424458': 'CAJA CORONA CERO LTA 269 X6 ED FEP 26',
  '423536': 'CAJA CORONA CERO LTA 269 X6 ED FEP 26',
  '424387': 'CAJA CTON 4X6U BTA 330 MICHELOB ULTRA TO',
  '424388': 'CAJA CTON X24U BTA 330 MICHELOB ULTRA TO (LOOSEPACK)',
  '404738': 'SEPARADOR PET 106X128CM RECUBRIMIENTO',
};

export interface Solicitud { centro: string; solicitante: string; material: string; descripcion: string; cantidad: number }
export type CampoSolicitud = 'centro' | 'material' | 'descripcion' | 'cantidad';

const MAX_DESCRIPCION = 120;
const MAX_CANTIDAD = 1_000_000_000;

const limpiar = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : typeof v === 'number' ? String(v) : '');
const sinTildes = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Centro por su código ("AV10", "av10") o por el nombre del CD ("Turbaco"). */
export function buscarCentro(valor: unknown): CentroDestino | undefined {
  const texto = limpiar(valor);
  if (!texto) return undefined;
  const codigo = /^[a-z]{2}\d{2}\b/i.exec(texto)?.[0].toUpperCase();
  return CENTROS_DESTINO.find(c => c.codigo === codigo) ?? CENTROS_DESTINO.find(c => sinTildes(c.cd) === sinTildes(texto));
}

/** Código de material en mayúsculas, o '' si no es válido (solo letras, números y guiones). */
export function codigoMaterial(valor: unknown): string {
  const texto = limpiar(valor).toUpperCase();
  return /^[A-Z0-9-]{1,20}$/.test(texto) ? texto : '';
}

/** Cantidad entera mayor que 0. Acepta puntos de miles ("1.100"); no acepta comas para no confundir decimales. */
export function leerCantidad(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isInteger(valor) && valor > 0 && valor <= MAX_CANTIDAD ? valor : null;
  const texto = limpiar(valor).replace(/\s/g, '');
  const digitos = /^\d{1,3}(\.\d{3})+$/.test(texto) ? texto.replace(/\./g, '') : texto;
  if (!/^\d{1,10}$/.test(digitos)) return null;
  const cantidad = Number(digitos);
  return cantidad > 0 && cantidad <= MAX_CANTIDAD ? cantidad : null;
}

/**
 * Valida una solicitud con las mismas reglas en el navegador y en el servidor.
 * El solicitante nunca viene del formulario: sale del centro. Si el material está en MATERIALES,
 * su descripción manda sobre lo escrito.
 */
export function revisarSolicitud(datos: unknown): { solicitud: Solicitud | null; errores: Partial<Record<CampoSolicitud, string>> } {
  const d = (datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {}) as Record<string, unknown>;
  const errores: Partial<Record<CampoSolicitud, string>> = {};

  const centro = buscarCentro(d.centro);
  const textoCentro = limpiar(d.centro);
  if (!centro) errores.centro = textoCentro ? `El centro "${textoCentro.slice(0, 30)}" no tiene solicitante asignado. Elige uno de la lista.` : 'Elige o escribe el código del centro.';

  const material = codigoMaterial(d.material);
  if (!material) errores.material = limpiar(d.material) ? 'El código de material solo lleva letras y números.' : 'Escribe el código del material.';

  const descripcion = (material && MATERIALES[material]) || limpiar(d.descripcion).toUpperCase();
  if (material && !descripcion) errores.descripcion = 'Es un material nuevo: escribe su descripción.';
  else if (descripcion.length > MAX_DESCRIPCION) errores.descripcion = `La descripción es muy larga (máximo ${MAX_DESCRIPCION} caracteres).`;

  const cantidad = leerCantidad(d.cantidad);
  if (cantidad === null) errores.cantidad = limpiar(d.cantidad) ? 'Escribe un número entero mayor que 0, sin comas.' : 'Escribe la cantidad.';

  if (!centro || !material || cantidad === null || Object.keys(errores).length) return { solicitud: null, errores };
  return { solicitud: { centro: centro.codigo, solicitante: centro.solicitante, material, descripcion, cantidad }, errores };
}
