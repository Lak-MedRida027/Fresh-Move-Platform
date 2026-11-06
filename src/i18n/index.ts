import ar from './ar.json';
import en from './en.json';

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ar';

/** Every UI string key. Both JSON files must define all of them (see tests/unit/i18n.test.ts). */
export type TKey = keyof typeof en & keyof typeof ar;

const DICTS: Record<Locale, Record<TKey, string>> = { ar, en };

export const LOCALE_META: Record<
  Locale,
  { lang: string; dir: 'rtl' | 'ltr'; ogLocale: string; hreflang: string; name: string }
> = {
  ar: { lang: 'ar-DZ', dir: 'rtl', ogLocale: 'ar_DZ', hreflang: 'ar-DZ', name: 'الدارجة' },
  en: { lang: 'en', dir: 'ltr', ogLocale: 'en_US', hreflang: 'en', name: 'English' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Look up a UI string. `{name}` placeholders are replaced from `vars`. */
export function t(locale: Locale, key: TKey, vars?: Record<string, string | number>): string {
  const value = DICTS[locale][key];
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Bind `t` to one locale, for use inside components. */
export function useTranslations(locale: Locale) {
  return (key: TKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}

/** Locale from a pathname: `/en/...` is English, everything else is Darja. */
export function getLocaleFromPath(pathname: string): Locale {
  const first = pathname.split('/').filter(Boolean)[0];
  return isLocale(first) && first !== DEFAULT_LOCALE ? first : DEFAULT_LOCALE;
}

/** Remove the locale prefix: `/en/trips/` → `/trips/`. Always starts with `/`. */
export function stripLocale(pathname: string): string {
  const locale = getLocaleFromPath(pathname);
  if (locale === DEFAULT_LOCALE) return pathname.startsWith('/') ? pathname : `/${pathname}`;
  const rest = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), '');
  return rest === '' ? '/' : rest;
}

/** Build a path for a locale from an unprefixed path: (`/trips/`, `en`) → `/en/trips/`. */
export function localizePath(path: string, locale: Locale): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === '/' ? `/${locale}/` : `/${locale}${clean}`;
}

/** The same page in the other locale. */
export function switchLocalePath(pathname: string, target: Locale): string {
  return localizePath(stripLocale(pathname), target);
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'ar' ? 'en' : 'ar';
}
