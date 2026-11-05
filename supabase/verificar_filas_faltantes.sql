-- Comprobar importación del Excel en Supabase SQL Editor.
-- La primera consulta compara por hoja; la segunda verifica tablas, vistas y filtros.
with esperadas(id, hoja, filas_esperadas) as (values
(0, 'Diario SKU', 11),
(1, 'Resumen', 26),
(2, 'Hoja1', 2),
(3, 'Gerencias', 20),
(4, 'TD SKUS', 10),
(5, 'IF 30 a 60 días', 26),
(6, 'Riesgos CD', 31),
(7, 'Traslados', 19),
(8, 'Tendencia diaria', 23),
(9, 'Riesgos Gerencia', 317),
(10, 'KA', 33),
(11, 'Riesgos rango días', 22),
(12, 'Septiembre', 32),
(13, 'Octubre', 29),
(14, 'Caucasia', 15086),
(15, 'BBC', 35),
(16, 'IF 30 a 60 días LM', 45),
(17, 'Reporte', 173)
), reales as (
  select hoja_id, count(*) as filas_en_supabase from public.frescura_filas group by hoja_id
)
select e.hoja, e.filas_esperadas, coalesce(r.filas_en_supabase, 0) as filas_en_supabase,
  case when h.nombre is distinct from e.hoja then 'REVISAR NOMBRE O FALTA HOJA'
       when coalesce(r.filas_en_supabase, 0) = e.filas_esperadas then 'OK'
       else 'REVISAR CANTIDAD' end as resultado
from esperadas e left join public.frescura_hojas h on h.id=e.id left join reales r on r.hoja_id=e.id
order by e.id;
