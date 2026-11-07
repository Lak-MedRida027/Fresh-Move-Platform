# Excel exports

How admins get lists out of the dashboard, and the rules the files follow.

## For the team

| List | Where | What's in it |
| --- | --- | --- |
| **One trip's bookings** | Trips → the trip → **Reservations** → **Export to Excel** | Sheet **Summary** (trip, dates, price, seats: confirmed / held / waitlist / left / cancelled / expired, filters used, row count, export time) and sheet **Reservations**, in bus order: confirmed, then held, then the waitlist in its order, then cancelled and expired. |
| **All bookings** | **Reservations** → **Export to Excel** | Every booking matching the filters, newest first, with a Trip column. |
| **Members** | **Members** → **Export to Excel** | Every member matching the filters (name / phone search, wilaya, age range), newest first. |

- The export uses **the filters on the page**: filter first (status, search, wilaya, age), then export.
  It includes every matching row, not just the 50 on screen.
- The file is in the language of the page you export from (Darja sheets are right-to-left).
- Up to **10,000 rows** per file. Above that you'll be asked to narrow the filters.
- **The file has personal data.** Keep it on your own device, don't forward it, and delete it when
  you're done. Every export is recorded in the audit log (who, which list, which filters, how many rows).

## What's in the file

- Bold header row that stays visible when you scroll, and a filter button on every column.
- **Phones are text** (`+213551234567`), so Excel never turns them into numbers or drops the `+`.
- **Dates are real dates** in Algeria time (`yyyy-mm-dd hh:mm`), so you can sort and filter them.
- **Amounts** are numbers with a thousands separator.
- Bookings whose person was deleted or anonymised show "(anonymised)" with no phone.
- File names are plain ASCII: `fresh-move-reservations-<trip>-<date>.xlsx`, `fresh-move-members-<date>.xlsx`.

## Safety

- **Formula injection.** A name or note like `=HYPERLINK(…)` could become a live formula if someone edits
  the cell or saves the sheet as CSV. Any text starting with `=`, `+`, `-`, `@`, a tab or a line break
  (and their full-width forms) is written with a leading `'`, and every cell is written as a plain value:
  the files contain no formulas. Phones are the one exception to the `+` rule, and only when they look
  exactly like a phone number.
- Characters that are invalid in the file format (control characters) are removed, so the file always
  opens.
- **Only signed-in admins with MFA** can export (`/admin/api/export/`, which runs as that admin, so the
  database's row-level security applies). The endpoint accepts same-origin JSON only.
- **Logged before it's sent.** The endpoint calls `log_export(entity, entity_id, rows, filter)` before it
  returns any rows; if the log entry can't be written, nothing is exported. See Audit log → action
  `export`.

## How it works

1. The button (`src/components/admin/ExportButton.astro`, script `src/scripts/admin-export.ts`) posts
   `{ kind, trip_id, query, lang }` to `/admin/api/export/` (`src/pages/admin/api/export.ts`). `query` is
   the page's filter query string.
2. The server parses the filters with the same functions as the page (`src/lib/admin/data.ts`), reads
   every matching row in pages of 1000 (PostgREST's limit) with a stable order, logs the export, and
   returns a description of the workbook: sheets, typed columns, rows, in the admin's language
   (`src/lib/excel/exports.ts`).
3. The browser loads the spreadsheet library ([exceljs](https://github.com/exceljs/exceljs) 4.4.0, one
   ~250 KB gzipped file, only on the first export), builds the `.xlsx` (`src/lib/excel/workbook.ts`) and
   downloads it. Building the file in the browser keeps the Worker within its CPU limit.

All cell rules (text, phones, dates, formula guard, sheet names) live in `src/lib/excel/spec.ts`.

## Tests

- `tests/unit/excel.test.ts`: the cell rules; builds per-trip (Darja), all-bookings (English) and members
  files and **reads them back**: sheet names, right-to-left, frozen header, filters, row counts, bus
  order, phones as text, injection neutralised, no formulas anywhere, Arabic intact, Algeria times; a
  3,000-row file.
- `tests/db/rls.test.ts`: `log_export` records who, list, filters and rows; refuses bad input,
  admins without MFA, other users and anonymous callers.
- `tests/e2e/admin.spec.ts`: in all three browsers, exports a trip's bookings during the full admin
  flow and a filtered Darja members list containing a formula-shaped name, and parses the downloaded
  files (no console errors or CSP violations during the export); checks the audit entries; the API
  refuses cross-origin requests, bad input, form posts and GET.
