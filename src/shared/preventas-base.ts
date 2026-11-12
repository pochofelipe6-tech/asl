import { catalogo } from './preventas-catalogo.ts';
import { fechaExcel } from './excel.ts';
import { MAX_PREVENTAS, normalizarPreventa } from './preventas.ts';
import type { FilaPreventa } from './preventas.ts';
import { categoriaPresentacion, conversionPresentacion } from './preventas-presentacion.ts';

const encabezados = ['Cond de Exp', 'Centro', 'Material', 'Descripcion', 'UM', 'Status', 'Stock Disp', '', 'Cant en transito', 'Cant entrega Pendien', 'Total Disponible', 'Cant de pedidos', 'Cantidad en Pedidos', 'Disponible Final'];
const texto = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
export function esBase(cabecera: unknown[]) {
  return encabezados.every((v, i) => i === 7 || texto(v) === texto(cabecera[i]));
}
export function transformarBase(rows: unknown[][], fecha: string, referencias: FilaPreventa[] = []) {
  if (!esBase(rows[0] ?? [])) throw new Error('El archivo no tiene las columnas del archivo base de Preventas.');
  const dia = fechaExcel(fecha);
  if (!dia) throw new Error('Selecciona la fecha del corte antes de importar el archivo base.');
  const date = new Date(Date.UTC(1899, 11, 30) + dia * 86400000);
  const jueves = new Date(date); jueves.setUTCDate(jueves.getUTCDate() + 4 - (jueves.getUTCDay() || 7));
  const semana = Math.ceil(((jueves.getTime() - Date.UTC(jueves.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  const mes = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const materiales = new Map<string, { factor: number; hl: number; categoria: string }>();
  const centros = new Map<string, string>();
  // Aprende de los Datos ya guardados; el corte más reciente tiene prioridad.
  for (const f of [...referencias].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (Number(f[16]) > 0 && Number(f[17]) > 0 && f[29]) materiales.set(String(f[3]), { factor: Number(f[16]), hl: Number(f[17]), categoria: String(f[29]) });
    if (f[2] && f[21]) centros.set(String(f[2]), String(f[21]));
  }
  const filas = [], excluidas = [], completadas = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r?.some(v => v !== null && v !== undefined && v !== '')) continue;
    if (filas.length + excluidas.length >= MAX_PREVENTAS) throw new Error('Máximo 10.000 registros por archivo.');
    const material = String(r[2] ?? '').trim(), centro = String(r[1] ?? '').trim();
    const conversion = conversionPresentacion(r[3]), categoria = categoriaPresentacion(r[3]);
    const conocida = materiales.get(material) ?? catalogo.materials[material];
    const ref = conocida ?? (conversion && categoria ? { ...conversion, categoria } : undefined), cd = centros.get(centro) ?? catalogo.centers[centro];
    if (!material || !centro || !r[3] || !r[14]) throw new Error(`Fila ${i + 1}: faltan centro, material, descripción o canal.`);
    if (!ref || !cd) {
      const registro = { fila: i + 1, material, descripcion: String(r[3]), motivo: !cd ? `Centro ${centro} sin referencia` : 'Material sin referencia de factor, HL y categoría' };
      // Solo se calcula una conversión si la presentación indica volumen y unidades.
      excluidas.push(registro);
      continue;
    }
    const f: unknown[] = [dia, ...Array.from({length: 15}, (_, c) => r[c] ?? null), ref.factor, ref.hl, 0, 0, 0, cd, '', 0, 0, '', '', '', 0, ref.categoria, mes, semana, 0, 0, mes];
    // Algunos archivos omiten planta pero conservan Total Disponible y Disponible Final.
    // Recupera ese componente solo si ambas cifras originales concuerdan con los pedidos.
    if ((r[7] === null || r[7] === undefined || r[7] === '') && typeof r[10] === 'number' && typeof r[13] === 'number' && typeof r[12] === 'number' && Math.abs(r[10] - r[13] - r[12]) < 1e-8) {
      const planta = r[10] - Number(r[6] ?? 0) - Number(r[8] ?? 0) + Number(r[9] ?? 0);
      if (Number.isFinite(planta) && planta >= 0) f[8] = planta;
    }
    if (!conocida) completadas.push({ fila: i + 1, material, descripcion: String(r[3]), ...ref });
    filas.push(normalizarPreventa(f, i + 1));
  }
  if (!filas.length) throw new Error('No hay productos con referencias para calcular Preventas.');
  return { filas, excluidas, completadas, fecha, base: true, snapshot: [] };
}
