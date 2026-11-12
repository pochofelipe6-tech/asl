import { catalogo } from './preventas-catalogo.ts';
import { fechaExcel } from './excel.ts';
import { normalizarPreventa } from './preventas.ts';
import type { FilaPreventa } from './preventas.ts';
import { categoriaPresentacion, conversionPresentacion } from './preventas-presentacion.ts';

const vacio = (v: unknown) => v === null || v === undefined || v === '';
// Equivalente a extender las búsquedas del Excel por código, nunca por proximidad.
export function completarDatosPreventas(rows: unknown[][], fuentes: unknown[][] = [], referencias: FilaPreventa[] = []): FilaPreventa[] {
  const factores = new Map<string, number>(), hectolitros = new Map<string, number>(), categorias = new Map<string, string>(), centros = new Map<string, string>();
  function aprender<T>(map: Map<string, T>, key: string, valor: T, campo: string) {
    if (!key || vacio(valor)) return;
    if (map.has(key) && map.get(key) !== valor) throw new Error(`Referencias contradictorias para ${key}: ${campo}. Revisa el Excel.`);
    map.set(key, valor);
  }
  function material(key: string, factor: unknown, hl: unknown, categoria: unknown) {
    if (typeof factor === 'number' && Number.isFinite(factor) && factor > 0) aprender(factores, key, factor, 'Factor');
    if (typeof hl === 'number' && Number.isFinite(hl) && hl > 0) aprender(hectolitros, key, hl, 'HL');
    if (!vacio(categoria)) aprender(categorias, key, String(categoria).trim(), 'Categoría');
  }
  // Datos es la referencia del corte y tiene prioridad sobre fuentes auxiliares.
  for (const r of rows) {
    material(String(r[3] ?? '').trim(), r[16], r[17], r[29]);
    if (!vacio(r[21])) aprender(centros, String(r[2] ?? '').trim(), String(r[21]).trim(), 'CD');
  }
  const fuenteMaterial = new Map<string, unknown[]>();
  for (const r of fuentes.slice(1)) if (!vacio(r[0])) fuenteMaterial.set(String(r[0]).trim(), r);
  const fuenteCentro = new Map<string, string>();
  for (const r of fuentes.slice(1)) if (!vacio(r[58]) && !vacio(r[59])) fuenteCentro.set(String(r[58]).trim(), String(r[59]).trim());
  const anteriores = new Map<string, FilaPreventa>(), cdsAnteriores = new Map<string, string>();
  for (const r of [...referencias].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    anteriores.set(String(r[3]).trim(), r);
    if (r[2] && r[21]) cdsAnteriores.set(String(r[2]).trim(), String(r[21]));
  }
  const positivo = (...valores: unknown[]) => valores.find(v => !vacio(v) && Number.isFinite(Number(v)) && Number(v) > 0);
  return rows.map((r, i) => {
    const f = [...r], key = String(f[3] ?? '').trim(), centro = String(f[2] ?? '').trim();
    const fuente = fuenteMaterial.get(key), ref = catalogo.materials[key], anterior = anteriores.get(key), conversion = conversionPresentacion(f[4]);
    if (vacio(f[16]) || f[16] === 0) f[16] = positivo(factores.get(key), fuente?.[4], anterior?.[16], ref?.factor, conversion?.factor);
    if (vacio(f[17]) || f[17] === 0) f[17] = positivo(hectolitros.get(key), fuente?.[8], anterior?.[17], ref?.hl, conversion?.hl);
    if (vacio(f[29])) f[29] = categorias.get(key) || fuente?.[3] || anterior?.[29] || ref?.categoria || categoriaPresentacion(f[4]);
    if (vacio(f[21])) f[21] = centros.get(centro) || fuenteCentro.get(centro) || cdsAnteriores.get(centro) || catalogo.centers[centro];
    const dia = fechaExcel(f[0]);
    if (dia) {
      const date = new Date(Date.UTC(1899, 11, 30) + dia * 86400000);
      const jueves = new Date(date); jueves.setUTCDate(jueves.getUTCDate() + 4 - (jueves.getUTCDay() || 7));
      if (vacio(f[31])) f[31] = Math.ceil(((jueves.getTime() - Date.UTC(jueves.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
      for (const c of [30, 34]) if (vacio(f[c])) f[c] = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    }
    return normalizarPreventa(f, i + 2);
  });
}
