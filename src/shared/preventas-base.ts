import { catalogo } from './preventas-catalogo.ts';
import { fechaExcel } from './excel.ts';
import { MAX_PREVENTAS, normalizarPreventa } from './preventas.ts';

const encabezados = ['Cond de Exp', 'Centro', 'Material', 'Descripcion', 'UM', 'Status', 'Stock Disp', '', 'Cant en transito', 'Cant entrega Pendien', 'Total Disponible', 'Cant de pedidos', 'Cantidad en Pedidos', 'Disponible Final'];
const texto = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
export function esBase(cabecera: unknown[]) {
  return encabezados.every((v, i) => i === 7 || texto(v) === texto(cabecera[i]));
}
export function transformarBase(rows: unknown[][], fecha: string) {
  if (!esBase(rows[0] ?? [])) throw new Error('El archivo no tiene las columnas del archivo base de Preventas.');
  const dia = fechaExcel(fecha);
  if (!dia) throw new Error('Selecciona la fecha del corte antes de importar el archivo base.');
  const date = new Date(Date.UTC(1899, 11, 30) + dia * 86400000);
  const jueves = new Date(date); jueves.setUTCDate(jueves.getUTCDate() + 4 - (jueves.getUTCDay() || 7));
  const semana = Math.ceil(((jueves.getTime() - Date.UTC(jueves.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  const mes = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const filas = [], excluidas = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; if (!r?.some(v => v !== null && v !== undefined && v !== '')) continue;
    if (filas.length + excluidas.length >= MAX_PREVENTAS) throw new Error('Máximo 10.000 registros por archivo.');
    const material = String(r[2] ?? '').trim(), centro = String(r[1] ?? '').trim();
    const ref = catalogo.materials[material], cd = catalogo.centers[centro];
    if (!material || !centro || !r[3] || !r[14]) throw new Error(`Fila ${i + 1}: faltan centro, material, descripción o canal.`);
    if (!ref || !cd) { excluidas.push({ fila: i + 1, material, descripcion: String(r[3]), motivo: !ref ? 'Material sin referencia de factor, HL y categoría' : 'Centro sin referencia' }); continue; }
    const f: unknown[] = [dia, ...Array.from({length: 15}, (_, c) => r[c] ?? null), ref.factor, ref.hl, 0, 0, 0, cd, '', 0, 0, '', '', '', 0, ref.categoria, mes, semana, 0, 0, mes];
    filas.push(normalizarPreventa(f, i + 1));
  }
  if (!filas.length) throw new Error('No hay productos con referencias para calcular Preventas.');
  return { filas, excluidas, fecha, base: true, snapshot: [] };
}
