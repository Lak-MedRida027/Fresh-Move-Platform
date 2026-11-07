/** Validation messages and field labels for MemberFields-based forms. */
import { MAX_AGE, MIN_AGE } from '../config/site';
import { t, type Locale, type TKey } from '../i18n';
import type { ErrorCode } from './membership';

const CODES: ErrorCode[] = [
  'required',
  'name.length',
  'name.invalid',
  'phone.invalid',
  'wilaya.invalid',
  'age.invalid',
  'age.min',
  'age.max',
  'consent.required',
];

export function fieldMessages(locale: Locale): string {
  return JSON.stringify(
    Object.fromEntries(CODES.map((c) => [c, t(locale, `form.error.${c}` as TKey, { minAge: MIN_AGE, maxAge: MAX_AGE })])),
  );
}

export function fieldLabels(locale: Locale, consentLabel: string): string {
  return JSON.stringify({
    fullName: t(locale, 'form.name.label'),
    phone: t(locale, 'form.phone.label'),
    wilaya: t(locale, 'form.wilaya.label'),
    age: t(locale, 'form.age.label'),
    consent: consentLabel,
  });
}
