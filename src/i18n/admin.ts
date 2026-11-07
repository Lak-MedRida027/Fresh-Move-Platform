/** Admin UI strings (separate from the public site's). Same keys in both files (tested). */
import ar from './admin.ar.json';
import en from './admin.en.json';
import type { Locale } from './index';

export type AdminKey = keyof typeof en & keyof typeof ar;
const DICTS: Record<Locale, Record<AdminKey, string>> = { ar, en };

export function adminT(locale: Locale) {
  return (key: AdminKey, vars?: Record<string, string | number>) => {
    const value = DICTS[locale][key] ?? key;
    return vars ? value.replace(/\{(\w+)\}/g, (m, n: string) => (n in vars ? String(vars[n]) : m)) : value;
  };
}

export function hasAdminKey(key: string): key is AdminKey {
  return key in en;
}
