import { describe, expect, it } from 'vitest';
import { fitLongSide, imagePaths, SIZES, UUID_RE, validDimensions, validPlaceholder } from '../../src/lib/images/sizes';

describe('image sizes', () => {
  it('fits the long side and never upscales', () => {
    expect(fitLongSide(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitLongSide(3000, 4000, 960)).toEqual({ width: 720, height: 960 });
    expect(fitLongSide(2400, 1600, 480)).toEqual({ width: 480, height: 320 });
    expect(fitLongSide(800, 1200, 1600)).toEqual({ width: 800, height: 1200 });
    expect(fitLongSide(5000, 10, 16)).toEqual({ width: 16, height: 1 });
  });

  it('stores three sizes at predictable paths', () => {
    expect(SIZES).toEqual(['sm', 'md', 'lg']);
    expect(imagePaths('t-1', 'i-1')).toEqual({
      sm: 'trips/t-1/i-1-sm.webp',
      md: 'trips/t-1/i-1-md.webp',
      lg: 'trips/t-1/i-1-lg.webp',
    });
  });

  it('accepts only sane dimensions from the browser', () => {
    expect(validDimensions(1600, 1067)).toBe(true);
    expect(validDimensions(800, 1200)).toBe(true);
    expect(validDimensions(320, 100)).toBe(true);
    for (const [w, h] of [
      [1601, 900],
      [300, 200],
      [0, 500],
      [1600.5, 900],
      ['1600', 900],
      [null, 1],
    ]) {
      expect(validDimensions(w, h), `${w}x${h}`).toBe(false);
    }
  });

  it('placeholder must be a small base64 WebP data URL', () => {
    expect(validPlaceholder('data:image/webp;base64,UklGRiQAAABXRUJQ')).toBe(true);
    expect(validPlaceholder('data:image/png;base64,AAAA')).toBe(false);
    expect(validPlaceholder('data:image/webp;base64,AA"><script>')).toBe(false);
    expect(validPlaceholder(`data:image/webp;base64,${'A'.repeat(5000)}`)).toBe(false);
    expect(validPlaceholder(42)).toBe(false);
  });

  it('UUIDs only (ids go into storage paths)', () => {
    expect(UUID_RE.test('0b7f3c52-6a8e-4c1e-9d2a-3f4b5c6d7e8f')).toBe(true);
    expect(UUID_RE.test('../../etc')).toBe(false);
    expect(UUID_RE.test('0B7F3C52-6A8E-4C1E-9D2A-3F4B5C6D7E8F')).toBe(false);
  });
});
