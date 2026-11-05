// Convierte la hoja Data del XLSB a registros comprimidos para la carga.
// Uso: node --max-old-space-size=4096 scripts/preparar-data-if.cjs <archivo.xlsb>
const XLSX = require('xlsx');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { once } = require('node:events');

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Indica la ruta del archivo XLSB.');
  console.log('Leyendo la hoja Data; esto puede tardar varios minutos...');
  const workbook = XLSX.readFile(input, { sheets: 'Data', dense: true, cellFormula: false, cellText: false, cellNF: false });
  const sheet = workbook.Sheets.Data;
  if (!sheet || !sheet['!ref']) throw new Error('El archivo no contiene la hoja Data.');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const get = (row, column) => sheet[row]?.[column]?.v ?? null;
  const headers = Array.from({ length: range.e.c + 1 }, (_, column) => String(get(0, column) ?? '').trim());
  const expected = ['Fecha envio información', 'Llave', 'Código CD', 'Código Material', 'Cantidad', 'Fecha Vencimiento', 'Usuario', 'Fecha Modificación', 'Material', 'CD', 'Factor', 'HL', 'Hectolitros', 'Cajas', 'Mes', 'Días Vencimiento', 'Rango Días 1', 'Día', 'Empaque', 'Línea', 'USD/HL', 'Costo USD', 'Gerencia', 'Semana', 'TRM', 'Clase Envase', 'Vencimiento 2', 'Vida Útil', 'Dias Venc Actual', 'Venc Actual', 'Logística', 'Ventas', 'Valor UN', 'Valor total', 'Canal', 'Venta', 'Politica_Min_Dias', 'Politica_Max_Dias', 'Venta', 'Mes 1', 'Año'];
  if (expected.some((name, i) => headers[i] !== name)) throw new Error('Las columnas de Data no coinciden con la estructura esperada; no se importó ningún dato.');
  const folder = path.join(__dirname, '..', 'datos', 'consolidado');
  fs.mkdirSync(folder, { recursive: true });
  const output = fs.createWriteStream(path.join(folder, 'data.ndjson.gz'));
  const gzip = zlib.createGzip(); gzip.pipe(output);
  let count = 0;
  for (let row = 1; row <= range.e.r; row++) {
    const values = headers.map((_, column) => get(row, column));
    if (values.every(value => value === null || value === '')) continue;
    const record = JSON.stringify({ fila_excel: row + 1, valores: values }) + '\n';
    if (!gzip.write(record)) await once(gzip, 'drain');
    count++;
    if (count % 25000 === 0) console.log(`Procesadas ${count} filas...`);
  }
  gzip.end(); await once(output, 'finish');
  fs.writeFileSync(path.join(folder, 'metadata.json'), JSON.stringify({ columnas: headers, filas: count, fuente: path.basename(input) }, null, 2));
  console.log(`Preparadas ${count} filas de Data.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
