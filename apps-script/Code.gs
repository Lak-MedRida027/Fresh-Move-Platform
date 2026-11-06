/**
 * Fresh Move: membership sign-ups → Google Sheet.
 *
 * Deployed as a Web App (Execute as: Me, Who has access: Anyone). Only the
 * website's server (/api/join on Vercel) knows the shared secret, so only it
 * can add rows. Setup steps: docs/GOOGLE_SHEETS_SETUP.md
 *
 * Script Properties (Project Settings → Script Properties):
 *   SHARED_SECRET  same long random value as SHEETS_WEBHOOK_SECRET in Vercel
 */

var SHEET_NAME = 'Members';
var HEADERS = [
  'Timestamp (Africa/Algiers)',
  'Full name',
  'Phone',
  'Wilaya code',
  'Wilaya name',
  'Age',
  'Language',
  'Consent',
  'Source page',
  'Duplicate',
];
var PHONE_COL = 3; // C
var WILAYA_CODE_COL = 4; // D
var MIN_AGE = 18; // keep in sync with MIN_AGE in src/config/site.ts
var MAX_AGE = 80;
var MAX_WILAYA = 69;

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    var expected = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
    if (!expected || !safeEquals(String(body.secret || ''), expected)) {
      return reply({ ok: false, error: 'unauthorized' });
    }

    var row = body.row || {};
    var problem = validate(row);
    if (problem) return reply({ ok: false, error: 'invalid: ' + problem });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000); // wait up to 20 s for other submissions to finish
    try {
      var sheet = getSheet();
      var duplicate = phoneExists(sheet, row.phone);
      var timestamp = Utilities.formatDate(new Date(), 'Africa/Algiers', 'yyyy-MM-dd HH:mm:ss');
      sheet.appendRow([
        timestamp,
        clean(row.fullName),
        row.phone, // validated +213XXXXXXXXX; column is plain text so the "+" is kept
        row.wilayaCode,
        clean(row.wilayaName),
        Number(row.age),
        row.language,
        'YES',
        clean(row.sourcePage),
        duplicate ? 'YES' : '',
      ]);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    return reply({ ok: true });
  } catch (err) {
    console.error(err);
    return reply({ ok: false, error: 'server_error' });
  }
}

function doGet() {
  return reply({ ok: false, error: 'use POST' });
}

/** Defence in depth: the website validates first, this checks again. */
function validate(row) {
  var name = String(row.fullName || '');
  if (name.length < 2 || name.length > 61) return 'fullName';
  if (/[0-9٠-٩۰-۹<>{}]/.test(name)) return 'fullName';
  if (!/^\+213[567]\d{8}$/.test(String(row.phone || ''))) return 'phone';
  var code = String(row.wilayaCode || '');
  if (!/^\d{2}$/.test(code) || Number(code) < 1 || Number(code) > MAX_WILAYA) return 'wilayaCode';
  if (String(row.wilayaName || '').length > 80) return 'wilayaName';
  var age = Number(row.age);
  if (!(age === Math.floor(age) && age >= MIN_AGE && age <= MAX_AGE)) return 'age';
  if (row.language !== 'ar' && row.language !== 'en') return 'language';
  if (row.consent !== true) return 'consent';
  if (String(row.sourcePage || '').length > 200) return 'sourcePage';
  return null;
}

/** Block spreadsheet formula injection: text starting with = + - @ becomes plain text. */
function clean(value) {
  var s = String(value == null ? '' : value);
  if (/^'/.test(s)) return s; // already escaped by the website
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  // Phone and wilaya code are text: keeps "+213…" and the leading zero in "05".
  sheet.getRange(1, PHONE_COL, sheet.getMaxRows(), 1).setNumberFormat('@');
  sheet.getRange(1, WILAYA_CODE_COL, sheet.getMaxRows(), 1).setNumberFormat('@');
  return sheet;
}

function phoneExists(sheet, phone) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var values = sheet.getRange(2, PHONE_COL, last - 1, 1).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).replace(/^'/, '') === phone) return true;
  }
  return false;
}

/** Constant-time string comparison (don't leak the secret through timing). */
function safeEquals(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this once from the editor (select "setup" → Run) to create the sheet,
 * the header row and to grant the script permission to edit the spreadsheet.
 */
function setup() {
  getSheet();
  var secret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  console.log(secret ? 'SHARED_SECRET is set (' + secret.length + ' chars).' : 'SHARED_SECRET is NOT set yet.');
}
