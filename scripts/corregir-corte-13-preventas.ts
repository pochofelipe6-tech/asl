// Audita contra la imagen del seguimiento. --aplicar guarda un lote nuevo y conserva el anterior.
import XLSX from 'xlsx';
import pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { transformarBase } from '../src/shared/preventas-base.ts';
import type { FilaPreventa } from '../src/shared/preventas.ts';

const archivo = process.argv[2];
if (!archivo || !process.env.SUPABASE_DB_URL) throw new Error('Indica 13KA.xlsx y configura la conexión.');
const dia = 46339;
const sql = `with cortes as (
 select distinct on(d.fecha) d.fecha,d.lote_id from public.preventas_datos d
 join public.preventas_lotes l on l.id=d.lote_id order by d.fecha,l.creado_en desc,l.id desc
) select d.lote_id,d.fila,d.valores from public.preventas_datos d
 join cortes c on c.fecha=d.fecha and c.lote_id=d.lote_id order by d.fecha,d.fila`;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const firmas = (filas: FilaPreventa[]) => filas.map(f => JSON.stringify(f)).sort();
const metricas = (filas: FilaPreventa[]) => filas.reduce<number[]>((m, f) => [m[0]+Number(f[18]),m[1]+Number(f[18])-Number(f[20]),m[2]+Number(f[20])], [0,0,0]);
const imagen: Record<string, number[]> = {
 'Cartagena KA':[816,374,442], Barranquilla:[2,2,1], 'Apartadó':[348,261,87],
 'UDC Torices':[168,136,32], 'Montería':[1670,1399,271], Corozal:[1564,1364,201],
 Turbaco:[4029,3516,513], Caucasia:[315,288,27], 'Curumaní':[218,201,17],
 'San Andrés':[243,225,18], Galapa:[2564,2406,158], Valledupar:[1318,1248,70],
 'Santa Marta':[1462,1397,65], Fonseca:[107,103,5], 'La Arenosa':[2231,2136,95],
 'Cúcuta':[2510,2410,100], Riohacha:[609,600,8], 'Magangué':[447,444,3],
};
const clave = (s: unknown) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const pool = new pg.Pool({connectionString:process.env.SUPABASE_DB_URL,connectionTimeoutMillis:15000});
const client = await pool.connect();
try {
 await client.query('begin');
 await client.query("select pg_advisory_xact_lock(hashtext('preventas:guardar'))");
 const antes = (await client.query(sql)).rows;
 const libro = XLSX.readFile(archivo, {cellHTML:false,cellText:false});
 const rows = XLSX.utils.sheet_to_json<unknown[]>(libro.Sheets[libro.SheetNames[0]], {header:1,defval:null});
 const resultado = transformarBase(rows,'2026-11-13',antes.map(r=>r.valores));
 const filas = resultado.filas;
 const porCd = Object.fromEntries(Object.entries(imagen).map(([cd, esperado]) => {
   const m = metricas(filas.filter(f=>clave(f[21])===clave(cd)));
   if (m.some((n,i)=>Math.round(n)!==esperado[i])) throw new Error(`No coincide ${cd}: ${m}.`);
   return [cd,m];
 }));
 const total = metricas(filas);
 if (total.some((n,i)=>Math.round(n)!==[20622,18509,2113][i]) || filas.length!==995) throw new Error('No coincide el total o las 995 filas.');
 const porCanal = Object.fromEntries(['TAT','KA','T4'].map((canal,i)=>{
   const m=metricas(filas.filter(f=>f[15]===canal));
   if (Math.round(m[0])!==[14996,5330,296][i] || Math.round(m[1])!==[14245,3968,296][i]) throw new Error(`No coincide ${canal}: ${m}.`);
   return [canal,m];
 }));
 const otros = antes.filter(r=>Number(r.valores[0])!==dia);
 const anterior = antes.filter(r=>Number(r.valores[0])===dia);
 const so = (await client.query('select * from public.preventas_so_snapshot order by lote_id,fecha_excel,material,cd')).rows;
 const informe: Record<string,unknown> = {archivo:'13KA.xlsx',fecha:'2026-11-13',filas:filas.length,totales:total,porCd,porCanal,excluidas:resultado.excluidas.length,completadas:resultado.completadas,otrosRegistrosConservados:otros.length,soConservado:true};
 if (hash(firmas(anterior.map(r=>r.valores)))===hash(firmas(filas))) {
   await client.query('rollback'); informe.estado='Ya corregido; no se duplicó';
 } else if (!process.argv.includes('--aplicar')) {
   await client.query('rollback'); informe.estado='Auditado sin guardar';
 } else {
   await writeFile('datos/preventas/respaldo-corte-13-antes-correccion.json',JSON.stringify({anterior,otrosHash:hash(otros),soHash:hash(so)},null,2));
   const id=randomUUID();
   const usuario=(await client.query('select usuario_id from public.preventas_lotes order by creado_en desc,id desc limit 1')).rows[0]?.usuario_id??null;
   await client.query('insert into public.preventas_lotes(id,archivo,usuario_id) values($1,$2,$3)',[id,'13KA.xlsx',usuario]);
   await client.query('insert into public.preventas_datos(lote_id,fila,valores) select $1,ordinality::int,value from jsonb_array_elements($2::jsonb) with ordinality',[id,JSON.stringify(filas)]);
   const despues=(await client.query(sql)).rows;
   const soDespues=(await client.query('select * from public.preventas_so_snapshot order by lote_id,fecha_excel,material,cd')).rows;
   if(hash(otros)!==hash(despues.filter(r=>Number(r.valores[0])!==dia)) || hash(so)!==hash(soDespues) || hash(firmas(filas))!==hash(firmas(despues.filter(r=>Number(r.valores[0])===dia).map(r=>r.valores)))) throw new Error('Falló la verificación; se revierte la corrección.');
   await client.query('commit'); informe.estado='Corregido y verificado'; informe.lote=id;
 }
 await writeFile('datos/preventas/correccion-corte-13-resultado.json',JSON.stringify(informe,null,2));
 console.log(JSON.stringify(informe,null,2));
} catch(error) {await client.query('rollback');throw error;}
finally {client.release();await pool.end();}
