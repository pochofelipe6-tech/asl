-- Ejecutar en SQL Editor de Supabase antes de preventas_datos_iniciales.sql.
-- La aplicación escribe mediante su conexión privada SUPABASE_DB_URL.
begin;
create table if not exists public.preventas_lotes (
  id uuid primary key default gen_random_uuid(),
  archivo text not null,
  usuario_id text,
  creado_en timestamptz not null default now()
);
create table if not exists public.preventas_datos (
  lote_id uuid not null references public.preventas_lotes(id) on delete cascade,
  fila integer not null check (fila > 0),
  valores jsonb not null check (jsonb_typeof(valores) = 'array' and jsonb_array_length(valores) = 35),
  fecha date generated always as (date '1899-12-30' + (valores->>0)::integer) stored,
  centro text generated always as (valores->>2) stored,
  material text generated always as (valores->>3) stored,
  canal text generated always as (valores->>15) stored,
  cd text generated always as (valores->>21) stored,
  primary key (lote_id, fila)
);
create index if not exists preventas_fecha_canal on public.preventas_datos(lote_id,fecha,canal,cd);
-- La hoja SO del Excel contiene un corte anterior al de Datos.
create table if not exists public.preventas_so_snapshot (
  lote_id uuid not null references public.preventas_lotes(id) on delete cascade,
  fecha_excel integer not null,
  material text not null,
  descripcion text not null,
  cd text not null,
  agotados_hl numeric not null,
  primary key(lote_id,fecha_excel,material,cd)
);
alter table public.preventas_so_snapshot enable row level security;
revoke all on public.preventas_so_snapshot from anon, authenticated;
grant select on public.preventas_so_snapshot to authenticated;
drop policy if exists preventas_lectura on public.preventas_so_snapshot;
create policy preventas_lectura on public.preventas_so_snapshot for select to authenticated using (true);
alter table public.preventas_lotes enable row level security;
alter table public.preventas_datos enable row level security;
revoke all on public.preventas_lotes, public.preventas_datos from anon, authenticated;
grant select on public.preventas_lotes, public.preventas_datos to authenticated;
drop policy if exists preventas_lectura on public.preventas_lotes;
create policy preventas_lectura on public.preventas_lotes for select to authenticated using (true);
drop policy if exists preventas_lectura on public.preventas_datos;
create policy preventas_lectura on public.preventas_datos for select to authenticated using (true);
create or replace view public.preventas_detalle with (security_invoker = true) as
select lote_id,fila,fecha,centro,material,canal,cd,valores->>4 as descripcion,
  valores->>29 as categoria,
  (valores->>18)::numeric as preventa_hl,
  (valores->>19)::numeric as inventario_hl,
  (valores->>20)::numeric as agotados_hl,
  (valores->>18)::numeric - (valores->>20)::numeric as disponible_preventa_hl
from public.preventas_datos;
grant select on public.preventas_detalle to authenticated;
commit;
