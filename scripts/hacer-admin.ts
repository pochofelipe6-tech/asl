// Aprueba un registro y lo deja como administrador (para el primer administrador; los demás se aprueban en /usuarios).
// La persona primero se registra en la página ("Regístrate") con su cédula, nombre y contraseña.
// Uso:  node --env-file=.env.local scripts/hacer-admin.ts <cédula>
//       node --env-file=.env.local scripts/hacer-admin.ts --pendientes     (lista los registros pendientes)
import pg from 'pg';
import { normalizarCedula } from '../src/shared/usuarios.ts';

const argumento = process.argv[2] ?? '';
if (!process.env.SUPABASE_DB_URL) { console.error('Falta SUPABASE_DB_URL (usa --env-file=.env.local).'); process.exit(1); }
if (!argumento) { console.error('Uso: node --env-file=.env.local scripts/hacer-admin.ts <cédula> | --pendientes'); process.exit(1); }

const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
try {
  if (argumento === '--pendientes') {
    const { rows } = await pool.query("select cedula, nombre, to_char(creado_en at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') as creado from public.usuarios_acceso where estado = 'pendiente' order by creado_en");
    if (!rows.length) console.log('No hay registros pendientes.');
    for (const r of rows) console.log(`${r.cedula}  ${r.nombre}  (registrado el ${r.creado})`);
  } else {
    const cedula = normalizarCedula(argumento);
    const { rows } = await pool.query(
      `update public.usuarios_acceso set estado = 'activo', rol = 'administrador', aprobado_por = 'Configuración inicial', aprobado_en = now(), actualizado_en = now()
       where cedula = $1 returning nombre`, [cedula]);
    if (!rows[0]) { console.error(`No hay ningún registro con la cédula ${cedula}. Primero regístrate en la página.`); process.exitCode = 1; }
    else console.log(`Listo: ${rows[0].nombre} (${cedula}) quedó como administrador activo.`);
  }
} catch (error) {
  const e = error as { code?: string; message: string };
  console.error(e.code === '42P01' ? 'Aún no existe la tabla de usuarios: abre la página de inicio de sesión y regístrate primero.' : e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
