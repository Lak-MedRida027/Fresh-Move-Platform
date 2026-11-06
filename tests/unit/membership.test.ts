import { describe, expect, it } from 'vitest';
import { MAX_AGE, MIN_AGE } from '../../src/config/site';
import { WILAYAS } from '../../src/data/wilayas';
import {
  cleanName,
  normalizePhone,
  sanitizeCell,
  validateAge,
  validateConsent,
  validateMembership,
  validateName,
  validatePhone,
  validateWilaya,
} from '../../src/lib/membership';

describe('phone validation and normalisation', () => {
  it.each([
    ['0551234567', '+213551234567'],
    ['0661234567', '+213661234567'],
    ['0771234567', '+213771234567'],
    ['+213551234567', '+213551234567'],
    ['+213 661 23 45 67', '+213661234567'],
    ['00213771234567', '+213771234567'],
    ['0661 23 45 67', '+213661234567'],
    ['066-123-45-67', '+213661234567'],
    ['(0661) 23.45.67', '+213661234567'],
    ['  0551234567  ', '+213551234567'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
    expect(validatePhone(input)).toBeNull();
  });

  it.each([
    ['0151234567', 'prefix 01'],
    ['0851234567', 'prefix 08'],
    ['0251234567', 'landline 02'],
    ['055123456', 'too short (9 digits)'],
    ['05512345678', 'too long (11 digits)'],
    ['+21305512345', 'too short after +213'],
    ['+2130551234567', 'extra 0 after +213'],
    ['+213851234567', '+213 with 8'],
    ['002135512345678', 'too long after 00213'],
    ['+33612345678', 'other country'],
    ['05512345a7', 'letters'],
    ['=0551234567', 'formula prefix'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizePhone(input)).toBeNull();
    expect(validatePhone(input)).toBe('phone.invalid');
  });

  it('empty phone is "required"', () => {
    expect(validatePhone('   ')).toBe('required');
  });
});

describe('name validation', () => {
  it.each(['Amine', 'Lina Benali', 'محمد', 'سارة بن علي', "O'Neil", 'Ben-Ali', 'Aït Ahmed', 'Zé', 'عبد الرحمٰن'])(
    'accepts %s',
    (name) => expect(validateName(name)).toBeNull(),
  );

  it('enforces 2–60 characters after trimming', () => {
    expect(validateName('A')).toBe('name.length');
    expect(validateName('  ')).toBe('required');
    expect(validateName('A'.repeat(60))).toBeNull();
    expect(validateName('A'.repeat(61))).toBe('name.length');
  });

  it.each(['Amine2', 'محمد٣', '=cmd', '-Amine', '@home', 'John_Doe', 'Ali!', 'Анна', '张伟', "'Amine"])(
    'rejects %s',
    (name) => expect(validateName(name)).toBe('name.invalid'),
  );

  it('collapses inner whitespace', () => {
    expect(cleanName('  Lina    Benali ')).toBe('Lina Benali');
  });
});

describe('age validation', () => {
  it('uses the MIN_AGE boundary from config', () => {
    expect(validateAge(MIN_AGE - 1)).toBe('age.min');
    expect(validateAge(MIN_AGE)).toBeNull();
    expect(validateAge(String(MIN_AGE))).toBeNull();
  });

  it(`caps at ${MAX_AGE}`, () => {
    expect(validateAge(MAX_AGE)).toBeNull();
    expect(validateAge(MAX_AGE + 1)).toBe('age.max');
  });

  it.each(['', ' '])('empty "%s" is required', (v) => expect(validateAge(v)).toBe('required'));
  it.each(['18.5', 'abc', '-20', '1e2', '2 0'])('rejects non-integer %s', (v) => expect(validateAge(v)).toBe('age.invalid'));
});

describe('wilaya validation', () => {
  it('has the 69 current wilayas, codes 01–69 in order, unique', () => {
    expect(WILAYAS).toHaveLength(69);
    WILAYAS.forEach((w, i) => expect(w.code).toBe(String(i + 1).padStart(2, '0')));
    expect(new Set(WILAYAS.map((w) => w.ar)).size).toBe(69);
    expect(new Set(WILAYAS.map((w) => w.fr)).size).toBe(69);
  });

  it.each(['01', '16', '58', '69'])('accepts %s', (code) => expect(validateWilaya(code)).toBeNull());
  it.each(['00', '70', '1', '016', 'AB', '99'])('rejects %s', (code) => expect(validateWilaya(code)).toBe('wilaya.invalid'));
  it('empty is required', () => expect(validateWilaya('')).toBe('required'));
});

describe('consent and whole form', () => {
  it('consent must be true', () => {
    expect(validateConsent(true)).toBeNull();
    expect(validateConsent(false)).toBe('consent.required');
  });

  it('reports every bad field at once', () => {
    expect(validateMembership({ fullName: '', phone: '0123', wilaya: '', age: '12', consent: false })).toEqual({
      fullName: 'required',
      phone: 'phone.invalid',
      wilaya: 'required',
      age: 'age.min',
      consent: 'consent.required',
    });
  });

  it('accepts a valid member', () => {
    expect(
      validateMembership({ fullName: 'سارة', phone: '0661234567', wilaya: '05', age: 24, consent: true }),
    ).toEqual({});
  });
});

describe('spreadsheet formula-injection sanitiser', () => {
  it.each([
    ['=HYPERLINK("http://evil")', `'=HYPERLINK("http://evil")`],
    ['+SUM(A1:A9)', "'+SUM(A1:A9)"],
    ['-2+3', "'-2+3"],
    ['@SUM(1)', "'@SUM(1)"],
    ['\t=1', "'\t=1"],
    ['\r=1', "'\r=1"],
  ])('escapes %j', (input, expected) => expect(sanitizeCell(input)).toBe(expected));

  it.each(['Amine', 'سارة', '/en/join/', 'Batna / باتنة', 'a=b', '1+1'])('leaves %j alone', (input) =>
    expect(sanitizeCell(input)).toBe(input),
  );
});
