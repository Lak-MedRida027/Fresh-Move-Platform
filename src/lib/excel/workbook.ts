/**
 * Builds the .xlsx file from an export description. Runs in the admin's
 * browser (loaded only when someone exports: the library is ~250 KB gzipped)
 * and in the unit tests, which read the file back.
 *
 * Every sheet: bold header row, frozen so it stays visible while scrolling,
 * a filter on every column, sensible widths, right-to-left in Darja.
 */
import ExcelJS from 'exceljs';
import { cellValue, NUM_FMT, safeText, sheetName, type Column, type ExportSpec } from './spec';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0EC' } };

function addTable(ws: ExcelJS.Worksheet, columns: Column[], rows: (string | number | Date | null)[][]) {
  ws.columns = columns.map((c, i) => ({
    key: `c${i}`,
    width: c.width,
    style: {
      numFmt: NUM_FMT[c.type],
      alignment: c.wrap ? { wrapText: true, vertical: 'top' } : { vertical: 'top' },
    },
  }));
  const header = ws.addRow(columns.map((c) => safeText(c.header)));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.numFmt = '@';
  });
  for (const row of rows) ws.addRow(row);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
}

export async function buildWorkbook(spec: ExportSpec): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Fresh Move';
  wb.title = safeText(spec.title);
  wb.created = new Date();
  const taken = new Set<string>();
  for (const sheet of spec.sheets) {
    const name = sheetName(sheet.name, taken);
    taken.add(name.toLowerCase());
    const ws = wb.addWorksheet(name, { views: [{ rightToLeft: spec.rtl, state: 'frozen', ySplit: 1 }] });
    if (sheet.kind === 'table') {
      addTable(
        ws,
        sheet.columns,
        sheet.rows.map((row) => sheet.columns.map((c, i) => cellValue(row[i] ?? null, c.type))),
      );
    } else {
      // Values of different types in one column: the format is set per cell.
      addTable(
        ws,
        [
          { header: sheet.headers[0], width: 28, type: 'text' },
          { header: sheet.headers[1], width: 40, type: 'text', wrap: true },
        ],
        sheet.pairs.map((p) => [cellValue(p.label, 'text'), cellValue(p.value, p.type)]),
      );
      sheet.pairs.forEach((p, i) => {
        const cell = ws.getRow(i + 2).getCell(2);
        cell.numFmt = NUM_FMT[p.type];
        cell.alignment = { horizontal: spec.rtl ? 'right' : 'left', vertical: 'top', wrapText: true };
      });
    }
  }
  const out = await wb.xlsx.writeBuffer();
  // A Buffer (a Uint8Array) in Node and in the browser build: copy it into a plain ArrayBuffer.
  return new Uint8Array(out as unknown as Uint8Array).slice().buffer;
}
