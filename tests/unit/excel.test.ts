import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseMemberFilter, parseReservationFilter, type MemberRow, type ReservationWithPeople } from '../../src/lib/admin/data';
import { auditFilter, membersExport, reservationsExport } from '../../src/lib/excel/exports';
import { calendarDay, cellValue, fileName, safePhone, safeText, sheetName, wallClock } from '../../src/lib/excel/spec';
import { buildWorkbook } from '../../src/lib/excel/workbook';

const NOW = new Date('2026-11-07T10:30:00Z'); // 11:30 in Algiers

function res(over: Partial<ReservationWithPeople> & { name?: string | null; phone?: string }): ReservationWithPeople {
  const { name = 'Amina B.', phone = '+213551234567', ...rest } = over;
  return {
    id: crypto.randomUUID(),
    code: 'FM-ABCDE',
    trip_id: 't1',
    member_id: name === null ? null : 'm1',
    status: 'confirmed',
    hold_expires_at: null,
    waitlisted_at: null,
    payment_method: null,
    amount_paid_da: null,
    admin_note: null,
    source: 'web',
    created_at: '2026-11-01T08:00:00Z',
    confirmed_at: null,
    confirmed_by: null,
    cancelled_at: null,
    cancel_reason: null,
    hold_extended_at: null,
    anonymised_at: null,
    member: name === null ? null : { id: 'm1', full_name: name, phone, wilaya_code: '16', age: 24 },
    trip: { id: 't1', slug: 'chelia', title_ar: 'شليا', title_en: 'Chélia' },
    ...rest,
  };
}

