// Verifica los motores de Seguimiento WIP (src/shared/wip.ts) y OFE (src/shared/ofe.ts) contra las cifras de Power BI.
// Uso: node scripts/verificar-wip-ofe.ts <Data WIP.xlsx> <Data FMS.xlsx> <carpeta con ref-*.tsv>
import XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { diaDeIso } from '../src/shared/t1.ts';
import { calcularWip, filasWip, leerWip } from '../src/shared/wip.ts';
import { calcularOfe, filasFms, leerFms } from '../src/shared/ofe.ts';

const [archivoWip, archivoFms, carpeta] = process.argv.slice(2);
const hoja = (archivo: string, nombre: string) => XLSX.utils.sheet_to_json<unknown[]>(XLSX.readFile(archivo, { dense: true, sheets: [nombre] }).Sheets[nombre], { header: 1, raw: true, defval: null });
const ref = (k: string) => readFileSync(path.join(carpeta, `ref-${k}.tsv`), 'utf8').replace(/(\r?\n)+$/, '').split(/\r?\n/).slice(1).map(l => l.split('\t'));
let fallas = 0, revisadas = 0;
const comparar = (nombre: string, mio: number | null | undefined, suyo: string | undefined) => {
  revisadas++;
  const b = suyo === undefined || suyo === '' ? null : Number(suyo);
  const a = mio ?? null;
  const ok = a === null || b === null ? a === b : Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b));
  if (!ok) { fallas++; console.log(`DIFERENCIA ${nombre}: app=${a} power bi=${b}`); }
};
const lc = (s: string) => s.toLowerCase();
const de = (fecha: string) => diaDeIso(fecha.slice(0, 10));

// ---- WIP (01/11/2026 – 25/11/2026) ----
const lw = leerWip(hoja(archivoWip, 'Hoja1'));
const wip = filasWip(lw.columnas);
const rw = calcularWip(wip, { desde: diaDeIso('2026-11-01'), hasta: diaDeIso('2026-11-25') });
const tw = ref('wip_tarjetas')[0];
comparar('wip filas', rw.tarjetas.filas, tw[0]); comparar('wip usabilidad', rw.tarjetas.wip, tw[1]);
comparar('wip armado', rw.tarjetas.armado, tw[2]); comparar('wip verificación', rw.tarjetas.verificacion, tw[3]); comparar('wip montacargas', rw.tarjetas.montacargas, tw[4]);
for (const [cd, w, a, v, m] of ref('wip_por_cd')) { const x = rw.porCd.find(c => lc(c.cd) === lc(cd)); comparar(`wip ${cd}`, x?.wip, w); comparar(`armado ${cd}`, x?.armado, a); comparar(`verif ${cd}`, x?.verificacion, v); comparar(`montac ${cd}`, x?.montacargas, m); }
for (const [g, w] of ref('wip_por_gerencia')) comparar(`wip gerencia ${g}`, rw.porGerencia.find(x => x.gerencia === g)?.wip, w);
for (const [o, w] of ref('wip_por_ol')) comparar(`wip ol ${o}`, rw.porOl.find(x => x.ol === o)?.wip, w);
for (const [fecha, w, a, v, m, fin, tot] of ref('wip_por_dia')) { const x = rw.porDia.find(d => d.fecha === de(fecha)); comparar(`wip día ${fecha.slice(0, 10)}`, x?.wip, w); comparar(`armado día ${fecha.slice(0, 10)}`, x?.armado, a); comparar(`verif día`, x?.verificacion, v); comparar('montac día', x?.montacargas, m); comparar('finalizados día', x?.finalizados, fin); comparar('total día', x?.total, tot); }
for (const [s, w] of ref('wip_por_semana')) comparar(`wip semana ${s}`, rw.porSemana.find(x => x.semana === Number(s))?.wip, w);
for (const [cd, fecha, , a, v, m] of ref('wip_mapa')) { const i = rw.mapa.cds.findIndex(c => lc(c) === lc(cd)); const c = rw.mapa.valores[i]?.[rw.mapa.fechas.indexOf(de(fecha))]; comparar(`mapa armado ${cd} ${fecha.slice(0, 10)}`, c?.armado, a); comparar('mapa verif', c?.verificacion, v); comparar('mapa montac', c?.montacargas, m); }

// ---- OFE (01/10/2026 – 23/10/2026, solo montacargas con CD) ----
const lf = leerFms(hoja(archivoFms, 'Data FMS'));
const fms = filasFms(lf.columnas);
const ro = calcularOfe(fms, { desde: diaDeIso('2026-10-01'), hasta: diaDeIso('2026-10-23') });
const to = ref('ofe_tarjetas')[0];
comparar('ofe filas', ro.tarjetas.filas, to[0]); comparar('ofe ralentí', ro.tarjetas.ralenti, to[1]); comparar('ofe %', ro.tarjetas.ofe, to[2]);
comparar('ofe encendido', ro.tarjetas.encendido, to[3]); comparar('ofe carga', ro.tarjetas.carga, to[4]); comparar('ofe movimiento', ro.tarjetas.movimiento, to[5]);
for (const [t, r, c, m] of ref('ofe_por_turno')) { const x = ro.porTurno.find(y => y.turno === t); comparar(`turno ${t} ralentí`, x?.ralenti, r); comparar(`turno ${t} carga`, x?.carga, c); comparar(`turno ${t} mov`, x?.movimiento, m); }
for (const [maq, r, o] of ref('ofe_por_maquina')) { const x = ro.porMaquina.find(y => y.maquina === maq); comparar(`máquina ${maq} ralentí`, x?.ralenti, r); comparar(`máquina ${maq} ofe`, x?.ofe, o); }
for (const [fecha, e, m, c] of ref('ofe_por_dia')) { const x = ro.porDia.find(d => d.fecha === de(fecha)); comparar(`día ${fecha.slice(0, 10)} encendido`, x?.encendido, e); comparar('día mov', x?.movimiento, m); comparar('día carga', x?.carga, c); }
for (const [cd, c, m, r, o] of ref('ofe_por_cd')) { const x = ro.porCd.find(y => lc(y.cd) === lc(cd)); comparar(`cd ${cd} carga`, x?.carga, c); comparar(`cd ${cd} mov`, x?.movimiento, m); comparar(`cd ${cd} ralentí`, x?.ralenti, r); comparar(`cd ${cd} ofe`, x?.ofe, o); }
for (const [g, r] of ref('ofe_por_gerencia')) comparar(`gerencia ${g} ralentí`, ro.porGerencia.find(x => x.gerencia === g)?.ralenti, r);
comparar('ofe filas sin CD', ro.sinCd.filas, ref('ofe_sin_cd')[0][0]);

console.log(`WIP ${lw.filas} filas (${lw.omitidas.length} omitidas) · FMS ${lf.filas} filas (${lf.omitidas.length} omitidas)`);
console.log(fallas ? `${fallas} diferencias de ${revisadas} cifras` : `Las ${revisadas} cifras coinciden con Power BI.`);
process.exitCode = fallas ? 1 : 0;
