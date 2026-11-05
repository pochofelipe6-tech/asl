const XLSX = require('xlsx');
const fs = require('node:fs');
const path = require('node:path');
const input = process.argv[2];
if (!input) throw new Error('Indica la ruta del archivo Excel.');
const workbook = XLSX.readFile(input, { cellDates: true });
const dir = path.join(__dirname, '..', 'datos', 'frescura');
fs.mkdirSync(dir, { recursive: true });
const sheets = workbook.SheetNames.map((name, id) => {
  const sheet = workbook.Sheets[name];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cells = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      cells.push(cell && cell.v != null ? XLSX.utils.format_cell(cell) : '');
    }
    rows.push(cells);
  }
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(rows));
  return { id, name, startRow: range.s.r + 1, startColumn: range.s.c, rows: rows.length, columns: range.e.c - range.s.c + 1 };
});
fs.writeFileSync(path.join(dir, 'indice.json'), JSON.stringify({ sheets, importedAt: new Date().toISOString() }));
console.log(`Importadas ${sheets.length} hojas en ${dir}`);
