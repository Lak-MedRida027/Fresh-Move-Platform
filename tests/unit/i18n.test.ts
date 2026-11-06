import { describe, expect, it } from 'vitest';
import ar from '../../src/i18n/ar.json';
import en from '../../src/i18n/en.json';
import {
  getLocaleFromPath,
  localizePath,
  stripLocale,
  switchLocalePath,
  t,
} from '../../src/i18n';

describe('i18n dictionaries', () => {
  it('ar.json and en.json have exactly the same keys', () => {
    const arKeys = Object.keys(ar).sort();
    const enKeys = Object.keys(en).sort();
    const missingInEn = arKeys.filter((k) => !enKeys.includes(k));
    const missingInAr = enKeys.filter((k) => !arKeys.includes(k));
    expect({ missingInEn, missingInAr }).toEqual({ missingInEn: [], missingInAr: [] });
  });

  it('has no empty strings', () => {
    for (const [locale, dict] of Object.entries({ ar, en })) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('uses the same {placeholders} in both languages', () => {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(ar[key]), key).toEqual(vars(en[key]));
    }
  });

  it('t() replaces placeholders', () => {
    expect(t('en', 'nav.trips')).toBe('Trips');
  });
});

describe('locale paths', () => {
  it('detects the locale from a path', () => {
    expect(getLocaleFromPath('/')).toBe('ar');
    expect(getLocaleFromPath('/trips/chelia/')).toBe('ar');
    expect(getLocaleFromPath('/en/')).toBe('en');
    expect(getLocaleFromPath('/en')).toBe('en');
    expect(getLocaleFromPath('/en/trips/')).toBe('en');
    expect(getLocaleFromPath('/english/')).toBe('ar');
  });

  it('strips and adds the locale prefix', () => {
    expect(stripLocale('/en/trips/')).toBe('/trips/');
    expect(stripLocale('/en/')).toBe('/');
    expect(stripLocale('/en')).toBe('/');
    expect(stripLocale('/trips/')).toBe('/trips/');
    expect(localizePath('/', 'en')).toBe('/en/');
    expect(localizePath('/trips/x/', 'en')).toBe('/en/trips/x/');
    expect(localizePath('/trips/x/', 'ar')).toBe('/trips/x/');
  });

  it('switches to the same page in the other language', () => {
    expect(switchLocalePath('/', 'en')).toBe('/en/');
    expect(switchLocalePath('/en/', 'ar')).toBe('/');
    expect(switchLocalePath('/trips/djanet-tassili/', 'en')).toBe('/en/trips/djanet-tassili/');
    expect(switchLocalePath('/en/join/', 'ar')).toBe('/join/');
  });
});
