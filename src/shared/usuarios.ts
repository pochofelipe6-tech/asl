// Acceso con cédula y contraseña: reglas que comparten la página de ingreso, el panel de usuarios y el servidor.
// Cada persona se registra con su cédula, su nombre y la contraseña que elija; queda "pendiente" hasta que un
// administrador la apruebe y le asigne un rol (ver src/server/usuarios.ts).

export const ROLES = ['administrador', 'usuario'] as const;
export type Rol = (typeof ROLES)[number];
export const NOMBRE_ROL: Record<Rol, string> = { administrador: 'Administrador', usuario: 'Usuario' };
/** Qué puede hacer cada rol (se muestra en el panel al elegirlo). */
export const DETALLE_ROL: Record<Rol, string> = {
  administrador: 'Ve todos los módulos y administra usuarios (aprueba, desactiva, cambia roles y restablece contraseñas).',
  usuario: 'Ve todos los módulos.',
};

export const ESTADOS = ['pendiente', 'activo', 'inactivo', 'rechazado'] as const;
export type Estado = (typeof ESTADOS)[number];
export const NOMBRE_ESTADO: Record<Estado, string> = { pendiente: 'Pendiente', activo: 'Activo', inactivo: 'Inactivo', rechazado: 'Rechazado' };

export const CLAVE_MIN = 8;
export const CLAVE_MAX = 72;

/** La cédula se escribe como sea (con puntos o espacios); se guarda solo con dígitos. */
export const normalizarCedula = (valor: unknown) => String(valor ?? '').replace(/[\s.,\-]/g, '');

export function errorCedula(cedula: string): string | null {
  if (!cedula) return 'Escribe tu número de cédula.';
  if (!/^\d+$/.test(cedula)) return 'La cédula solo lleva números.';
  if (cedula.length < 5 || cedula.length > 12) return 'La cédula debe tener entre 5 y 12 números.';
  return null;
}

/** Nombre completo: espacios de más fuera, letras (con tildes), espacios, puntos, apóstrofos y guiones. */
export const normalizarNombre = (valor: unknown) => String(valor ?? '').trim().replace(/\s+/g, ' ');
export function errorNombre(nombre: string): string | null {
  if (!nombre) return 'Escribe tu nombre completo.';
  if (nombre.length < 3 || nombre.length > 80) return 'El nombre debe tener entre 3 y 80 caracteres.';
  if (!/^[\p{L}][\p{L} .'\-]*$/u.test(nombre)) return 'El nombre solo puede llevar letras y espacios.';
  return null;
}

/** Contraseña: 8 a 72 caracteres, con al menos una letra y un número, y que no contenga la cédula. */
export function errorClave(clave: string, cedula = ''): string | null {
  if (!clave) return 'Escribe una contraseña.';
  if (clave.length < CLAVE_MIN) return `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`;
  if (clave.length > CLAVE_MAX) return `La contraseña puede tener máximo ${CLAVE_MAX} caracteres.`;
  if (!/\p{L}/u.test(clave) || !/\d/.test(clave)) return 'La contraseña debe tener letras y números.';
  if (cedula && clave.includes(cedula)) return 'La contraseña no puede contener tu cédula.';
  return null;
}

export const esRol = (v: unknown): v is Rol => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/** Usuario tal como lo ve el panel de administración (nunca lleva la contraseña). */
export interface UsuarioPanel {
  id: string; cedula: string; nombre: string; rol: Rol; estado: Estado; debe_cambiar: boolean;
  creado_en: string; ultimo_ingreso: string | null; aprobado_por: string | null; aprobado_en: string | null;
}
