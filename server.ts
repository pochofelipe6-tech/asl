import path from 'node:path';
import { readFile } from 'node:fs/promises';
import express from 'express';
import type { Request, RequestHandler, Response } from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import XLSX from 'xlsx';
import { rutasExcel } from './src/server/excel.ts';
import { rutasPreventas } from './src/server/preventas.ts';
import { rutasFormularios } from './src/server/formularios.ts';
import { rutasSolicitudes } from './src/server/solicitudes.ts';
import { rutasOfe, rutasT1, rutasWip } from './src/server/t1.ts';
import { crearAcceso, type SesionUsuario } from './src/server/usuarios.ts';

// Se entra con cédula y contraseña (src/server/usuarios.ts); los usuarios viven en la base (SUPABASE_DB_URL).
const { JWT_SECRET = '', PORT = '3001' } = process.env;
const variablesFaltantes = Object.entries({ JWT_SECRET })
  .filter(([, valor]) => !valor.trim())
  .map(([nombre]) => nombre);

if (variablesFaltantes.length) {
  console.error(`Faltan variables de autenticación: ${variablesFaltantes.join(', ')}. Configúralas en el entorno del servidor.`);
}

const COOKIE = 'sesion';
const DURACION_SESION = 8 * 60 * 60 * 1000; // 8 horas (una jornada)
const isProd = process.env.NODE_ENV === 'production';

// Lo que va firmado dentro de la cookie de sesión: id del usuario, cédula, nombre y rol.
type Sesion = SesionUsuario;

const app = express();
app.use('/api/excel', express.json({ limit: '2mb' }));
app.use('/api/preventas', express.json({ limit: '20mb' }));
app.use(express.json());
app.use(cookieParser());
app.use('/api', (_req, res, next) => {
  if (variablesFaltantes.length) {
    res.status(503).json({
      error: 'El inicio de sesión no está disponible. Contacta con el administrador.',
      code: 'AUTH_NOT_CONFIGURED',
      variablesFaltantes,
    });
    return;
  }
  next();
});

const leerSesion = (req: Request): Sesion | null => {
  if (variablesFaltantes.length) return null;
  const token: unknown = req.cookies[COOKIE];
  if (typeof token !== 'string') return null;
  try {
    const datos = jwt.verify(token, JWT_SECRET);
    // Las sesiones del ingreso anterior (con correo) no traen cédula: ya no valen y piden entrar de nuevo.
    return typeof datos === 'object' && typeof datos.cedula === 'string' ? (datos as Sesion) : null;
  } catch {
    return null;
  }
};

// Si ya hay sesión, muestra la selección de módulos.
app.get('/', (req, res) => {
  if (leerSesion(req)) { res.redirect('/modulos'); return; }
  res.sendFile(path.join(import.meta.dirname, 'public', 'index.html'));
});
app.use(express.static(path.join(import.meta.dirname, 'public')));

// Máximo 10 intentos fallidos cada 15 minutos por IP (los correctos no cuentan,
// así varios empleados pueden entrar desde la misma red de la oficina)
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});

// Registro de cuentas nuevas: máximo 5 por hora desde una misma IP.
const limiteRegistro = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados registros desde esta red. Inténtalo más tarde.' },
});

const dbFrescura = process.env.SUPABASE_DB_URL ? new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 3, connectionTimeoutMillis: 15000 }) : null;

const abrirSesion = (res: Response, sesion: Sesion) => {
  const token = jwt.sign({ sub: sesion.sub, cedula: sesion.cedula, nombre: sesion.nombre, rol: sesion.rol }, JWT_SECRET, { expiresIn: DURACION_SESION / 1000 });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: DURACION_SESION,
  });
};
const acceso = crearAcceso(dbFrescura, abrirSesion, leerSesion);

// Ingreso con cédula y contraseña; registro (queda pendiente hasta que un administrador lo apruebe).
app.post('/api/login', limiteLogin, acceso.login);
app.post('/api/registro', limiteRegistro, acceso.registro);
// Panel de usuarios: solo administradores (el rol se confirma en la base en cada petición).
app.use('/api/usuarios', acceso.admin);

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.status(204).end();
});

/** Sesión válida y usuario todavía activo en la base (si lo desactivaron, la sesión se cierra). */
async function sesionVigente(req: Request, res: Response): Promise<(Sesion & { rol: string }) | null> {
  const sesion = leerSesion(req);
  if (!sesion) return null;
  try {
    const usuario = await acceso.vigente(sesion.sub);
    if (!usuario) { res.clearCookie(COOKIE); return null; }
    return { ...sesion, nombre: usuario.nombre, rol: usuario.rol };
  } catch (error) {
    // Sin base no se puede confirmar: se deja pasar con lo que dice la cookie (firmada) antes que dejar a todos afuera.
    console.error('No se pudo confirmar la sesión:', (error as Error).message);
    return sesion;
  }
}

