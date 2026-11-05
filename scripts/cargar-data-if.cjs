// Carga de manera transaccional la hoja Data preparada en Supabase/PostgreSQL.
// SUPABASE_DB_URL debe estar en .env.local; no imprimirla ni enviarla al navegador.
const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const readline = require('node:readline');

async function main() {
  if (!process.env.SUPABASE_DB_URL) throw new Error('Falta SUPABASE_DB_URL en .env.local.');
  const dir = path.join(__dirname, '..', 'datos', 'consolidado');
  const file = path.join(dir, 'data.ndjson.gz');
  const metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8'));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 15000 });
  await client.connect();
  let count = 0;
  try {
    await client.query('begin');
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'supabase', 'consolidado_schema.sql'), 'utf8'));
    await client.query('insert into public.frescura_consolidado_lotes(id, archivo, filas) values ($1,$2,$3) on conflict(id) do update set archivo=excluded.archivo, filas=excluded.filas', [hash, metadata.fuente, metadata.filas]);
    let batch = [];
    async function save() {
      if (!batch.length) return;
      await client.query(`insert into public.frescura_consolidado(lote_id, fila_excel, valores)
        select $1, fila_excel, valores from jsonb_to_recordset($2::jsonb) as r(fila_excel integer, valores jsonb)
        on conflict(lote_id, fila_excel) do update set valores=excluded.valores`, [hash, JSON.stringify(batch)]);
      count += batch.length; batch = [];
      if (count % 10000 === 0) console.log(`Cargadas ${count} filas...`);
    }
    const stream = fs.createReadStream(file).pipe(zlib.createGunzip());
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) { if (line) batch.push(JSON.parse(line)); if (batch.length >= 500) await save(); }
    await save();
    if (count !== metadata.filas) throw new Error(`Se esperaban ${metadata.filas} filas y se procesaron ${count}.`);
    const check = await client.query('select count(*)::integer as filas from public.frescura_consolidado where lote_id=$1', [hash]);
    if (check.rows[0].filas !== count) throw new Error('La verificación del número de filas no coincide.');
    await client.query('commit');
    console.log(`Carga verificada: ${count} filas.`);
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { await client.end(); }
}
main().catch(error => { console.error(`No se completó la carga: ${error.message}`); process.exitCode = 1; });
