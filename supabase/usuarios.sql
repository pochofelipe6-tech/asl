-- =====================================================================
--  Comando Central · Usuarios (ingreso con cédula y contraseña)
-- =====================================================================
--  Ya no se usa Supabase Auth (el ingreso con correo se quitó).
--  - Cada persona se registra en la página («Regístrate») con su cédula, su nombre y la contraseña que elija.
--  - Queda "pendiente" hasta que un administrador la aprueba en /usuarios (panel de usuarios).
--  - Las contraseñas se guardan cifradas con scrypt (src/server/usuarios.ts); nunca en claro.
--  La aplicación crea esta tabla sola la primera vez; este archivo sirve de referencia (se puede ejecutar varias veces).
--
--  Primer administrador: regístrate en la página y luego, en el proyecto:
--     node --env-file=.env.local scripts/hacer-admin.ts <tu cédula>
-- =====================================================================

begin;
create table if not exists public.usuarios_acceso (
  id uuid primary key default gen_random_uuid(),
  cedula text not null unique,
  nombre text not null,
  clave text not null,
  rol text not null default 'usuario' check (rol in ('administrador', 'usuario')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'activo', 'inactivo', 'rechazado')),
  debe_cambiar boolean not null default false,
  intentos_fallidos integer not null default 0,
  bloqueado_hasta timestamptz,
  ultimo_ingreso timestamptz,
  aprobado_por text,
  aprobado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
alter table public.usuarios_acceso enable row level security;
revoke all on public.usuarios_acceso from anon, authenticated;
commit;


-- =====================================================================
--  Plantillas útiles (quita el "--" del principio para usarlas)
-- =====================================================================

-- Ver los usuarios con su estado y rol:
-- select cedula, nombre, rol, estado, ultimo_ingreso from public.usuarios_acceso order by creado_en;

-- Aprobar a alguien como administrador por SQL (lo mismo que scripts/hacer-admin.ts):
-- update public.usuarios_acceso set estado = 'activo', rol = 'administrador', aprobado_en = now() where cedula = '123456789';