app.get('/api/me', async (req, res) => {
  const sesion = await sesionVigente(req, res);
  if (!sesion) {
    res.status(401).json({ error: 'No has iniciado sesión.' });
    return;
  }
  res.json({ cedula: sesion.cedula, nombre: sesion.nombre, rol: sesion.rol });
});
app.use('/api/preventas', rutasPreventas(dbFrescura, leerSesion));
app.use('/api/formularios', rutasFormularios(dbFrescura, leerSesion));
app.use('/api/solicitudes', rutasSolicitudes(dbFrescura, leerSesion));
app.use('/api/t1', rutasT1(dbFrescura, leerSesion));
app.use('/api/wip', rutasWip(dbFrescura, leerSesion));
app.use('/api/ofe', rutasOfe(dbFrescura, leerSesion));

// El catalogo debe estar disponible aunque el servidor no tenga los JSON locales del Excel.
app.get('/api/frescura/indice.json', async (req, res) => {
  if (!leerSesion(req)) { res.status(401).json({ error: 'No has iniciado sesión.' }); return; }
  if (!dbFrescura) { res.status(503).json({ error: 'Falta configurar la conexión a la base de datos.' }); return; }
  try {
    const resultado = await dbFrescura.query<{ id: number; nombre: string; rango_excel: string | null }>(
      'select id, nombre, rango_excel from public.frescura_hojas order by id',
    );
    if (!resultado.rows.length) { res.status(404).json({ error: 'No hay hojas importadas en el informe.' }); return; }
    const sheets = resultado.rows.map(hoja => {
      const rango = XLSX.utils.decode_range(hoja.rango_excel || 'A1:A1');
      return {
        id: hoja.id,
        name: hoja.nombre,
        startRow: rango.s.r + 1,
        startColumn: rango.s.c,
        rows: rango.e.r - rango.s.r + 1,
        columns: rango.e.c - rango.s.c + 1,
      };
    });
    const lote = await dbFrescura.query('select id from public.frescura_consolidado_lotes order by cargado_en desc limit 1');
    res.json({ sheets, filtrosRecientes: String(lote.rows[0]?.id ?? '').startsWith('web-') });
  } catch (error) {
    console.error('Error consultando el catálogo de hojas:', error instanceof Error ? error.message : 'error desconocido');
    res.status(500).json({ error: 'No se pudo consultar el catálogo del informe.' });
  }
});

app.get('/api/frescura/:archivo', async (req, res) => {
  if (!leerSesion(req)) { res.status(401).json({ error: 'No has iniciado sesión.' }); return; }
  const archivo = req.params.archivo;
  if (!/^(indice|\d+)\.json$/.test(archivo)) { res.sendStatus(404); return; }
  try {
    const contenido = await readFile(path.join(import.meta.dirname, 'datos', 'frescura', archivo));
    res.type('json').send(contenido);
  } catch { res.status(404).json({ error: 'La información solicitada no está disponible.' }); }
});

