// Runs apps-script/Code.gs in a sandbox with fake Google services, so the
// secret check, validation, lock, duplicate flag and formula escaping are tested.
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const SOURCE = readFileSync('apps-script/Code.gs', 'utf8');
const SECRET = 'a-very-long-shared-secret-for-tests-123456';

interface Fake {
  rows: unknown[][];
  locks: number;
  formats: string[];
  run: (body: unknown) => { ok: boolean; error?: string };
}

function load(secret: string | null = SECRET): Fake {
  const rows: unknown[][] = [];
  const state = { locks: 0, formats: [] as string[] };
  const sheet = {
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    appendRow: (r: unknown[]) => rows.push(r),
    setFrozenRows: () => {},
    getRange: (row: number, col: number, numRows: number) => ({
      setFontWeight: () => {},
      setNumberFormat: (f: string) => state.formats.push(`${col}:${f}`),
      getDisplayValues: () => rows.slice(row - 1, row - 1 + numRows).map((r) => [String(r[col - 1])]),
    }),
  };
  const ctx = createContext({
    console: { log: () => {}, error: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => secret }) },
    LockService: {
      getScriptLock: () => ({ waitLock: () => state.locks++, releaseLock: () => {} }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }),
      flush: () => {},
    },
    Utilities: { formatDate: () => '2026-11-06 12:00:00' },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ setMimeType: () => ({ text }) }),
    },
  });
  runInContext(SOURCE, ctx);
  const doPost = runInContext('doPost', ctx) as (e: unknown) => { text: string };
  return {
    rows,
    get locks() {
      return state.locks;
    },
    formats: state.formats,
    run: (body) => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).text),
  };
}

const row = {
  fullName: 'Lina Benali',
  phone: '+213661234567',
  wilayaCode: '05',
  wilayaName: 'Batna / باتنة',
  age: 24,
  language: 'en',
  consent: true,
  sourcePage: '/en/join/',
};

let gs: Fake;
beforeEach(() => {
  gs = load();
});

describe('apps-script/Code.gs', () => {
  it('rejects requests without the right secret', () => {
    expect(gs.run({ row })).toEqual({ ok: false, error: 'unauthorized' });
    expect(gs.run({ secret: 'wrong', row })).toEqual({ ok: false, error: 'unauthorized' });
    expect(load(null).run({ secret: '', row })).toEqual({ ok: false, error: 'unauthorized' });
    expect(gs.rows).toHaveLength(0);
  });

  it('appends header + row with the right columns, under a lock', () => {
    expect(gs.run({ secret: SECRET, row })).toEqual({ ok: true });
    expect(gs.rows[0]).toEqual([
      'Timestamp (Africa/Algiers)', 'Full name', 'Phone', 'Wilaya code', 'Wilaya name',
      'Age', 'Language', 'Consent', 'Source page', 'Duplicate',
    ]);
    expect(gs.rows[1]).toEqual([
      '2026-11-06 12:00:00', 'Lina Benali', '+213661234567', '05', 'Batna / باتنة', 24, 'en', 'YES', '/en/join/', '',
    ]);
    expect(gs.locks).toBe(1);
    expect(gs.formats).toContain('3:@'); // phone column is plain text
    expect(gs.formats).toContain('4:@'); // wilaya code keeps its leading zero
  });

  it('flags a duplicate phone but still appends', () => {
    gs.run({ secret: SECRET, row });
    expect(gs.run({ secret: SECRET, row: { ...row, fullName: 'Someone Else' } })).toEqual({ ok: true });
    expect(gs.rows).toHaveLength(3);
    expect(gs.rows[2]![9]).toBe('YES');
  });

  it.each([
    ['phone', { phone: '0661234567' }],
    ['phone', { phone: '=HYPERLINK("x")' }],
    ['age', { age: 12 }],
    ['age', { age: 18.5 }],
    ['wilayaCode', { wilayaCode: '70' }],
    ['consent', { consent: false }],
    ['language', { language: 'fr' }],
    ['fullName', { fullName: 'A' }],
    ['fullName', { fullName: 'Robert1' }],
  ])('revalidates: rejects bad %s', (field, patch) => {
    const res = gs.run({ secret: SECRET, row: { ...row, ...patch } });
    expect(res).toEqual({ ok: false, error: `invalid: ${field}` });
    expect(gs.rows).toHaveLength(0);
  });

  it('escapes formula-looking text', () => {
    gs.run({ secret: SECRET, row: { ...row, wilayaName: '=IMPORTXML("http://x")', sourcePage: '@cmd' } });
    expect(gs.rows[1]![4]).toBe(`'=IMPORTXML("http://x")`);
    expect(gs.rows[1]![8]).toBe("'@cmd");
  });

  it('returns a generic error on bad JSON', () => {
    const ctxLoad = load();
    const res = ctxLoad.run(undefined);
    expect(res.ok).toBe(false);
  });
});