async function readBack(buf: ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

const values = (ws: ExcelJS.Worksheet, row: number) => (ws.getRow(row).values as unknown[]).slice(1);

describe('cell safety', () => {
  it('neutralises anything that could become a formula', () => {
    for (const s of ['=1+1', '+213 is not a phone here', '-2', '@SUM(A1)', '\tx', '\rx', '＝1+1', '=HYPERLINK("http://evil","x")']) {
      expect(safeText(s), s).toBe(`'${s}`);
    }
    expect(safeText('Amina')).toBe('Amina');
    expect(safeText('أمينة = 2')).toBe('أمينة = 2');
  });

  it('removes characters that break the file', () => {
    expect(safeText('a\u0000b\u0007c\u001Fd')).toBe('abcd');
    expect(safeText('line 1\nline 2\ttab')).toBe('line 1\nline 2\ttab');
    expect(safeText('\u0000=1')).toBe("'=1");
  });

  it('keeps phones as written, guards anything else in a phone column', () => {
    expect(safePhone('+213551234567')).toBe('+213551234567');
    expect(safePhone('0551 23 45 67')).toBe('0551 23 45 67');
    expect(safePhone('+1+1')).toBe("'+1+1");
    expect(safePhone('=cmd')).toBe("'=cmd");
  });

  it('typed values', () => {
    expect(cellValue(null, 'text')).toBeNull();
    expect(cellValue('', 'datetime')).toBeNull();
    expect(cellValue(12, 'number')).toBe(12);
    expect(cellValue('=1', 'number')).toBe("'=1");
    expect(cellValue('2026-11-14', 'date')).toEqual(new Date(Date.UTC(2026, 10, 14)));
    expect(cellValue('nope', 'datetime')).toBeNull();
  });
});

describe('dates are written in Algeria time', () => {
  it('instant → Algiers wall clock (UTC+1, no DST)', () => {
    expect(wallClock('2026-11-14T17:00:00Z')).toEqual(new Date(Date.UTC(2026, 10, 14, 18, 0)));
    expect(wallClock('2026-07-01T23:30:00Z')).toEqual(new Date(Date.UTC(2026, 6, 2, 0, 30)));
    expect(wallClock('garbage')).toBeNull();
  });
  it('calendar days stay the same day', () => {
    expect(calendarDay('2026-12-31')).toEqual(new Date(Date.UTC(2026, 11, 31)));
    expect(calendarDay('31/12/2026')).toBeNull();
  });
});

describe('names', () => {
  it('sheet names follow Excel rules', () => {
    expect(sheetName('a/b:c*d?[e]')).toBe('a b c d e');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(sheetName('')).toBe('Sheet');
    expect(sheetName('الحجوزات')).toBe('الحجوزات');
    expect(sheetName('Members', new Set(['members']))).toBe('Members 2');
  });
  it('file names are ASCII', () => {
    expect(fileName('fresh-move-reservations', 'chelia', '2026-11-07')).toBe('fresh-move-reservations-chelia-2026-11-07.xlsx');
    expect(fileName('شليا')).toBe('export.xlsx');
    expect(fileName('a b', '../x')).toBe('a-b-x.xlsx');
  });
});

describe('filters (shared by the pages and the export)', () => {
  it('reservations', () => {
    expect(parseReservationFilter(new URLSearchParams('status=confirmed&q=ali&page=2'))).toEqual({ status: 'confirmed', q: 'ali', page: 2 });
    expect(parseReservationFilter(new URLSearchParams('status=hacked&page=-4'))).toEqual({ status: '', q: '', page: 1 });
    expect(parseReservationFilter(new URLSearchParams(`q=${'x'.repeat(100)}`)).q).toHaveLength(60);
  });
  it('members', () => {
    expect(parseMemberFilter(new URLSearchParams('q=ali&wilaya=16&age_min=18&age_max=30'))).toEqual({ q: 'ali', wilaya: '16', ageMin: 18, ageMax: 30, page: 1 });
    expect(parseMemberFilter(new URLSearchParams('wilaya=1;drop&age_min=abc&age_max=1.5'))).toMatchObject({ wilaya: '', ageMin: null, ageMax: null });
  });
  it('audit filter keeps only what was used', () => {
    expect(auditFilter({ status: '', q: 'ali', age_min: null, wilaya: '16' })).toEqual({ q: 'ali', wilaya: '16' });
    expect(auditFilter({ q: 'x'.repeat(300) }).q).toHaveLength(100);
  });
});

describe('per-trip reservations export (Darja), parsed back', () => {
  const rows = [
    res({ code: 'FM-WAIT2', status: 'waitlist', waitlisted_at: '2026-11-03T09:00:00Z', name: 'Late Person', phone: '+213661111111' }),
    res({ code: 'FM-HELD3', status: 'pending', hold_expires_at: '2026-11-08T17:00:00Z', name: 'محمد الأمين', phone: '+213772222222' }),
    res({
      code: 'FM-CONF4',
      status: 'confirmed',
      confirmed_at: '2026-11-02T12:15:00Z',
      payment_method: 'baridimob',
      amount_paid_da: 4500,
      name: '=HYPERLINK("http://evil.example","click")',
      admin_note: '@SUM(1)\u0000 note',
      source: 'admin',
    }),
    res({ code: 'FM-ANON5', status: 'cancelled', cancelled_at: '2026-11-04T10:00:00Z', cancel_reason: '-bad', name: null }),
    res({ code: 'FM-WAIT1', status: 'waitlist', waitlisted_at: '2026-11-02T09:00:00Z', name: 'Early Person' }),
  ];
  const spec = reservationsExport({
    locale: 'ar',
    rows,
    filter: { status: '', q: '' },
    trip: {
      row: { slug: 'chelia', title_ar: 'شليا', title_en: 'Chélia', start_date: '2026-11-14', end_date: '2026-11-15', price_da: 4500, capacity: 30 },
      counts: { confirmed: 1, pending: 1, waitlist: 2, left: 28, cancelled: 1, expired: 0 },
    },
    now: NOW,
  });

  it('describes the file', () => {
    expect(spec.filename).toBe('fresh-move-reservations-chelia-2026-11-07.xlsx');
    expect(spec.rtl).toBe(true);
    expect(spec.sheets.map((s) => s.name)).toEqual(['ملخص', 'الحجوزات']);
  });

  it('builds a valid workbook that reads back the same', async () => {
    const wb = await readBack(await buildWorkbook(spec));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['ملخص', 'الحجوزات']);
    expect(wb.creator).toBe('Fresh Move');

    const sum = wb.getWorksheet('ملخص')!;
    expect(values(sum, 2)).toEqual(['الخرجة', 'شليا']);
    expect(values(sum, 3)).toEqual(['تاريخ البداية', new Date(Date.UTC(2026, 10, 14))]);
    expect(sum.getRow(5).getCell(2).value).toBe(4500);
    expect(sum.getRow(5).getCell(2).numFmt).toBe('#,##0');
    const labels = sum.getColumn(1).values.slice(2) as string[];
    expect(labels).toContain('عدد السطور في الملف');
    expect(sum.getRow(labels.indexOf('عدد السطور في الملف') + 2).getCell(2).value).toBe(5);
    expect(sum.getRow(labels.indexOf('تاريخ التصدير') + 2).getCell(2).value).toEqual(new Date(Date.UTC(2026, 10, 7, 11, 30)));
    expect(sum.getRow(labels.indexOf('البحث المستعمل') + 2).getCell(2).value).toBe('والو (كلش)');

    const ws = wb.getWorksheet('الحجوزات')!;
    expect(ws.views[0]).toMatchObject({ rightToLeft: true, state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.getRow(1).font?.bold).toBe(true);
    const header = values(ws, 1) as string[];
    expect(header.slice(0, 5)).toEqual(['الكود', 'الحالة', 'الاسم', 'التيليفون', 'الولاية']);
    expect(header).not.toContain('الخرجة'); // one trip: no trip column
    expect(ws.rowCount).toBe(1 + rows.length);

    // Bus order: confirmed, held, waitlist in order, then cancelled.
    const codes = [2, 3, 4, 5, 6].map((r) => ws.getRow(r).getCell(1).value);
    expect(codes).toEqual(['FM-CONF4', 'FM-HELD3', 'FM-WAIT1', 'FM-WAIT2', 'FM-ANON5']);

    const col = (name: string) => header.indexOf(name) + 1;
    const confirmed = ws.getRow(2);
    // Formula injection neutralised: a text cell starting with ', never a formula.
    expect(confirmed.getCell(col('الاسم')).value).toBe(`'=HYPERLINK("http://evil.example","click")`);
    expect(confirmed.getCell(col('الاسم')).type).toBe(ExcelJS.ValueType.String);
    expect(confirmed.getCell(col('ملاحظة')).value).toBe("'@SUM(1) note");
    expect(confirmed.getCell(col('طريقة الخلاص')).value).toBe('BaridiMob');
    expect(confirmed.getCell(col('المبلغ (دج)')).value).toBe(4500);
    expect(confirmed.getCell(col('تحجز من')).value).toBe('مسؤول (DM)');
    expect(confirmed.getCell(col('تاريخ التأكيد')).value).toEqual(new Date(Date.UTC(2026, 10, 2, 13, 15)));

    // Phones are text, with their +.
    const phone = confirmed.getCell(col('التيليفون'));
    expect(phone.value).toBe('+213551234567');
    expect(phone.type).toBe(ExcelJS.ValueType.String);
    expect(phone.numFmt).toBe('@');

    // Arabic intact; wilaya with its number.
    const held = ws.getRow(3);
    expect(held.getCell(col('الاسم')).value).toBe('محمد الأمين');
    expect(held.getCell(col('الحالة')).value).toBe('محجوز (ما خلّصش)');
    expect(String(held.getCell(col('الولاية')).value)).toMatch(/^16 - /);
    expect(held.getCell(col('محجوز حتى')).value).toEqual(new Date(Date.UTC(2026, 10, 8, 18, 0)));

    // Anonymised booking.
    const anon = ws.getRow(6);
    expect(anon.getCell(col('الاسم')).value).toBe('(معلومات ممسوحة)');
    expect(anon.getCell(col('التيليفون')).value).toBeNull();
    expect(anon.getCell(col('سبب الإلغاء')).value).toBe("'-bad");

    // No formulas anywhere in the file.
    for (const sheet of wb.worksheets) sheet.eachRow((r) => r.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)));
  });
});