const camposFrescura = ['anio', 'fecha_envio', 'mes_1', 'vencimiento_2', 'linea', 'clase_envase', 'canal', 'empaque', 'gerencia', 'cd', 'codigo_cd', 'codigo_material', 'material', 'fecha_vencimiento', 'dias_venc_actual', 'costo_usd'] as const;
const gruposFrescura: Record<string, string[]> = {
  diario: ['cd', 'codigo_material', 'material', 'fecha_vencimiento', 'dias_venc_actual', 'fecha_envio'],
  resumen: ['cd', 'codigo_material', 'material', 'mes_1'],
  sku: ['codigo_material', 'material', 'cd'],
  if: ['codigo_material', 'material', 'cd', 'fecha_vencimiento', 'dias_venc_actual', 'vencimiento_2'],
  riesgo: ['gerencia', 'cd', 'codigo_material', 'material', 'fecha_vencimiento', 'dias_venc_actual', 'vencimiento_2'],
  tendencia: ['cd', 'fecha_envio', 'mes_1'],
  ka: ['codigo_material', 'material', 'cd', 'fecha_vencimiento', 'dias_venc_actual', 'vencimiento_2'],
  rango: ['codigo_material', 'material', 'cd', 'vencimiento_2'],
};
let opcionesFrescura: { lote: string; valores: Record<string, string[]>; ultimaFecha: string } | null = null;
app.use('/api/excel', rutasExcel(dbFrescura, leerSesion, () => { opcionesFrescura = null; }));
app.get('/api/consolidado-opciones/costos', async (req, res) => {
  if (!leerSesion(req)) { res.status(401).json({ error: 'No has iniciado sesión.' }); return; }
  if (!dbFrescura) { res.status(503).json({ error: 'Falta configurar la conexión a la base de datos.' }); return; }
  const busqueda = typeof req.query.q === 'string' ? req.query.q.trim().replace(',', '.').slice(0, 40) : '';
  try {
    const resultado = await dbFrescura.query(`select distinct costo_usd::text as valor from public.frescura_consolidado_detalle where lote_id = (select id from public.frescura_consolidado_lotes order by cargado_en desc limit 1) and ($1 = '' or coalesce(costo_usd::text, '') ilike '%' || $1 || '%') order by valor nulls first limit 101`, [busqueda]);
    res.json({ valores: resultado.rows.slice(0, 100).map((fila: { valor: string | null }) => fila.valor), mas: resultado.rows.length > 100 });
  } catch (error) { console.error('Error consultando costos:', error instanceof Error ? error.message : 'error desconocido'); res.status(500).json({ error: 'No se pudieron consultar los costos.' }); }
});
app.get('/api/consolidado/:modulo', async (req, res) => {
  if (!leerSesion(req)) { res.status(401).json({ error: 'No has iniciado sesión.' }); return; }
  const columnas = gruposFrescura[req.params.modulo];
  if (!columnas) { res.sendStatus(404); return; }
  if (!dbFrescura) { res.status(503).json({ error: 'Falta configurar la conexión a la base de datos.' }); return; }
  // Un navegador con el bundle anterior no debe interpretar la primera pagina como el total.
  if (req.query.paginado !== '1') { res.status(409).json({ error: 'Actualiza la página para cargar la versión actual del informe.' }); return; }
  const tamanoPagina = 5000;
  const limiteGrupos = 200000;
  const offsetTexto = req.query.offset ?? '0';
  const loteSolicitado = req.query.lote;
  if (typeof offsetTexto !== 'string' || !/^\d{1,6}$/.test(offsetTexto) || Number(offsetTexto) >= limiteGrupos || Number(offsetTexto) % tamanoPagina !== 0
      || (loteSolicitado !== undefined && (typeof loteSolicitado !== 'string' || !loteSolicitado.length || loteSolicitado.length > 200))) {
    res.status(400).json({ error: 'La página solicitada no es válida.' }); return;
  }
  const offset = Number(offsetTexto);
  try {
    const loteResult = loteSolicitado === undefined
      ? await dbFrescura.query('select id from public.frescura_consolidado_lotes order by cargado_en desc limit 1')
      : await dbFrescura.query('select id from public.frescura_consolidado_lotes where id = $1', [loteSolicitado]);
    const lote: string | undefined = loteResult.rows[0]?.id;
    if (!lote) { res.status(404).json({ error: 'No hay datos consolidados.' }); return; }
    if (!opcionesFrescura || opcionesFrescura.lote !== lote) {
      const opciones = await dbFrescura.query(`select ${camposFrescura.filter(c => c !== 'costo_usd').map(c => `array_remove(array_agg(distinct ${c}::text order by ${c}::text), null) as ${c}`).join(', ')} from public.frescura_consolidado_detalle where lote_id=$1`, [lote]);
      const valores = opciones.rows[0] as Record<string, string[]>;
      opcionesFrescura = { lote, valores, ultimaFecha: valores.fecha_envio.at(-1) ?? '' };
    }
    const opcionesActuales = opcionesFrescura;
    const parametros: string[] = [lote];
    const condiciones = ['lote_id = $1'];
    for (const campo of camposFrescura) {
      const valor = req.query[campo];
      if (campo === 'fecha_envio' && req.params.modulo === 'diario') {
        const fechas = (Array.isArray(valor) ? valor : typeof valor === 'string' ? [valor] : []).filter((v): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v));
        if (valor === '__ninguna__') condiciones.push('false');
        else if (fechas.length) { parametros.push(fechas.join(',')); condiciones.push(`fecha_envio::text = any(string_to_array($${parametros.length}, ','))`); }
        else if (valor !== '__todas__') { const ultimas = opcionesActuales.valores.fecha_envio.slice(-9); if (ultimas.length) { parametros.push(ultimas.join(',')); condiciones.push(`fecha_envio::text = any(string_to_array($${parametros.length}, ','))`); } }
      } else if (campo === 'costo_usd' && req.params.modulo === 'diario') {
        const costos = (Array.isArray(valor) ? valor : typeof valor === 'string' ? [valor] : []).filter((v): v is string => typeof v === 'string' && (v === '__vacio__' || /^-?\d+(?:\.\d+)?$/.test(v)));
        if (costos.length) { const numeros = costos.filter(v => v !== '__vacio__'); const partes: string[] = []; if (numeros.length) { parametros.push(numeros.join(',')); partes.push(`costo_usd::text = any(string_to_array($${parametros.length}, ','))`); } if (costos.includes('__vacio__')) partes.push('costo_usd is null'); condiciones.push(`(${partes.join(' or ')})`); }
      } else {
        const valores = (Array.isArray(valor) ? valor : typeof valor === 'string' ? [valor] : []).filter((v): v is string => typeof v === 'string' && v.length <= 150 && !v.includes('\u001f') && v !== '__todas__');
        if (valores.includes('__ninguna__')) condiciones.push('false');
        else if (valores.length) {
          const incluyeVacios = valores.includes('__vacio__'); const presentes = valores.filter(v => v !== '__vacio__'); const partes: string[] = [];
          if (presentes.length) { parametros.push(presentes.join('\u001f')); partes.push(`${campo}::text = any(string_to_array($${parametros.length}, chr(31)))`); }
          if (incluyeVacios) partes.push(`(${campo} is null or ${campo}::text = '')`);
          if (partes.length) condiciones.push(`(${partes.join(' or ')})`);
        }
      }
    }
    const historico = req.params.modulo === 'diario' || req.params.modulo === 'tendencia' || req.query.fecha_envio === '__todas__';
    if (!historico && !req.query.fecha_envio && opcionesActuales.ultimaFecha) { parametros.push(opcionesActuales.ultimaFecha); condiciones.push(`fecha_envio::text = $${parametros.length}`); }
    const dimensions = columnas.join(', ');
    const agrupada = `select ${dimensions}, sum(coalesce(hectolitros, 0))::float8 as hectolitros, sum(coalesce(valor_total, 0))::float8 as valor_total, sum(coalesce(costo_usd, 0))::float8 as costo_usd from public.frescura_consolidado_detalle where ${condiciones.join(' and ')} group by ${dimensions}`;
    const requiereUmbral = ['if', 'riesgo', 'ka'].includes(req.params.modulo);
    const particion = columnas.filter(c => c !== 'vencimiento_2').join(', ');
    // Paginas pequeñas para respetar el limite de respuesta del alojamiento.
    // El orden completo y el lote fijado permiten reunirlas sin duplicar grupos.
    const paginacion = ` limit ${tamanoPagina + 1} offset ${offset}`;
    const consulta = requiereUmbral ? `select ${dimensions}, hectolitros, valor_total, costo_usd from (select *, sum(hectolitros) over (partition by ${particion}) as total_fecha from (${agrupada}) grupos) filtrados where total_fecha >= 10 order by ${dimensions}${paginacion}` : `${agrupada} order by ${dimensions}${paginacion}`;
    const resultado = await dbFrescura.query(consulta, parametros);
    const hayMas = resultado.rows.length > tamanoPagina;
    const siguienteOffset = hayMas && offset + tamanoPagina < limiteGrupos ? offset + tamanoPagina : null;
    const truncado = hayMas && siguienteOffset === null;
    res.json({ opciones: opcionesActuales.valores, ultimaFecha: opcionesActuales.ultimaFecha, historico, filas: resultado.rows.slice(0, tamanoPagina), truncado, lote, siguienteOffset });
  } catch (error) {
    console.error('Error consultando el consolidado:', error instanceof Error ? error.message : 'error desconocido');
    res.status(500).json({ error: 'No se pudo consultar el consolidado.' });
  }
});

