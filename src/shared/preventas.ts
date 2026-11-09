import { fechaExcel } from './excel.ts';

export const COLUMNAS_PREVENTAS = ['Fecha', 'Cond de Exp', 'Centro', 'Material', 'Descripción', 'UM', 'Status', 'Stock Disp', 'Cant en planta', 'Cant en transito', 'Cant entrega Pendien', 'Total Disponible', 'Cant de pedidos', 'Cantidad en Pedidos', 'Disponible Final', 'Canal', 'Factor', 'HL', 'HL Preventa', 'Inventarios', 'Agotados', 'CD', 'Llave', 'Tránsitos', 'TMS', 'Llave 2', 'Llave 3', 'Llave 4', 'FRC', 'Categoría', 'Mes', 'Semana', 'FRC Día', 'FRC W', 'Mes'];
export type FilaPreventa = (string | number | null)[];
export const MAX_PREVENTAS = 10000;
const numericas = [7, 8, 9, 10, 12, 13, 16, 17, 23, 24, 28, 31, 32, 33];
export function normalizarPreventa(input: unknown, numero = 1): FilaPreventa {
  if (!Array.isArray(input) || input.length !== 35) throw new Error(`Fila ${numero}: se requieren las 35 columnas de Datos.`);
  const fila: FilaPreventa = input.map(v => v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) ? v : String(v).trim());
  const fecha = fechaExcel(fila[0]);
  if (!fecha) throw new Error(`Fila ${numero}: falta la fecha.`);
  fila[0] = fecha;
  for (const i of [2, 3, 4, 15, 21]) {
    if (!fila[i] || String(fila[i]).length > 180) throw new Error(`Fila ${numero}: completa ${COLUMNAS_PREVENTAS[i]} (máximo 180 caracteres).`);
    fila[i] = String(fila[i]).trim();
  }
  for (const i of numericas) {
    const valor = fila[i] === null || fila[i] === '' ? 0 : Number(fila[i]);
    if (!Number.isFinite(valor) || Math.abs(valor) > 1e12) throw new Error(`Fila ${numero}: ${COLUMNAS_PREVENTAS[i]} debe ser numérico.`);
    fila[i] = valor;
  }
  if (Number(fila[16]) <= 0 || Number(fila[17]) <= 0 || Number(fila[13]) < 0) throw new Error(`Fila ${numero}: Factor y HL deben ser positivos; los pedidos no pueden ser negativos.`);
  for (const v of fila) if (typeof v === 'string' && v.length > 500) throw new Error(`Fila ${numero}: texto demasiado largo.`);
  // Fórmulas de la hoja Datos. El inventario compartido no se reasigna entre canales.
  fila[11] = Number(fila[7]) + Number(fila[8]) + Number(fila[9]) - Number(fila[10]);
  fila[14] = Number(fila[11]) - Number(fila[13]);
  fila[18] = Number(fila[13]) * Number(fila[16]) * Number(fila[17]);
  fila[19] = Number(fila[11]) * Number(fila[16]) * Number(fila[17]);
  fila[20] = Math.max(Number(fila[18]) - Number(fila[19]), 0);
  fila[22] = `${fila[2]}${fila[3]}${fecha}`;
  fila[25] = `${fila[2]}${fila[3]}`;
  fila[26] = `${fila[2]}${fila[3]}${fila[31]}`;
  fila[27] = `${fila[2]}${fecha}`;
  return fila;
}
export function metricasPreventa(fila: FilaPreventa) {
  const preventa = Number(fila[18]), agotados = Number(fila[20]);
  return { preventa, disponible: preventa - agotados, agotados };
}
