// Uso: node scripts/generar-sql-excel.cjs <archivo.xlsb> <salida.sql> [carpeta-partes]
const XLSX = require('xlsx');
const fs = require('node:fs');
const path = require('node:path');
const [input, output, partsDir] = process.argv.slice(2);
if (!input || !output) throw new Error('Indica el archivo Excel y la ruta del SQL de salida.');
const workbook = XLSX.readFile(input, { cellFormula: true, cellNF: true });
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const lines = [];
lines.push(`-- Importación del libro IF Regional Norte 2026 (H2).
-- Ejecutar completo en Supabase SQL Editor. Solo usuarios autenticados pueden leerlo.
-- Cada fila contiene celdas por letra de columna: v = valor guardado, texto = formato visible,
-- tipo = tipo de Excel, formula = fórmula extraída cuando está disponible.
-- Las fechas numéricas de Excel tienen tipo n y se conservan como número de serie.
-- Esto es una instantánea: no recalcula fórmulas ni tablas dinámicas.
-- Los filtros marcados 'requiere_origen' necesitan la fuente de la tabla dinámica.
-- Ejecutar otra vez actualiza las mismas filas; no elimina filas que hayan desaparecido del Excel.
begin;
create table if not exists public.frescura_hojas (
  id integer primary key,
  nombre text not null unique,
  rango_excel text,
  oculta boolean not null default false
);
create table if not exists public.frescura_filas (
  hoja_id integer not null references public.frescura_hojas(id),
  numero_fila integer not null,
  celdas jsonb not null,
  primary key (hoja_id, numero_fila)
);
create table if not exists public.frescura_filtros (
  modulo text not null,
  filtro text not null,
  disponibilidad text not null check (disponibilidad in ('filas_guardadas', 'requiere_origen')),
  detalle text not null,
  primary key (modulo, filtro)
);
alter table public.frescura_hojas enable row level security;
alter table public.frescura_filas enable row level security;
alter table public.frescura_filtros enable row level security;
drop policy if exists frescura_lectura on public.frescura_hojas;
create policy frescura_lectura on public.frescura_hojas for select to authenticated using (true);
drop policy if exists frescura_lectura on public.frescura_filas;
create policy frescura_lectura on public.frescura_filas for select to authenticated using (true);
drop policy if exists frescura_lectura on public.frescura_filtros;
create policy frescura_lectura on public.frescura_filtros for select to authenticated using (true);
grant select on public.frescura_hojas, public.frescura_filas, public.frescura_filtros to authenticated;
`);
const sheetRows = workbook.SheetNames.map((name, index) => {
  const s = workbook.Sheets[name];
  return `(${index},${quote(name)},${quote(s['!ref'] || '')},${Boolean(workbook.Workbook?.Sheets?.[index]?.Hidden)})`;
});
lines.push(`insert into public.frescura_hojas (id,nombre,rango_excel,oculta) values\n${sheetRows.join(',\n')}\non conflict (id) do update set nombre=excluded.nombre, rango_excel=excluded.rango_excel, oculta=excluded.oculta;\n`);
let values = [], count = 0;
function flush() {
  if (!values.length) return;
  lines.push(`insert into public.frescura_filas (hoja_id,numero_fila,celdas) values\n${values.join(',\n')}\non conflict (hoja_id,numero_fila) do update set celdas=excluded.celdas;\n`);
  values = [];
}
workbook.SheetNames.forEach((name, id) => {
  const sheet = workbook.Sheets[name];
  const byRow = new Map();
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!') || !cell || (cell.v == null && !cell.f)) continue;
    const { r, c } = XLSX.utils.decode_cell(address);
    const column = XLSX.utils.encode_col(c);
    let row = byRow.get(r + 1);
    if (!row) { row = {}; byRow.set(r + 1, row); }
    const data = { v: cell.v ?? null, texto: cell.v == null ? '' : XLSX.utils.format_cell(cell), tipo: cell.t };
    if (cell.f) data.formula = cell.f;
    if (cell.z) data.formato = cell.z;
    row[column] = data;
  }
  for (const [number, cells] of [...byRow].sort((a, b) => a[0] - b[0])) {
    values.push(`(${id},${number},${quote(JSON.stringify(cells))}::jsonb)`);
    count++;
    if (values.length >= 40) flush();
  }
});
flush();
const common = ['Año', 'Mes 1', 'Fecha envío información', 'Vencimiento 2', 'Canal', 'Empaque', 'Línea', 'Gerencia', 'Clase Envase', 'Código CD', 'Días Venc Actual'];
const modules = ['Diario SKU', 'Resumen', 'TD SKUS', 'IF 30 a 60 días', 'Riesgos CD', 'Tendencia diaria', 'KA', 'Riesgos rango días'];
const filterRows = [];
for (const name of modules) {
  for (const filter of [...common, 'CD']) {
    const available = (filter === 'CD' && ['Diario SKU', 'TD SKUS', 'IF 30 a 60 días', 'Riesgos CD', 'Tendencia diaria', 'KA'].includes(name)) || (filter === 'Gerencia' && name === 'Riesgos CD');
    const detail = available ? 'Filtra únicamente los valores guardados de la hoja; no recalcula tablas dinámicas.' : 'Requiere los registros de origen para reproducir la segmentación y recalcular resultados.';
    filterRows.push(`(${quote(name)},${quote(filter)},${quote(available ? 'filas_guardadas' : 'requiere_origen')},${quote(detail)})`);
  }
}
lines.push(`insert into public.frescura_filtros (modulo,filtro,disponibilidad,detalle) values\n${filterRows.join(',\n')}\non conflict (modulo,filtro) do update set disponibilidad=excluded.disponibilidad,detalle=excluded.detalle;\n`);
const views = {
  diario_sku: 'Diario SKU', resumen: 'Resumen', td_skus: 'TD SKUS',
  if_30_60_dias: 'IF 30 a 60 días', riesgos_cd: 'Riesgos CD',
  tendencia_diaria: 'Tendencia diaria', ka: 'KA', riesgos_rango_dias: 'Riesgos rango días', reporte: 'Reporte',
};
for (const [view, name] of Object.entries(views)) {
  lines.push(`create or replace view public.frescura_${view} with (security_invoker = true) as\nselect f.numero_fila, f.celdas from public.frescura_filas f join public.frescura_hojas h on h.id=f.hoja_id where h.nombre=${quote(name)};\ngrant select on public.frescura_${view} to authenticated;\n`);
}
lines.push(`commit;\n-- Ejemplos de consulta (ejecutar después, con sesión autenticada):\n-- select * from public.frescura_riesgos_cd order by numero_fila;\n-- select * from public.frescura_filtros where modulo = 'KA';\n-- select numero_fila, celdas->'B'->>'texto' from public.frescura_riesgos_cd order by numero_fila;\n`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, lines.join('\n'), 'utf8');
console.log(`SQL generado: ${output}; ${workbook.SheetNames.length} hojas, ${count} filas con datos.`);
if (partsDir) {
  fs.mkdirSync(partsDir, { recursive: true });
  // Cada archivo es independiente y se puede repetir; debe ejecutarse en orden.
  const blocks = lines.map(block => block.replace(/^begin;\r?\n/m, '').replace(/^commit;\r?\n/m, ''));
  const parts = [];
  let current = '';
  const maxBytes = 160 * 1024;
  for (const block of blocks) {
    if (Buffer.byteLength(block, 'utf8') > maxBytes) throw new Error('Una sentencia supera el tamaño máximo por parte.');
    if (current && Buffer.byteLength(current + block, 'utf8') > maxBytes) { parts.push(current); current = ''; }
    current += `${block}\n`;
  }
  if (current) parts.push(current);
  parts.forEach((part, index) => {
    const num = String(index + 1).padStart(3, '0');
    const header = `-- Parte ${index + 1} de ${parts.length}. Ejecutar en orden en Supabase SQL Editor.\n-- Cada parte es independiente y se puede volver a ejecutar.\n\n`;
    fs.writeFileSync(path.join(partsDir, `frescura_${num}.sql`), header + part, 'utf8');
  });
  fs.writeFileSync(path.join(partsDir, 'LEEME.txt'), `IMPORTACIÓN A SUPABASE\n\nEjecuta los archivos frescura_001.sql a frescura_${String(parts.length).padStart(3, '0')}.sql en orden numérico.\nCopia el contenido completo de cada archivo en Supabase > SQL Editor y pulsa Run.\nEspera a que cada parte termine correctamente antes de ejecutar la siguiente.\nSi una parte falla, corrígela y vuelve a ejecutarla antes de continuar.\nLa última parte contiene las vistas y el catálogo de filtros.\nCada parte se confirma por separado: una interrupción deja importadas las partes anteriores.\nRepetir una parte actualiza sus filas, pero no elimina filas antiguas ausentes del Excel.\n`, 'utf8');
  console.log(`Generadas ${parts.length} partes de hasta ${maxBytes / 1024} KB en ${partsDir}.`);
}
