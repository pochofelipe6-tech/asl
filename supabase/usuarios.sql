-- =====================================================================
--  Bavaria Transporte · Usuarios (Supabase Auth, inicio con correo)
-- =====================================================================
--  1) Crea el usuario en el panel de Supabase:
--       Authentication → Users → Add user → Create new user
--       · Email y contraseña
--       · Marca "Auto Confirm User"
--  2) Ejecuta este SQL (SQL Editor → Run) para ponerle nombre y rol.
--     Roles: administrador | despachador | conductor
-- =====================================================================

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"nombre": "Andres"}',
    raw_app_meta_data  = coalesce(raw_app_meta_data,  '{}'::jsonb) || '{"rol": "administrador"}'
where email = 'anfemaca2003@gmail.com';


-- =====================================================================
--  Plantillas útiles (quita el "--" del principio para usarlas)
-- =====================================================================

-- Ver los usuarios con su nombre y rol:
-- select email,
--        raw_user_meta_data->>'nombre' as nombre,
--        raw_app_meta_data->>'rol'     as rol,
--        email_confirmed_at, last_sign_in_at
-- from auth.users order by created_at;

-- Desactivar un usuario (ya no podrá entrar, pero no se borra):
-- update auth.users set banned_until = 'infinity' where email = 'correo@ejemplo.com';

-- Volver a activarlo:
-- update auth.users set banned_until = null where email = 'correo@ejemplo.com';

-- La tabla antigua public.usuarios (login por nombre de usuario) ya no se usa:
-- drop table if exists public.usuarios;
