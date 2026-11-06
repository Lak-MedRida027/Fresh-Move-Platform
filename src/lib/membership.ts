/**
 * Membership form rules, shared by the browser (src/scripts/join-form.ts) and
 * the server endpoint (src/pages/api/join.ts). Framework-free on purpose so
 * the client bundle stays tiny; the server wraps these in a zod schema.
 */
import { MAX_AGE, MIN_AGE } from '../config/site';
import { getWilaya } from '../data/wilayas';

export type Field = 'fullName' | 'phone' | 'wilaya' | 'age' | 'consent';
export const FIELDS: readonly Field[] = ['fullName', 'phone', 'wilaya', 'age', 'consent'];

export type ErrorCode =
  | 'required'
  | 'name.length'
  | 'name.invalid'
  | 'phone.invalid'
  | 'wilaya.invalid'
  | 'age.invalid'
  | 'age.min'
  | 'age.max'
  | 'consent.required';

export type FieldErrors = Partial<Record<Field, ErrorCode>>;

/** Collapse runs of whitespace and trim. */
export function cleanName(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// Arabic or Latin letters (plus combining marks), spaces, hyphen, apostrophes.
// Must start and end with a letter, so it can never start with = + - @.
const NAME_RE = /^[\p{Script=Arabic}\p{Script=Latin}](?:[\p{Script=Arabic}\p{Script=Latin}\p{M} '’-]*[\p{Script=Arabic}\p{Script=Latin}\p{M}])?$/u;
const NOT_ALLOWED_IN_NAME = /[\p{Nd}٠-٩۰-۹]/u; // digits in any script

export function validateName(raw: string): ErrorCode | null {
  const name = cleanName(raw);
  if (!name) return 'required';
  const length = [...name].length;
  if (length < 2 || length > 60) return 'name.length';
  if (NOT_ALLOWED_IN_NAME.test(name) || !NAME_RE.test(name)) return 'name.invalid';
  return null;
}

/**
 * Algerian mobile numbers: 05/06/07 + 8 digits, or +213 / 00213 + 5/6/7 + 8 digits.
 * Spaces, dashes, dots and parentheses are ignored. Returns `+2135XXXXXXXX` or null.
 */
export function normalizePhone(raw: string): string | null {
  // \s already covers no-break spaces.
  const compact = raw.replace(/[\s\-.()]/g, '');
  const local = compact.match(/^0([567]\d{8})$/);
  if (local) return `+213${local[1]}`;
  const intl = compact.match(/^(?:\+|00)213([567]\d{8})$/);
  if (intl) return `+213${intl[1]}`;
  return null;
}

export function validatePhone(raw: string): ErrorCode | null {
  if (!raw.trim()) return 'required';
  return normalizePhone(raw) ? null : 'phone.invalid';
}

export function validateWilaya(code: string): ErrorCode | null {
  if (!code) return 'required';
  return /^\d{2}$/.test(code) && getWilaya(code) ? null : 'wilaya.invalid';
}

export function validateAge(raw: string | number): ErrorCode | null {
  const text = String(raw).trim();
  if (!text) return 'required';
  if (!/^\d{1,3}$/.test(text)) return 'age.invalid';
  const age = Number(text);
  if (age < MIN_AGE) return 'age.min';
  if (age > MAX_AGE) return 'age.max';
  return null;
}

export function validateConsent(value: boolean): ErrorCode | null {
  return value === true ? null : 'consent.required';
}

export interface MembershipInput {
  fullName: string;
  phone: string;
  wilaya: string;
  age: string | number;
  consent: boolean;
}

export function validateMembership(input: MembershipInput): FieldErrors {
  const errors: FieldErrors = {};
  const checks: [Field, ErrorCode | null][] = [
    ['fullName', validateName(input.fullName)],
    ['phone', validatePhone(input.phone)],
    ['wilaya', validateWilaya(input.wilaya)],
    ['age', validateAge(input.age)],
    ['consent', validateConsent(input.consent)],
  ];
  for (const [field, code] of checks) if (code) errors[field] = code;
  return errors;
}

/**
 * Spreadsheet formula-injection guard. A cell starting with = + - @ (or tab /
 * carriage return) can be run as a formula by Sheets/Excel; prefixing an
 * apostrophe makes it plain text (the apostrophe is not displayed).
 */
export function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
