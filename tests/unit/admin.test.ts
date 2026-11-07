import { describe, expect, it } from 'vitest';
import { algiersLocalToIso, isoToAlgiersLocal, parseTripForm, slugify } from '../../src/lib/admin/trip-form';
import { adminLocale, adminPath, safeBack, withFlash } from '../../src/lib/admin/paths';
import { formatBytes, seatCounts, whatsappLink } from '../../src/lib/admin/data';

function form(entries: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of [v].flat()) f.append(k, x);
  return f;
}

const base = {
  title_ar: 'كامبينغ',
  title_en: 'Camping Tizeghben (Winter)',
  region: 'babors',
  terrain: ['camping', 'mountain'],
  difficulty: 'medium',
  status: 'draft',
};

describe('trip form', () => {
  it('slugifies the English title', () => {
    expect(slugify('Camping Tizeghben (Winter)')).toBe('camping-tizeghben-winter');
    expect(slugify('  Djanet & Tassili  ')).toBe('djanet-and-tassili');
    expect(slugify('Bejaïa — plongée')).toBe('bejaia-plongee');
    expect(slugify('قمة')).toBe('');
  });

  it('builds a row and generates the slug when empty', () => {
    const { values, errors } = parseTripForm(form(base));
    expect(errors).toEqual({});
    expect(values).toMatchObject({ slug: 'camping-tizeghben-winter', terrain: ['camping', 'mountain'], status: 'draft', hold_hours: 48 });
  });

  it('requires both titles, a region and a terrain', () => {
    const { errors } = parseTripForm(form({ status: 'draft' }));
    expect(Object.keys(errors).sort()).toEqual(['region', 'slug', 'terrain', 'title_ar', 'title_en']);
  });

  it('end date must not be before the start date', () => {
    const { errors } = parseTripForm(form({ ...base, start_date: '2026-12-10', end_date: '2026-12-09' }));
    expect(errors.end_date).toBe('dates_order');
  });

  it('opening a trip needs dates, level, price and capacity', () => {
    expect(parseTripForm(form({ ...base, status: 'open' })).errors.status).toBe('bookable_incomplete');
    const ok = parseTripForm(
      form({ ...base, status: 'open', start_date: '2026-12-10', end_date: '2026-12-11', price_da: '2500', capacity: '20' }),
    );
    expect(ok.errors).toEqual({});
  });

  it('rejects unknown regions/terrains and non-Instagram post URLs', () => {
    const { errors, values } = parseTripForm(
      form({ ...base, region: 'mars', terrain: ['lava', 'coast'], instagram_post_url: 'https://evil.example/p/1' }),
    );
    expect(errors.region).toBe('required');
    expect(values.terrain).toEqual(['coast']);
    expect(errors.instagram_post_url).toBe('invalid');
  });

  it('converts the registration deadline between Algeria time and UTC', () => {
    expect(algiersLocalToIso('2026-12-10T18:00')).toBe('2026-12-10T17:00:00.000Z');
    expect(isoToAlgiersLocal('2026-12-10T17:00:00.000Z')).toBe('2026-12-10T18:00');
    expect(algiersLocalToIso('tomorrow')).toBeNull();
    expect(parseTripForm(form({ ...base, registration_deadline: 'x' })).errors.registration_deadline).toBe('invalid');
  });
});

describe('admin paths', () => {
  it('builds localised admin paths', () => {
    expect(adminPath('ar', '/trips/')).toBe('/admin/trips/');
    expect(adminPath('en', '/trips/')).toBe('/en/admin/trips/');
    expect(adminLocale('/en/admin/')).toBe('en');
    expect(adminLocale('/admin/')).toBe('ar');
  });

  it('only redirects back into the admin (no open redirects)', () => {
    const fb = '/admin/';
    expect(safeBack('/admin/trips/123/reservations/?status=pending', fb)).toBe('/admin/trips/123/reservations/?status=pending');
    expect(safeBack('/en/admin/members/', fb)).toBe('/en/admin/members/');
    for (const bad of ['https://evil.example/admin/', '//evil.example/admin/', '/trips/', '/admin/../../x', 'javascript:alert(1)', 42, null]) {
      expect(safeBack(bad, fb), String(bad)).toBe(fb);
    }
  });

  it('sets a single flash parameter', () => {
    expect(withFlash('/admin/trips/?ok=old&status=open', 'error', 'over_capacity')).toBe('/admin/trips/?status=open&error=over_capacity');
  });
});

describe('admin data helpers', () => {
  it('counts seats like the database (expired holds free their seat)', () => {
    const now = Date.parse('2026-11-10T10:00:00Z');
    const rows = [
      { status: 'confirmed', hold_expires_at: null },
      { status: 'pending', hold_expires_at: '2026-11-10T12:00:00Z' },
      { status: 'pending', hold_expires_at: '2026-11-10T09:00:00Z' },
      { status: 'waitlist', hold_expires_at: null },
    ];
    expect(seatCounts({ capacity: 5 }, rows, now)).toEqual({ confirmed: 1, pending: 1, waitlist: 1, left: 3 });
  });

  it('WhatsApp links use the international number without +', () => {
    expect(whatsappLink('+213661234567')).toBe('https://wa.me/213661234567');
    expect(whatsappLink(null)).toBeNull();
  });

  it('formats storage sizes; Darja keeps the number and unit together', () => {
    expect(formatBytes(1.2 * 1024 ** 2, 'en')).toBe('1.2 MB');
    expect(formatBytes(1024 ** 3, 'en')).toBe('1 GB');
    expect(formatBytes(512 * 1024, 'en')).toBe('512 KB');
    expect(formatBytes(1024 ** 3, 'ar')).toMatch(/^\u2066.+ GB\u2069$/);
  });
});
