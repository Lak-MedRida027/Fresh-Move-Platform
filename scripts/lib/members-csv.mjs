// Members import from the v1 Google Sheet (File → Download → CSV). Pure
// functions, unit-tested in tests/unit/import-members.test.ts.
//
// v1 columns: Timestamp (Africa/Algiers) | Full name | Phone | Wilaya code |
// Wilaya name | Age | Language | Consent | Source page | Duplicate

/** RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // byte-order mark from Excel / Sheets
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const COLUMNS = {
  timestamp: /^timestamp/i,
  name: /^full name$/i,
  phone: /^phone$/i,
  wilaya: /^wilaya code$/i,
  age: /^age$/i,
  consent: /^consent$/i,
};

export function normalizePhone(raw) {
  const compact = String(raw).replace(/^'/, '').replace(/[\s\-.()]/g, '');
  const local = compact.match(/^0([567]\d{8})$/);
  if (local) return `+213${local[1]}`;
  const intl = compact.match(/^(?:\+|00)213([567]\d{8})$/);
  return intl ? `+213${intl[1]}` : null;
}

/** "2026-03-14 18:05:00" (Algeria time, UTC+1, no DST) → ISO instant. */
export function algiersTimestamp(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(raw).trim());
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}+01:00`).toISOString() : null;
}

/**
 * Turns the sheet into member rows. Keeps the FIRST row per phone (v1 kept
 * repeats and marked them "Duplicate"). Returns counts by reason, never names.
 */
export function mapMembers(rows) {
  const [header, ...data] = rows;
  if (!header) throw new Error('the file is empty');
  const idx = {};
  for (const [key, re] of Object.entries(COLUMNS)) {
    idx[key] = header.findIndex((h) => re.test(h.trim()));
    if (idx[key] < 0) throw new Error(`column "${key}" not found: is this the v1 members sheet exported as CSV?`);
  }
  const members = [];
  const seen = new Set();
  const skipped = { phone: 0, name: 0, wilaya: 0, age: 0, consent: 0, date: 0, duplicate: 0 };
  for (const r of data) {
    const get = (k) => (r[idx[k]] ?? '').trim();
    const phone = normalizePhone(get('phone'));
    if (!phone) {
      skipped.phone++;
      continue;
    }
    if (seen.has(phone)) {
      skipped.duplicate++;
      continue;
    }
    // v1 escaped names starting with = + - @ with a leading apostrophe; real names never start with one.
    const name = get('name').replace(/^'/, '').normalize('NFC').replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 60 || /^[=+\-@]/.test(name)) {
      skipped.name++;
      continue;
    }
    const wilaya = get('wilaya').replace(/^'/, '').padStart(2, '0');
    if (!/^\d{2}$/.test(wilaya) || Number(wilaya) < 1 || Number(wilaya) > 69) {
      skipped.wilaya++;
      continue;
    }
    const age = Number(get('age'));
    if (!Number.isInteger(age) || age < 10 || age > 120) {
      skipped.age++;
      continue;
    }
    if (!/^(yes|true|oui|نعم|1)$/i.test(get('consent'))) {
      skipped.consent++;
      continue;
    }
    const consentAt = algiersTimestamp(get('timestamp'));
    if (!consentAt) {
      skipped.date++;
      continue;
    }
    seen.add(phone);
    members.push({ full_name: name, phone, wilaya_code: wilaya, age, consent_at: consentAt, created_at: consentAt, source: 'import' });
  }
  return { members, skipped, rows: data.length };
}
