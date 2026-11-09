import XLSX from 'xlsx';
import { mkdir, writeFile } from 'node:fs/promises';
import { normalizarPreventa } from '../src/shared/preventas.ts';

const archivo = process.argv[2];
if (!archivo) throw new Error('Uso: node scripts/importar-preventas.ts ruta.xlsx');
const libro = XLSX.readFile(archivo, { sheets: ['Datos', 'SO'], dense: true, cellFormula: false, cellText: false, cellHTML: false });
const hoja = libro.Sheets.Datos as unknown as XLSX.CellObject[][];
if (!hoja) throw new Error('Falta la hoja Datos.');
const filas = [];
let diferencias = 0;
for (let i = 1; i < hoja.length; i++) {
  if (!hoja[i]?.[0]?.v || !hoja[i]?.[2]?.v || !hoja[i]?.[3]?.v) continue;
  const original = Array.from({ length: 35 }, (_, c) => hoja[i][c]?.t === 'e' ? null : hoja[i][c]?.v ?? null);
  const fila = normalizarPreventa(original, i + 1);
  for (const c of [11, 14, 18, 19, 20]) if (Math.abs(Number(original[c]) - Number(fila[c])) > 0.00001) diferencias++;
  filas.push(fila);
}
await mkdir('datos/preventas', { recursive: true });
const so = libro.Sheets.SO as unknown as XLSX.CellObject[][];
const snapshot: { fecha: number; material: string; descripcion: string; cd: string; agotados: number }[] = [];
for (let r = 5; r < so.length; r++) {
  if (!/^\d+$/.test(String(so[r]?.[0]?.v ?? ''))) continue;
  for (let c = 2; c < 19; c++) {
    if (so[r][c]?.v === undefined) continue;
    snapshot.push({ fecha: Number(so[1][1].v), material: String(so[r][0].v), descripcion: String(so[r][1]?.v ?? ''), cd: String(so[4][c].v), agotados: Number(so[r][c].v) });
  }
}
await writeFile('datos/preventas/inicial.json', JSON.stringify({ archivo: 'Stock Disp Regional Norte.xlsx', filas, snapshot }));
const literal = (v: unknown) => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
const lote = '51d76f6f-74f0-43a6-b645-1037793abc00';
let sql = `-- Ejecutar después de preventas_schema.sql. Carga inicial del Excel entregado.\nbegin;\ninsert into public.preventas_lotes(id,archivo) values ('${lote}','Stock Disp Regional Norte.xlsx') on conflict (id) do nothing;\n`;
for (let i = 0; i < filas.length; i += 100) {
  sql += 'insert into public.preventas_datos(lote_id,fila,valores) values\n' + filas.slice(i, i + 100).map((f, j) => `('${lote}',${i + j + 1},${literal(f)})`).join(',\n') + '\non conflict (lote_id,fila) do nothing;\n';
}
for (let i = 0; i < snapshot.length; i += 100) {
  sql += `insert into public.preventas_so_snapshot(lote_id,fecha_excel,material,descripcion,cd,agotados_hl) values\n` + snapshot.slice(i, i + 100).map(s => `('${lote}',${s.fecha},'${s.material}','${s.descripcion.replaceAll("'", "''")}','${s.cd.replaceAll("'", "''")}',${s.agotados})`).join(',\n') + '\non conflict (lote_id,fecha_excel,material,cd) do nothing;\n';
}
await writeFile('supabase/preventas_datos_iniciales.sql', sql + 'commit;\n');
console.log(JSON.stringify({ filas: filas.length, diferenciasFormulas: diferencias, fechas: [...new Set(filas.map(f => f[0]))], canales: [...new Set(filas.map(f => f[15]))] }));
