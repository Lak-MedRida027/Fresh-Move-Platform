# Backups and restore

Supabase's free plan has **no downloadable backups**, so the club keeps its own: every Sunday a GitHub
Actions job dumps the production database and the trip photos, encrypts them, and keeps them for 30 days.

## What's in a backup

| File | Contents |
| --- | --- |
| `data.sql.age` | All rows: trips, photos' records, members, bookings, admins (accounts and their MFA), settings, audit log, job runs, storage file records |
| `photos.tar.age` | The trip photo files (all three sizes) |
| `schema.sql.age`, `roles.sql.age` | Table definitions and roles, for reference (a restore uses the migrations in git) |
| `migrations.sql.age` | Which migrations the database had, so the restore can check it uses the same version |
| `manifest.json` | Date, migration version, row counts per table, file sizes and hashes. **No personal data.** |

**Not included, on purpose:** sign-in sessions and tokens (everyone signs in again after a restore),
rate-limit counters, and settings the code recreates (the storage bucket). **Secrets** (Cloudflare,
Turnstile, the cron secret) aren't in the database; they're in Cloudflare and your password manager.

## Encryption

Backups are encrypted with [age](https://age-encryption.org) for one public key. Only the matching
**private key** can read them, and it never goes to GitHub or Cloudflare.

**This matters because the repository is public:** anyone with a GitHub account can download the
workflow's artifacts and read its logs. They'd get encrypted files, a manifest of counts and nothing
else. The workflow checks that only `.age` files and the manifest are uploaded, and the scripts never
print data or the connection string (the database password is also masked in the logs).

### Keep the private key safe

- `npm run backup:keygen` creates it in your home folder (`fresh-move-backup-key.txt`, never inside
  the project) and prints the public key (`age1…`).
- Keep **a second copy offline**: a USB stick in a drawer, or as a secure note in a password manager.
  **If the key is lost, every backup is unreadable.** If it leaks, make a new pair (below); old
  backups expire within 30 days.

## Set up (once, at deploy time)

1. `npm run backup:keygen` → note the public key it prints.
2. GitHub → the repository → **Settings → Secrets and variables → Actions**:
   - **Secret** `BACKUP_DB_URL`: in Supabase → **Connect** → **Session pooler** connection string
     (`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`), with the
     database password filled in. (The *direct* connection needs IPv6, which GitHub's runners don't have.)
   - **Variable** `BACKUP_AGE_RECIPIENT`: the public key (`age1…`).
   - **Variable** `PUBLIC_SUPABASE_URL`: `https://<ref>.supabase.co`.
   - **Variable** `BACKUP_ENABLED`: `true`.
3. **Actions → Backup → Run workflow** once, and check it finishes green.
4. Test that you can read it (next section, steps 1–2) on your computer.

GitHub emails you when a scheduled run fails. Weekly runs on a repository with no activity for 60 days
are paused by GitHub: re-enable them in **Actions → Backup** if that happens.

## Get a backup

**Actions → Backup →** the latest green run **→ Artifacts → fresh-move-backup-…** (a zip). Unzip it into a
folder outside the project, for example `C:\fresh-move-restore\backup`.

To look inside one file (optional), with the [age command-line tool](https://github.com/FiloSottile/age):
`age -d -i fresh-move-backup-key.txt data.sql.age > data.sql`. Treat the decrypted file like the
membership list: it holds personal data. Delete it when you're done.

## Restore (after losing the database)

The restore loads the data into a database that already has the same schema (the migrations in git),
in **one transaction** (all or nothing), uploads the photos, then checks every row count against the
manifest. It refuses to run if the target has a different migration version or already has data.

1. **A new, empty Supabase project** (EU region), or the old one if it's empty. In
   **Authentication → Sign In / Providers**, keep sign-ups off and TOTP MFA on (as in deploy).
2. **Schema:** in the project folder, check out the commit whose `supabase/migrations` end at the
   backup's `manifest.json → migrations.latest` (normally the current `master`), then:
   `npx supabase link --project-ref <new-ref>` and `npx supabase db push`.
3. **Data and photos** (PowerShell; Docker must be running if `psql` isn't installed):
   ```powershell
   $env:SUPABASE_SERVICE_ROLE_KEY = Read-Host -MaskInput "Secret key of the new project"
   npm run restore -- --in C:\fresh-move-restore\backup --identity $HOME\fresh-move-backup-key.txt `
     --db-url "postgresql://postgres.<new-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" `
     --photos-url https://<new-ref>.supabase.co --yes
   ```
   It prints `ok` for each table and "restore complete" at the end. (`--no-photos` skips the photos.)
4. **Point the site at it** if it's a new project: update `PUBLIC_SUPABASE_URL` /
   `PUBLIC_SUPABASE_ANON_KEY` (build variables) and `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`,
   then `npm run deploy`. Update the backup workflow's `BACKUP_DB_URL` and `PUBLIC_SUPABASE_URL` too.
5. **Check:** sign in to the admin (password + authenticator code; everyone signs in again), open a trip
   with photos, and run the jobs once by hand:
   `curl.exe -X POST -H "Authorization: Bearer <CRON_SECRET>" https://<site>/api/cron/daily` (it answers `"ok":true`).
6. Delete the unzipped backup folder.

## Tested

`npm run backup:test` does the whole round trip on the local stack: a throwaway key, a backup (database
and photos), a check that the folder holds only age files and a manifest without personal data, a wipe of
the local database (`supabase db reset --no-seed`), and a restore that must match every row count and
the audit log's id sequence. **It runs in CI on every push**, so the backup and restore scripts can't
drift from the schema. First run on 7 Nov 2026: 542 trips, 736 members, 801 bookings, 124 accounts, 255
photo files, all restored.

## Make a new key pair

Run `npm run backup:keygen -- --out <a new file>`, put the new public key in `BACKUP_AGE_RECIPIENT`, run the
workflow once, and keep the **old** private key until the last backup made with it has expired (30 days).

## Files

- `scripts/backup.mjs`: dump (`supabase db dump`), photo download, encryption, manifest.
- `scripts/restore.mjs`: checks, decryption, one-transaction load, photo upload, count check.
- `scripts/backup-keygen.mjs`, `scripts/backup-restore-test.mjs`, `scripts/lib/backup.mjs`.
- `.github/workflows/backup.yml`: the weekly job.
