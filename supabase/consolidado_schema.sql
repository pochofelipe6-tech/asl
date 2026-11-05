-- Datos de origen de Data IF. No modifica las tablas importadas anteriormente.
create table if not exists public.frescura_consolidado_lotes (
  id text primary key,
  archivo text not null,
  filas integer not null,
  cargado_en timestamptz not null default now()
);
create table if not exists public.frescura_consolidado (
  lote_id text not null references public.frescura_consolidado_lotes(id),
  fila_excel integer not null check (fila_excel >= 2),
  valores jsonb not null check (jsonb_typeof(valores) = 'array' and jsonb_array_length(valores) = 41),
  primary key (lote_id, fila_excel)
);
alter table public.frescura_consolidado_lotes enable row level security;
alter table public.frescura_consolidado enable row level security;
drop policy if exists frescura_consolidado_lectura on public.frescura_consolidado_lotes;
create policy frescura_consolidado_lectura on public.frescura_consolidado_lotes for select to authenticated using (true);
drop policy if exists frescura_consolidado_lectura on public.frescura_consolidado;
create policy frescura_consolidado_lectura on public.frescura_consolidado for select to authenticated using (true);
grant select on public.frescura_consolidado_lotes, public.frescura_consolidado to authenticated;

-- Fechas originales de Excel expresadas como fecha; las cantidades conservan su precisión.
create or replace view public.frescura_consolidado_detalle with (security_invoker = true) as
select lote_id, fila_excel,
  case when valores->>0 ~ '^\d+$' then date '1899-12-30' + (valores->>0)::integer end as fecha_envio,
  valores->>1 as llave, valores->>2 as codigo_cd, valores->>3 as codigo_material,
  (valores->>4)::numeric as cantidad,
  case when valores->>5 ~ '^\d+$' then date '1899-12-30' + (valores->>5)::integer
       when trim(valores->>5) ~ '^\d{2}/\d{2}/\d{4}$' then to_date(trim(valores->>5), 'DD/MM/YYYY') end as fecha_vencimiento,
  valores->>8 as material, valores->>9 as cd,
  (valores->>12)::numeric as hectolitros,
  (valores->>13)::numeric as cajas,
  valores->>16 as rango_dias_1, valores->>18 as empaque, valores->>19 as linea,
  (valores->>21)::numeric as costo_usd, valores->>22 as gerencia,
  valores->>25 as clase_envase, valores->>26 as vencimiento_2,
  (valores->>28)::numeric as dias_venc_actual, valores->>29 as venc_actual,
  (valores->>33)::numeric as valor_total, valores->>34 as canal,
  valores->>39 as mes_1, valores->>40 as anio
from public.frescura_consolidado;
grant select on public.frescura_consolidado_detalle to authenticated;

-- Los filtros comparan los campos reales de Data. El lote se pasa explícitamente
-- para que fechas de envío diferentes no se mezclen entre archivos importados.
create or replace function public.frescura_filtrar_consolidado(p_lote text, p_filtros jsonb default '{}'::jsonb)
returns setof public.frescura_consolidado_detalle
language sql stable security invoker
as $$
  select d.* from public.frescura_consolidado_detalle d
  where d.lote_id = p_lote
    and (not p_filtros ? 'fecha_envio' or d.fecha_envio::text = p_filtros->>'fecha_envio')
    and (not p_filtros ? 'fecha_vencimiento' or d.fecha_vencimiento::text = p_filtros->>'fecha_vencimiento')
    and (not p_filtros ? 'codigo_cd' or d.codigo_cd = p_filtros->>'codigo_cd')
    and (not p_filtros ? 'codigo_material' or d.codigo_material = p_filtros->>'codigo_material')
    and (not p_filtros ? 'cd' or d.cd = p_filtros->>'cd')
    and (not p_filtros ? 'empaque' or d.empaque = p_filtros->>'empaque')
    and (not p_filtros ? 'linea' or d.linea = p_filtros->>'linea')
    and (not p_filtros ? 'gerencia' or d.gerencia = p_filtros->>'gerencia')
    and (not p_filtros ? 'clase_envase' or d.clase_envase = p_filtros->>'clase_envase')
    and (not p_filtros ? 'vencimiento_2' or d.vencimiento_2 = p_filtros->>'vencimiento_2')
    and (not p_filtros ? 'dias_venc_actual' or d.dias_venc_actual::text = p_filtros->>'dias_venc_actual')
    and (not p_filtros ? 'costo_usd' or d.costo_usd::text = p_filtros->>'costo_usd')
    and (not p_filtros ? 'canal' or d.canal = p_filtros->>'canal')
    and (not p_filtros ? 'mes_1' or d.mes_1 = p_filtros->>'mes_1')
    and (not p_filtros ? 'anio' or d.anio = p_filtros->>'anio');
$$;
revoke all on function public.frescura_filtrar_consolidado(text, jsonb) from public, anon;
grant execute on function public.frescura_filtrar_consolidado(text, jsonb) to authenticated;
create index if not exists frescura_consolidado_fecha_idx on public.frescura_consolidado (lote_id, (valores->>0));
create index if not exists frescura_consolidado_cd_idx on public.frescura_consolidado (lote_id, (valores->>9));
