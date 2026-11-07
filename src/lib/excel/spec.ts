/**
 * Excel export: the description of a workbook (sheets, typed columns, rows),
 * plus the helpers that make cell values safe. Pure: used by the server (to
 * describe the export), the browser (to build it) and the tests.
 */
import { TZ } from '../dates';

/**
 * text / phone: stored as text (numFmt "@"), so Excel never turns a phone into
 * a number or drops its leading "+". number: whole numbers. money: dinars with
 * a thousands separator. datetime: an instant, shown in Algeria time. date: a
 * calendar day (YYYY-MM-DD).
 */
export type ColumnType = 'text' | 'phone' | 'number' | 'money' | 'datetime' | 'date';
export type Cell = string | number | null;

export interface Column {
  header: string;
  width: number;
  type: ColumnType;
  wrap?: boolean;
}

export interface TableSheet {
  kind: 'table';
  name: string;
  columns: Column[];
  rows: Cell[][];
}

/** Two columns (label, value), one fact per row: the trip summary. */
export interface PairsSheet {
  kind: 'pairs';
  name: string;
  headers: [string, string];
  pairs: { label: string; value: Cell; type: ColumnType }[];
}

export interface ExportSpec {
  filename: string;
  title: string;
  /** Right-to-left sheets (Darja). */
  rtl: boolean;
  sheets: (TableSheet | PairsSheet)[];
}

export const MAX_EXPORT_ROWS = 10_000;

// Control characters other than tab and newline aren't allowed in the
// spreadsheet's XML: Excel refuses to open a file that contains them.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
// A cell starting with one of these can become a formula when someone edits it
// or saves the sheet as CSV ("formula injection"). Full-width forms included.
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/;

/** Text as it goes into a cell: no control characters, never a formula. */
export function safeText(value: string): string {
  const clean = value.replace(CONTROL, '');
  return FORMULA_START.test(clean) ? `'${clean}` : clean;
}

/** Phones are kept as written (+213…); anything that isn't a phone is treated as text. */
export function safePhone(value: string): string {
  return /^\+?[0-9][0-9 ]{3,19}$/.test(value) ? value : safeText(value);
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ and not empty. */
export function sheetName(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base = safeText(name).replace(/[[\]:*?/\\']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  return candidate;
}

/**
 * Excel dates have no time zone. An instant is written as Algeria wall-clock
 * time: the returned Date's UTC fields are the time in Algiers, which is what
 * the spreadsheet library stores.
 */
export function wallClock(iso: string, timeZone = TZ): Date | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')));
}

/** A calendar day ("2026-11-14") as an Excel date. */
export function calendarDay(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/** Number format per column type. */
export const NUM_FMT: Record<ColumnType, string> = {
  text: '@',
  phone: '@',
  number: '0',
  money: '#,##0',
  datetime: 'yyyy-mm-dd hh:mm',
  date: 'yyyy-mm-dd',
};

/** The value written to a cell of the given type (null = empty cell). */
export function cellValue(value: Cell, type: ColumnType): string | number | Date | null {
  if (value === null || value === '') return null;
  switch (type) {
    case 'text':
      return safeText(String(value));
    case 'phone':
      return safePhone(String(value));
    case 'number':
    case 'money':
      return typeof value === 'number' && Number.isFinite(value) ? value : safeText(String(value));
    case 'datetime':
      return typeof value === 'string' ? wallClock(value) : null;
    case 'date':
      return typeof value === 'string' ? calendarDay(value) : null;
  }
}

/** ASCII file name: letters, digits and dashes only. */
export function fileName(...parts: string[]): string {
  const slug = parts
    .map((p) => p.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
  return `${slug || 'export'}.xlsx`;
}
