import { describe, expect, it } from 'vitest';
import { algiersTimestamp, mapMembers, normalizePhone, parseCsv } from '../../scripts/lib/members-csv.mjs';

const HEADER = 'Timestamp (Africa/Algiers),Full name,Phone,Wilaya code,Wilaya name,Age,Language,Consent,Source page,Duplicate';

describe('CSV parsing', () => {
  it('handles quotes, commas, newlines, CRLF and a BOM', () => {
    const BOM = String.fromCharCode(0xfeff);
    expect(parseCsv(`${BOM}a,b\r\n"x, y","say ""hi"""\n"multi\nline",z\n\n`)).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
    ]);
  });
});

describe('v1 sheet → members', () => {
  it('phones: local, international, with the apostrophe Sheets adds', () => {
    expect(normalizePhone('0551 23 45 67')).toBe('+213551234567');
    expect(normalizePhone("'+213661234567")).toBe('+213661234567');
    expect(normalizePhone('00213771234567')).toBe('+213771234567');
    expect(normalizePhone('0451234567')).toBeNull();
  });

  it('timestamps are Algeria time', () => {
    expect(algiersTimestamp('2026-03-14 18:05:00')).toBe('2026-03-14T17:05:00.000Z');
    expect(algiersTimestamp('14/03/2026')).toBeNull();
  });

  it('maps valid rows, keeps the first of repeated phones, counts the rest by reason', () => {
    const csv = [
      HEADER,
      '2026-01-02 10:00:00,Amina Benali,+213551234567,16,Alger,24,ar,YES,/join/,',
      '2026-01-05 11:00:00,Amina B.,+213551234567,16,Alger,25,ar,YES,/join/,YES',
      '2026-01-03 09:30:00,محمد الأمين,0661234567,5,Batna,31,ar,YES,/en/join/,',
      '2026-01-04 09:30:00,"=HYPERLINK(""x"")",0771234567,16,Alger,20,en,YES,/join/,',
      '2026-01-04 09:30:00,Bad Phone,12345,16,Alger,20,en,YES,/join/,',
      '2026-01-04 09:30:00,Old Wilaya,0551111111,70,?,20,en,YES,/join/,',
      '2026-01-04 09:30:00,Too Young,0552222222,16,Alger,8,en,YES,/join/,',
      '2026-01-04 09:30:00,No Consent,0553333333,16,Alger,20,en,,/join/,',
      'yesterday,No Date,0554444444,16,Alger,20,en,YES,/join/,',
    ].join('\n');
    const { members, skipped, rows } = mapMembers(parseCsv(csv));
    expect(rows).toBe(9);
    expect(members).toEqual([
      { full_name: 'Amina Benali', phone: '+213551234567', wilaya_code: '16', age: 24, consent_at: '2026-01-02T09:00:00.000Z', created_at: '2026-01-02T09:00:00.000Z', source: 'import' },
      { full_name: 'محمد الأمين', phone: '+213661234567', wilaya_code: '05', age: 31, consent_at: '2026-01-03T08:30:00.000Z', created_at: '2026-01-03T08:30:00.000Z', source: 'import' },
    ]);
    expect(skipped).toEqual({ phone: 1, name: 1, wilaya: 1, age: 1, consent: 1, date: 1, duplicate: 1 });
  });

  it('refuses a file that is not the members sheet', () => {
    expect(() => mapMembers(parseCsv('name,email\nA,b@c.d'))).toThrow(/not found/);
  });
});