describe('global reservations export (English)', () => {
  it('has a trip column and the filters', async () => {
    const spec = reservationsExport({ locale: 'en', rows: [res({}), res({ code: 'FM-ZZZZZ', trip: null })], filter: { status: 'confirmed', q: 'ami' }, now: NOW });
    expect(spec.filename).toBe('fresh-move-reservations-2026-11-07.xlsx');
    expect(spec.rtl).toBe(false);
    const wb = await readBack(await buildWorkbook(spec));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Reservations']);
    const ws = wb.worksheets[0]!;
    expect(ws.views[0]).toMatchObject({ rightToLeft: false });
    expect(values(ws, 1).slice(0, 3)).toEqual(['Code', 'Trip', 'Status']);
    expect(values(ws, 2).slice(0, 3)).toEqual(['FM-ABCDE', 'Chélia', 'Confirmed']);
    expect(ws.getRow(3).getCell(2).value).toBeNull();
  });
});

describe('members export, parsed back', () => {
  const members: MemberRow[] = [
    { id: 'a', full_name: 'Yacine K.', phone: '+213551000001', wilaya_code: '05', age: 31, source: 'join_form', consent_at: '2026-10-01T09:00:00Z', notes: null, created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T09:00:00Z' },
    { id: 'b', full_name: 'سارة', phone: '+213661000002', wilaya_code: '99', age: 19, source: 'import', consent_at: null, notes: '+ bring tent', created_at: '2026-09-01T09:00:00Z', updated_at: '2026-09-01T09:00:00Z' },
  ];

  it('one sheet, every member, phones as text', async () => {
    for (const locale of ['ar', 'en'] as const) {
      const spec = membersExport({ locale, rows: members, now: NOW });
      expect(spec.filename).toBe('fresh-move-members-2026-11-07.xlsx');
      const wb = await readBack(await buildWorkbook(spec));
      expect(wb.worksheets).toHaveLength(1);
      const ws = wb.worksheets[0]!;
      expect(ws.name).toBe(locale === 'ar' ? 'الأعضاء' : 'Members');
      expect(ws.rowCount).toBe(3);
      expect(ws.getRow(2).getCell(2).value).toBe('+213551000001');
      expect(ws.getRow(2).getCell(2).type).toBe(ExcelJS.ValueType.String);
      expect(ws.getRow(3).getCell(1).value).toBe('سارة');
      expect(ws.getRow(3).getCell(3).value).toBe('99'); // unknown wilaya: kept as is
      expect(ws.getRow(3).getCell(7).value).toBeNull(); // no consent date
      expect(ws.getRow(3).getCell(8).value).toBe("'+ bring tent");
      expect(ws.getRow(2).getCell(6).value).toEqual(new Date(Date.UTC(2026, 9, 1, 10, 0)));
    }
  });

  it('large exports stay fast enough for a phone', async () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({ ...members[0]!, id: String(i), full_name: `Member ${i}`, phone: `+2135510${String(i).padStart(5, '0')}` }));
    const t0 = performance.now();
    const wb = await readBack(await buildWorkbook(membersExport({ locale: 'en', rows: many, now: NOW })));
    expect(wb.worksheets[0]!.rowCount).toBe(3001);
    expect(performance.now() - t0).toBeLessThan(15_000);
  });
});
