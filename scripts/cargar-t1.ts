// Carga inicial de los módulos de Comando Central: crea o actualiza la tabla (supabase/t1_schema.sql) y guarda los
// archivos con el mismo lector de las páginas. Indica cada archivo con su tipo (atct, espera, wip o fms). Uso:
//   node --env-file=.env.local scripts/cargar-t1.ts atct=ATCT.xlsx espera=ESPERA.xlsx wip="Data WIP.xlsx" fms="Data FMS.xlsx"
import XLSX from 'xlsx';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { gzipSync } from 'node:zlib';
import { isoDeDia, leerAtct, leerEspera, validarColumnas } from '../src/shared/t1.ts';
import { leerWip, validarColumnasWip } from '../src/shared/wip.ts';
import { leerFms, validarColumnasFms } from '../src/shared/ofe.ts';

const hoja = (archivo: string, nombre: string) => {
  const libro = XLSX.readFile(archivo, { dense: true, sheets: [nombre] });
  if (!libro.Sheets[nombre]) throw new Error(`${basename(archivo)} no tiene la hoja "${nombre}".`);
  return XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[nombre], { header: 1, raw: true, defval: null });
};
interface Lectura { columnas: unknown; filas: number; omitidas: unknown[]; desde: number | null; hasta: number | null }
const LECTORES: Record<string, { leer(archivo: string): Lectura; validar(c: unknown): string | null }> = {
  atct: { leer: a => leerAtct(hoja(a, 'Export')), validar: c => validarColumnas(c, 'atct') },
  espera: { leer: a => leerEspera(hoja(a, 'Export')), validar: c => validarColumnas(c, 'espera') },
  wip: { leer: a => leerWip(hoja(a, 'Hoja1')), validar: validarColumnasWip },
  fms: { leer: a => leerFms(hoja(a, 'Data FMS')), validar: validarColumnasFms },
};

const pedidos = process.argv.slice(2).map(arg => {
  const [tipo, ...resto] = arg.split('=');
  if (!LECTORES[tipo] || !resto.length) throw new Error(`Argumento no válido: ${arg}. Usa tipo=archivo (tipos: ${Object.keys(LECTORES).join(', ')}).`);
  return { tipo, archivo: resto.join('=') };
});
if (!pedidos.length) throw new Error('Indica los archivos, por ejemplo wip="Data WIP.xlsx".');
if (!process.env.SUPABASE_DB_URL) throw new Error('Falta SUPABASE_DB_URL.');

// Primero se leen y validan todos; si alguno falla no se guarda nada.
const cargas = pedidos.map(({ tipo, archivo }) => {
  const lectura = LECTORES[tipo].leer(archivo);
  const problema = LECTORES[tipo].validar(lectura.columnas);
  if (problema) throw new Error(`${basename(archivo)}: ${problema}`);
  return { tipo, archivo, lectura };
});
const pool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
try {
  await pool.query(readFileSync('supabase/t1_schema.sql', 'utf8'));
  for (const { tipo, archivo, lectura } of cargas) {
    const gzip = gzipSync(JSON.stringify(lectura.columnas), { level: 9 });
    await pool.query(
      `insert into public.t1_cargas (tipo, archivo, filas, desde, hasta, datos, usuario_id, usuario_nombre) values ($1, $2, $3, $4, $5, $6, null, $7)`,
      [tipo, basename(archivo), lectura.filas, isoDeDia(lectura.desde!), isoDeDia(lectura.hasta!), gzip, 'Carga inicial']);
    console.log(`${tipo}: ${basename(archivo)} · ${lectura.filas} filas (${lectura.omitidas.length} omitidas) · ${isoDeDia(lectura.desde!)} a ${isoDeDia(lectura.hasta!)} · ${(gzip.length / 1024 / 1024).toFixed(2)} MB comprimido`);
  }
} finally { await pool.end(); }
