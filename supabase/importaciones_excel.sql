-- Area temporal de importacion. Los informes existentes no se modifican.
create table if not exists public.frescura_importaciones (
  id uuid primary key,
  usuario_id text not null,
  archivo text not null,
  filas integer not null check (filas between 1 and 300000),
  recibidas integer not null default 0,
  ultima_fila integer not null default 1,
  ultimo_offset integer,
  ultimo_hash text,
  lote_base text,
  lote_id text,
  estado text not null default 'pendiente' check (estado in ('pendiente','completa','cancelada')),
  creado_en timestamptz not null default now()
);
create table if not exists public.frescura_importacion_filas (
  importacion_id uuid not null references public.frescura_importaciones(id) on delete cascade,
  posicion integer not null,
  fila_excel integer not null check (fila_excel between 2 and 1048576),
  valores jsonb not null check (jsonb_typeof(valores) = 'array' and jsonb_array_length(valores) = 41),
  primary key (importacion_id, posicion),
  unique (importacion_id, fila_excel)
);
alter table public.frescura_importaciones enable row level security;
alter table public.frescura_importacion_filas enable row level security;
revoke all on public.frescura_importaciones, public.frescura_importacion_filas from anon, authenticated;
create index if not exists frescura_importaciones_usuario_idx on public.frescura_importaciones(usuario_id, creado_en);
