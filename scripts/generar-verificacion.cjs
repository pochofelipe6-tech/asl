const XLSX = require('xlsx');
const fs = require('node:fs');
const workbook = XLSX.readFile(process.argv[2], { cellFormula: true });
const counts = workbook.SheetNames.map((name, id) => {
  const sheet = workbook.Sheets[name];
  const rows = new Set();
  for (const [address, cell] of Object.entries(sheet)) {
    if (!address.startsWith('!') && cell && (cell.v != null || cell.f)) rows.add(XLSX.utils.decode_cell(address).r + 1);
  }
  return `(${id}, '${name.replaceAll("'", "''")}', ${rows.size})`;
});
const sql = `-- Comprobar importación del Excel en Supabase SQL Editor.
-- La primera consulta compara por hoja; la segunda verifica tablas, vistas y filtros.
with esperadas(id, hoja, filas_esperadas) as (values
${counts.join(',\n')}
), reales as (
  select hoja_id, count(*) as filas_en_supabase from public.frescura_filas group by hoja_id
)
select e.hoja, e.filas_esperadas, coalesce(r.filas_en_supabase, 0) as filas_en_supabase,
  case when h.nombre is distinct from e.hoja then 'REVISAR NOMBRE O FALTA HOJA'
       when coalesce(r.filas_en_supabase, 0) = e.filas_esperadas then 'OK'
       else 'REVISAR CANTIDAD' end as resultado
from esperadas e left join public.frescura_hojas h on h.id=e.id left join reales r on r.hoja_id=e.id
order by e.id;

select (select count(*) from public.frescura_hojas) as hojas,
       (select count(*) from public.frescura_filas) as filas,
       (select count(*) from public.frescura_filtros) as filtros,
       (select count(*) from (values ('frescura_diario_sku'),('frescura_resumen'),('frescura_td_skus'),('frescura_if_30_60_dias'),('frescura_riesgos_cd'),('frescura_tendencia_diaria'),('frescura_ka'),('frescura_riesgos_rango_dias'),('frescura_reporte')) as v(nombre) where to_regclass('public.' || v.nombre) is not null) as vistas;
-- Esperado: 18 hojas, 15940 filas, 96 filtros, 9 vistas.
-- Si una hoja tiene filas adicionales o diferentes nombres, requiere revisión.
-- Las cantidades no comprueban que el contenido de cada celda sea idéntico.
`;
fs.writeFileSync('supabase/verificar_frescura.sql', sql, 'utf8');
console.log(`Generada verificación de ${counts.length} hojas.`);
