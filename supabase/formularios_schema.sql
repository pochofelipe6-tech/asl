-- Ejecutar una vez en el SQL Editor de Supabase para activar el módulo Control de inventarios.
-- La aplicación escribe mediante su conexión privada SUPABASE_DB_URL.
-- Cada respuesta guarda sus valores en "respuestas" (jsonb) con las claves
-- definidas en src/shared/formularios.ts, así el formulario puede crecer sin cambiar la tabla.
begin;
create table if not exists public.formularios_respuestas (
  id uuid primary key default gen_random_uuid(),
  formulario text not null,
  respuestas jsonb not null check (jsonb_typeof(respuestas) = 'object'),
  usuario_id text,
  usuario_nombre text not null,
  creado_en timestamptz not null default now()
);
create index if not exists formularios_respuestas_formulario on public.formularios_respuestas(formulario, creado_en desc);
alter table public.formularios_respuestas enable row level security;
revoke all on public.formularios_respuestas from anon, authenticated;
commit;