// Páginas protegidas (en views/): sin sesión válida (o con el usuario desactivado) vuelven al login.
const paginaProtegida = (archivo: string, soloAdmin = false): RequestHandler => async (req, res) => {
  const sesion = await sesionVigente(req, res);
  if (!sesion) {
    res.redirect('/');
    return;
  }
  if (soloAdmin && sesion.rol !== 'administrador') {
    res.redirect('/modulos');
    return;
  }
  res.sendFile(path.join(import.meta.dirname, 'views', archivo));
};

app.get('/usuarios', paginaProtegida('usuarios.html', true));

app.get('/panel', paginaProtegida('panel.html'));
app.get('/modulos', paginaProtegida('modulos.html'));
app.get('/preventas', paginaProtegida('preventas.html'));
app.get('/formularios', paginaProtegida('formularios.html'));
app.get('/solicitudes', paginaProtegida('solicitudes.html'));
app.get('/activos', paginaProtegida('activos.html'));
app.get('/t1', paginaProtegida('t1.html'));
app.get('/wip', paginaProtegida('wip.html'));
app.get('/ofe', paginaProtegida('ofe.html'));

export default app;

if (!process.env.VERCEL) app.listen(Number(PORT), err => {
  if (err) {
    console.error(`No se pudo arrancar en el puerto ${PORT}: ${err.message}`);
    process.exit(1);
  }
  console.log(`Bavaria Transporte en http://localhost:${PORT}`);
});
