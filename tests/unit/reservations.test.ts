import { describe, expect, it } from 'vitest';
import { formatDateRange, formatDateTime, formatTime, timeLeft, todayInAlgeria } from '../../src/lib/dates';
import { CODE_ALPHABET, isValidCode, normalizeCode } from '../../src/lib/reservation-code';

describe('reservation codes', () => {
  it('alphabet has no look-alike characters', () => {
    for (const c of '01OI') expect(CODE_ALPHABET).not.toContain(c);
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
    expect(CODE_ALPHABET).toHaveLength(32);
  });

  it.each([
    ['FM-7K3QX', 'FM-7K3QX'],
    ['fm-7k3qx', 'FM-7K3QX'],
    [' fm 7k3qx ', 'FM-7K3QX'],
    ['FM7K3QX', 'FM-7K3QX'],
    ['7K3QX', 'FM-7K3QX'],
    ['fm_7k3.qx', 'FM-7K3QX'],
  ])('normalises %j', (input, out) => expect(normalizeCode(input)).toBe(out));

  it.each(['FM-7K3Q', 'FM-7K3QXX', 'FM-0K3QX', 'FM-OK3QX', 'FM-1K3QX', 'FM-IK3QX', 'XX-7K3QX', '', 'FM-7K3Q!'])(
    'rejects %j',
    (input) => expect(normalizeCode(input)).toBeNull(),
  );

  it('validates the canonical format only', () => {
    expect(isValidCode('FM-ABCDE')).toBe(true);
    expect(isValidCode('fm-abcde')).toBe(false);
  });
});

describe('Algeria time formatting', () => {
  it('shows hold deadlines in Africa/Algiers (UTC+1, no DST)', () => {
    // 17:00 UTC = 18:00 in Algiers, in winter and in summer.
    expect(formatDateTime('2026-11-14T17:00:00Z', 'en')).toContain('18:00');
    expect(formatDateTime('2026-07-14T17:00:00Z', 'en')).toContain('18:00');
    expect(formatDateTime('2026-11-14T17:00:00Z', 'en')).toMatch(/Sat/);
    expect(formatDateTime('2026-11-14T17:00:00Z', 'ar')).toContain('18:00');
  });

  it('crosses midnight correctly', () => {
    // 23:30 UTC on the 14th is 00:30 on the 15th in Algiers.
    expect(formatDateTime('2026-11-14T23:30:00Z', 'en')).toMatch(/15 Nov/);
  });

  it('formats single days and ranges', () => {
    expect(formatDateRange('2026-11-14', null, 'en')).toBe('14 November 2026');
    expect(formatDateRange('2026-11-14', '2026-11-14', 'en')).toBe('14 November 2026');
    expect(formatDateRange('2026-11-14', '2026-11-16', 'en')).toMatch(/^14\s*[–-]\s*16 November 2026$/);
    expect(formatDateRange('2026-11-30', '2026-12-02', 'en')).toMatch(/30 November\s*[–-]\s*2 December 2026/);
    expect(formatDateRange('2026-11-14', '2026-11-16', 'ar')).toContain('2026');
  });

  it("today's date is Algeria's, not UTC's", () => {
    expect(todayInAlgeria(new Date('2026-11-14T23:30:00Z'))).toBe('2026-11-15');
    expect(todayInAlgeria(new Date('2026-11-14T22:30:00Z'))).toBe('2026-11-14');
  });

  it('time left until a deadline', () => {
    const now = Date.parse('2026-11-14T10:00:00Z');
    expect(timeLeft('2026-11-16T13:30:00Z', now)).toEqual({ days: 2, hours: 3, minutes: 30, past: false });
    expect(timeLeft('2026-11-14T09:00:00Z', now).past).toBe(true);
  });

  it('meeting time drops seconds', () => {
    expect(formatTime('06:30:00')).toBe('06:30');
    expect(formatTime(null)).toBeNull();
  });
});
