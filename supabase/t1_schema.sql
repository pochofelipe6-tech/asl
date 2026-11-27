-- Cargas de Excel de Comando Central: Seguimiento T1 (ATCT.xlsx y ESPERA.xlsx, página /t1),
-- Seguimiento WIP (Data WIP.xlsx, página /wip) y OFE (Data FMS.xlsx, página /ofe).
-- Los datos van en columnas (ver ColumnasAtct y ColumnasEspera en src/shared/t1.ts, ColumnasWip en src/shared/wip.ts y
-- ColumnasFms en src/shared/ofe.ts), en JSON comprimido con gzip.
-- t1_cargas: cada archivo subido, tal cual. No se borra ninguno (es el historial).
-- t1_consolidado: por tipo, todas las cargas juntas día por día (cada archivo manda en las fechas que trae y el más
-- nuevo gana si una fecha se repite). Es lo que la aplicación entrega al navegador; se rehace solo con t1_cargas.
-- La aplicación crea t1_consolidado sola si falta. Se puede ejecutar varias veces.
begin;
create table if not exists public.t1_cargas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  archivo text not null,
  filas integer not null check (filas > 0),
  desde date,
  hasta date,
  datos bytea not null,
  usuario_id text,
  usuario_nombre text not null,
  creado_en timestamptz not null default now()
);
alter table public.t1_cargas drop constraint if exists t1_cargas_tipo_check;
alter table public.t1_cargas add constraint t1_cargas_tipo_check check (tipo in ('atct', 'espera', 'wip', 'fms'));
create index if not exists t1_cargas_tipo on public.t1_cargas(tipo, creado_en desc);
alter table public.t1_cargas enable row level security;
revoke all on public.t1_cargas from anon, authenticated;

create table if not exists public.t1_consolidado (
  tipo text primary key,
  carga_id uuid not null,
  filas integer not null,
  desde date,
  hasta date,
  datos bytea not null,
  actualizado_en timestamptz not null default now()
);
alter table public.t1_consolidado enable row level security;
revoke all on public.t1_consolidado from anon, authenticated;

-- OFE: montacargas agregados o corregidos desde la página /ofe. Se aplican encima de la lista de montacargas del Power BI
-- (src/shared/montacargas.ts); clave = chasis en minúsculas y sin espacios a los lados.
create table if not exists public.ofe_montacargas (
  clave text primary key,
  chasis text not null,
  cd text not null,
  placa text not null,
  usuario_id text,
  usuario_nombre text not null,
  actualizado_en timestamptz not null default now()
);
alter table public.ofe_montacargas enable row level security;
revoke all on public.ofe_montacargas from anon, authenticated;
commit;
