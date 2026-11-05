const fs = require('node:fs');
const path = require('node:path');
const directory = 'supabase/recuperacion/partes';
const files = fs.readdirSync(directory).filter(name => /^frescura_\d+\.sql$/.test(name)).sort();
const ranges = [];
for (const file of files) {
  const contents = fs.readFileSync(path.join(directory, file), 'utf8');
  const numbers = [...contents.matchAll(/^\s*\(14,(\d+),/gm)].map(match => Number(match[1])).sort((a, b) => a - b);
  if (!numbers.length) continue;
  let start = numbers[0], last = numbers[0];
  for (const number of numbers.slice(1)) {
    if (number !== last + 1) { ranges.push([file, start, last]); start = number; }
    last = number;
  }
  ranges.push([file, start, last]);
}
const values = ranges.map(([file, start, end]) => `('${file}', ${start}, ${end})`).join(',\n');
const sql = `-- Identifica qué partes contienen las filas de Caucasia que faltan.
with intervalos(archivo, desde, hasta) as (values
${values}
), faltantes as (
  select archivo, serie.numero_fila
  from intervalos cross join lateral generate_series(desde, hasta) as serie(numero_fila)
  where not exists (select 1 from public.frescura_filas f where f.hoja_id = 14 and f.numero_fila = serie.numero_fila)
)
select archivo, count(*) as filas_faltantes, min(numero_fila) as primera_fila, max(numero_fila) as ultima_fila
from faltantes group by archivo order by archivo;
`;
fs.writeFileSync('supabase/identificar_partes_faltantes.sql', sql, 'utf8');
console.log(`Consulta creada con ${ranges.length} intervalos.`);
