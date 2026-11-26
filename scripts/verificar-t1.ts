// Verifica el motor de Seguimiento T1 (src/shared/t1.ts) contra las cifras que calculó Power BI.
// Uso: node scripts/verificar-t1.ts <ATCT.xlsx> <ESPERA.xlsx> <carpeta con ref-*.tsv>
// Los ref-*.tsv salen del modelo de Power BI (consultas DAX de solo lectura).
import XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { calcularT1, diaDeIso, filasAtct, filasEspera, leerAtct, leerEspera } from '../src/shared/t1.ts';
import type { FiltrosT1 } from '../src/shared/t1.ts';

const [archivoAtct, archivoEspera, carpeta] = process.argv.slice(2);
const hoja = (archivo: string) => XLSX.utils.sheet_to_json<unknown[]>(XLSX.readFile(archivo, { dense: true, sheets: ['Export'] }).Sheets.Export, { header: 1, raw: true, defval: null });
console.time('lectura y cálculo');
const atct = leerAtct(hoja(archivoAtct));
const espera = leerEspera(hoja(archivoEspera));
const datos = { atct: filasAtct(atct.columnas), espera: filasEspera(espera.columnas) };
const ref = (k: string) => readFileSync(path.join(carpeta, `ref-${k}.tsv`), 'utf8').replace(/(\r?\n)+$/, '').split(/\r?\n/).slice(1).map(l => l.split('\t'));
let fallas = 0, revisadas = 0;
const comparar = (nombre: string, mio: number | null | undefined, suyo: string | undefined) => {
  revisadas++;
  const b = suyo === undefined || suyo === '' ? null : Number(suyo);
  const a = mio ?? null;
  const ok = a === null || b === null ? a === b : Math.abs(a - b) < 1e-9;
  if (!ok) { fallas++; console.log(`DIFERENCIA ${nombre}: app=${a} power bi=${b}`); }
};
const de = (iso: string) => diaDeIso(iso.slice(0, 10));
const lc = (s: string) => s.toLowerCase();
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

for (const [nombre, filtros, pref] of [['noviembre', { desde: diaDeIso('2026-11-01'), hasta: diaDeIso('2026-11-25') }, ''], ['octubre', { desde: diaDeIso('2026-10-01'), hasta: diaDeIso('2026-10-22') }, 'oct_']] as const) {
  const r = calcularT1(datos, filtros as FiltrosT1);
  const t = ref(`${pref}tarjetas`)[0];
  comparar(`${nombre} vehículos`, r.tarjetas.vehiculos, t[0]); comparar(`${nombre} atención`, r.tarjetas.atencion, t[1]);
  comparar(`${nombre} espera`, r.tarjetas.espera, t[2]); comparar(`${nombre} ftct`, r.tarjetas.ftct, t[3]);
  if (pref === '') {
    for (const [cd, a, f] of ref('por_cd')) { const x = r.porCd.find(c => lc(c.cd) === lc(cd)); comparar(`cd ${cd}`, x?.atencion, a); comparar(`ftct ${cd}`, x?.ftct, f); }
    for (const [g, a] of ref('por_gerencia')) comparar(`gerencia ${g}`, r.porGerencia.find(x => x.gerencia === g)?.atencion, a);
    for (const [o, a] of ref('por_ol')) comparar(`ol ${o}`, r.porOl.find(x => x.ol === o)?.atencion, a);
    for (const [tu, a] of ref('por_turno')) comparar(`turno ${tu}`, r.porTurno.find(x => x.turno === tu)?.atencion, a);
    for (const [d, a] of ref('por_dia_semana')) comparar(`día ${d}`, r.porDiaSemana.find(x => DIAS[x.dia] === d)?.atencion, a);
    for (const [s, a] of ref('por_semana')) comparar(`semana ${s}`, r.porSemana.find(x => x.semana === Number(s))?.atencion, a);
    for (const [fecha, a] of ref('por_dia')) comparar(`día ${fecha.slice(0, 10)}`, r.diaria.find(x => x.fecha === de(fecha))?.atencion, a);
    for (const [cd, fecha, a] of ref('heatmap_atct')) { const i = r.mapaAtencion.cds.findIndex(c => lc(c) === lc(cd)); comparar(`mapa ${cd} ${fecha.slice(0, 10)}`, r.mapaAtencion.valores[i]?.[r.mapaAtencion.fechas.indexOf(de(fecha))], a); }
    for (const [placa, a] of ref('atct_por_placa')) comparar(`placa ${placa}`, r.atencionPorPlaca.find(x => x.placa === placa)?.horas, a);
    comparar('exclusiones atención', r.exclusionesAtencion.length, ref('exclusiones_atct')[0][0]);
    for (const [mesNombre, nro, a, e] of ref('por_mes')) { const m = r.mensual.find(x => Number(x.mes.slice(5)) === Number(nro)); comparar(`mes ${mesNombre} atención`, m?.atencion, a); comparar(`mes ${mesNombre} espera`, m?.espera, e); }
  } else {
    for (const [cd, e] of ref('oct_espera_cd')) comparar(`oct espera ${cd}`, r.porCd.find(c => lc(c.cd) === lc(cd))?.espera, e);
    for (const [cd, f] of ref('oct_ftct_cd')) comparar(`oct ftct ${cd}`, r.porCd.find(c => lc(c.cd) === lc(cd))?.ftct, f);
    for (const [tu, e] of ref('oct_turno')) comparar(`oct espera turno ${tu}`, r.porTurno.find(x => x.turno === tu)?.espera, e);
    for (const [d, e] of ref('oct_dia_semana')) comparar(`oct espera ${d}`, r.porDiaSemana.find(x => DIAS[x.dia] === d)?.espera, e);
    for (const [cd, fecha, e] of ref('oct_heat_espera')) { const i = r.mapaEspera.cds.findIndex(c => lc(c) === lc(cd)); comparar(`oct mapa espera ${cd} ${fecha.slice(0, 10)}`, r.mapaEspera.valores[i]?.[r.mapaEspera.fechas.indexOf(de(fecha))], e); }
    for (const [placa, e] of ref('oct_espera_placa')) comparar(`oct espera placa ${placa}`, r.esperaPorPlaca.find(x => x.placa === placa)?.horas, e);
    const g = ref('oct_gerencia_filtro')[0];
    const rg = calcularT1(datos, { ...filtros, gerencias: ['Monteria'] });
    comparar('oct gerencia Monteria atención', rg.tarjetas.atencion, g[0]);
    comparar('oct gerencia Monteria espera', promedioEsperaZona(rg), g[1]);
  }
}
// La consulta de Power BI de la gerencia usa la zona de atención: es la espera del FTCT.
function promedioEsperaZona(r: ReturnType<typeof calcularT1>) { return r.tarjetas.ftct === null || r.tarjetas.atencion === null ? null : r.tarjetas.ftct - r.tarjetas.atencion; }
console.timeEnd('lectura y cálculo');
console.log(`ATCT ${atct.filas} filas (${atct.omitidas.length} omitidas) · ESPERA ${espera.filas} filas (${espera.omitidas.length} omitidas)`);
console.log(fallas ? `${fallas} diferencias de ${revisadas} cifras` : `Las ${revisadas} cifras coinciden con Power BI.`);
process.exitCode = fallas ? 1 : 0;
