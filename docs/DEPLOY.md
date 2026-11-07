# Deploying v2 (step by step)

This takes about 1–2 hours the first time. You do the account steps (sign-ups, passwords, keys);
every command runs in **PowerShell** in the project folder, on the `v2` branch.

**Rules for secrets:** never paste a secret key or password into a chat, an issue, a commit or a
screenshot. Put them only where each step says (Cloudflare, Supabase, GitHub, your password manager).
Keep a password manager entry called **Fresh Move** and save everything there as you go.

## What you'll end up with

| Piece | Where | What it does |
| --- | --- | --- |
| Website + admin | Cloudflare Workers (free) | Pages, booking form, admin dashboard, scheduled jobs |
| Database, accounts, photos | Supabase (free, EU) | Trips, bookings, members, admins with MFA, photo files |
| Bot protection | Cloudflare Turnstile (free) | Stops spam on the booking and membership forms |
| Weekly backup | GitHub Actions | Encrypted database + photos, kept 30 days |
| Old address | Vercel | Forwards `freshmove-seven.vercel.app` to the new site |

## Every value, and where it comes from

| Name | Kind | Where you get it | Where it goes |
| --- | --- | --- | --- |
| `SITE_URL` | public | Cloudflare (step 3): `https://fresh-move.<subdomain>.workers.dev` | `.env.production` |
| `PUBLIC_SUPABASE_URL` | public | Supabase → Project Settings → Data API → Project URL | `.env.production` |
| `PUBLIC_SUPABASE_ANON_KEY` | public | Supabase → Project Settings → API Keys → **Publishable** key (`sb_publishable_…`) | `.env.production` |
| `PUBLIC_TURNSTILE_SITE_KEY` | public | Cloudflare → Turnstile → widget → Site key | `.env.production` |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | Supabase → Project Settings → API Keys → **Secret** key (`sb_secret_…`) | Cloudflare secret |
| `TURNSTILE_SECRET_KEY` | **secret** | Cloudflare → Turnstile → widget → Secret key | Cloudflare secret |
| `CRON_SECRET` | **secret** | You generate it (step 6) | Cloudflare secret + password manager |
| Database password | **secret** | You choose it when creating the Supabase project | Password manager; GitHub secret `BACKUP_DB_URL` |
| Backup private key | **secret** | `npm run backup:keygen` (step 12) | A file in your home folder + an offline copy |
| `BACKUP_AGE_RECIPIENT` | public | Printed by `npm run backup:keygen` | GitHub variable |

"Public" values end up in the website's code anyway (that's normal and safe: the database's row-level
security and MFA protect the data). "Secret" values must never be in a file in this project.

---

## 1. Before you start

- **PowerShell 7** (`pwsh`; the commands below use `Read-Host -MaskInput`, which the older Windows
  PowerShell 5 doesn't have). Node 24 (`node -v`), Git, and the project installed (`npm install`).
- Docker Desktop running (only needed for the backup check at the end and for local tests).
- Run the full test suite once: `npm run test:all` and `npm run test:db` (both against your local stack;
  they never touch production).

## 2. Supabase: create the production project

1. Sign in at [supabase.com](https://supabase.com) with the club's (or your) email. **Use the email that
   will be the first owner's admin email**: Supabase's built-in email only sends to members of your
   Supabase organisation (see step 4.5).
2. **New project**:
   - Name: `fresh-move`
   - Database password: click **Generate a password**, save it in the password manager.
   - Region: **Central EU (Frankfurt)** (or West EU (Paris)).
   - Plan: Free.
3. Wait until the project is ready, then note the **project ref** (the `xxxx` in
   `https://xxxx.supabase.co`, also under Project Settings → General).

## 3. Cloudflare: account, Workers subdomain, Turnstile

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (free).
2. **Workers & Pages** → if asked, choose your **workers.dev subdomain** (e.g. `freshmove`). Your site will
   be `https://fresh-move.<subdomain>.workers.dev`. That is your **`SITE_URL`**.
3. **Turnstile** → **Add widget**:
   - Name: `Fresh Move`
   - Hostname: `fresh-move.<subdomain>.workers.dev`
   - Widget mode: **Managed**
   - Pre-clearance: no.

   Create it, then copy the **Site key** (public) and keep the **Secret key** page open for step 6.

## 4. Supabase: database and sign-in settings

1. **Log the CLI in and link the project** (a browser window opens for the login; `link` asks for the
   database password from step 2):
   ```powershell
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   ```
2. **Create the tables, security rules, functions and storage bucket** (all migrations in
   `supabase/migrations`):
   ```powershell
   npx supabase db push
   ```
   Answer `Y`. Don't run `supabase config push`: `supabase/config.toml` is for the local stack.
3. **Authentication → Sign In / Providers**:
   - **Allow new users to sign up**: **off** (only invited admins have accounts).
   - Email provider: on.
4. **Authentication → URL Configuration**:
   - **Site URL**: your `SITE_URL` (no trailing slash). The admin emails link to it.
   - **Redirect URLs**: add `https://fresh-move.<subdomain>.workers.dev/**`.
5. **Authentication → Emails → SMTP Settings** (needed before you invite **other** admins; the first
   owner works without it if their email is your Supabase login email):
   the built-in sender only delivers to members of your Supabase organisation, about 2 emails an hour.
   The simplest free option is the club's Gmail:
   - In the Google account: turn on **2-Step Verification**, then create an **App password**
     (Google Account → Security → App passwords). Save it in the password manager.
   - In Supabase, enable custom SMTP: Host `smtp.gmail.com`, Port `465`, Username = the Gmail address,
     Password = the app password, Sender email = the Gmail address, Sender name `Fresh Move`.
6. **Authentication → Emails → Templates**:
   - **Invite user**: subject `Fresh Move admin: choose your password`; replace the body with the content
     of [`supabase/templates/invite.html`](../supabase/templates/invite.html).
   - **Reset password**: subject `Fresh Move admin: reset your password`; body from
     [`supabase/templates/recovery.html`](../supabase/templates/recovery.html).

   These link to the site's own pages (`/admin/auth/confirm/`), which the sign-in flow needs.
7. **Authentication → Multi-Factor**: **TOTP (App Authenticator)** enabled (it is by default).
8. **Advisors → Security Advisor** and **Performance Advisor**: both should show no issues.

## 5. The build settings file

```powershell
Copy-Item .env.production.example .env.production
notepad .env.production
```

Fill in the four values from the table above and save. The file is ignored by Git. It only holds
public values: `npm run deploy` refuses to run if it finds a secret or a local/test value in it.

## 6. Cloudflare: log in and add the secrets

```powershell
npx wrangler login
```

Then add the three secrets. Each command asks you to paste the value (it isn't shown, and it goes straight to
Cloudflare). The first one asks whether to create the Worker `fresh-move`: answer yes.

```powershell
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

For the cron secret, generate a long random value, save it in the password manager, then add it:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put CRON_SECRET
```

## 7. Deploy

```powershell
npm run deploy
```

It checks `.env.production`, builds with those values, and runs `wrangler deploy`. The Worker also gets
its two scheduled jobs (every 15 minutes, and daily at 03:00 UTC) and its rate limits from
`wrangler.jsonc`. At the end it prints the next command:

```powershell
npm run smoke -- https://fresh-move.<subdomain>.workers.dev
```

Every line must say `ok`. The smoke check only reads, and sends two requests the site must refuse. If
`trips page` fails, that's expected until step 8; run it again after.

## 8. Data: the past trips

The 14 v1 trips (with their photos) go in as completed trips, with the same addresses as before. The
secret key is typed in, not pasted into a file:

```powershell
$env:SEED_SUPABASE_URL = "https://<your-project-ref>.supabase.co"
$env:SEED_SUPABASE_SECRET_KEY = Read-Host -MaskInput "Supabase secret key"
node scripts/seed-trips.ts --production
```

## 9. The first owner

In the same PowerShell window (the two variables are still set):

```powershell
node scripts/create-owner.ts your-email@example.com --production
Remove-Item Env:SEED_SUPABASE_SECRET_KEY
```

1. Open the email **"Fresh Move admin: choose your password"** → **Choose my password** → **Continue**.
2. Choose a password (at least 12 characters; a short sentence works well), save it in the password
   manager.
3. Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis,
   1Password…), enter the 6-digit code. You're in the dashboard.
4. **Keep the authenticator safe:** if the phone is lost, another owner must remove and re-invite you.
   Invite a second owner (Admins page) as soon as possible.

Other admins: **Admins → Invite an admin** (needs the SMTP of step 4.5). They get the same email and
go through the same three steps. "Forgot your password?" on the sign-in page sends a reset email; the
reset asks for the authenticator code before the new password.

## 10. Data: the members from the v1 Google Sheet

1. Open the members Google Sheet → **File → Download → Comma-separated values (.csv)**. Save it
   **outside** the project folder (e.g. `Downloads\members.csv`). It holds personal data.
2. Dry run: reads and checks the file, writes nothing, prints counts only:
   ```powershell
   $env:SEED_SUPABASE_URL = "https://<your-project-ref>.supabase.co"
   $env:SEED_SUPABASE_SECRET_KEY = Read-Host -MaskInput "Supabase secret key"
   node scripts/import-members.ts $HOME\Downloads\members.csv --production
   ```
   Check the numbers: valid members, repeats left out (v1 kept repeats and marked them), invalid rows
   by reason, and how many will be imported.
3. If they look right, import:
   ```powershell
   node scripts/import-members.ts $HOME\Downloads\members.csv --production --commit
   Remove-Item Env:SEED_SUPABASE_SECRET_KEY
   ```
   Members keep their original join date and consent date, with source "Import". Anyone already in the
   database (same phone) is left as is. Running it twice imports nothing new.
4. Delete the CSV from Downloads (and the trash).
5. Switch off the v1 Apps Script: in the Sheet → **Extensions → Apps Script → Deploy → Manage
   deployments → Archive**. The new site's membership form already saves to Supabase. Keep the Sheet
   as an archive, or delete it once you've checked the members in the admin.

## 11. Check everything once by hand

1. `npm run smoke -- <SITE_URL>`: all `ok`.
2. Open the site on your phone, in Darja and English, light and dark.
3. In the admin: **Trips → New trip** (`TEST, hidden`), fill it in, set it to **Open**. On the public site,
   book a seat with your own phone number; check **Check my reservation** with the code. In the admin,
   confirm it, **Export to Excel**, open the file. Then cancel the booking and set the trip back to
   **Draft** (it stays hidden).
4. Upload a photo on a trip (Trips → the trip → Photos): it should appear with its description.
5. Run the daily job once by hand (it also proves the cron secret works):
   ```powershell
   $cron = Read-Host -MaskInput "CRON_SECRET"
   curl.exe -s -X POST -H "Authorization: Bearer $cron" <SITE_URL>/api/cron/daily
   ```
   It answers `"ok":true`. The admin overview's **Background jobs** shows it, and the 15-minute job
   appears there within 15 minutes.
6. Cloudflare → Workers & Pages → fresh-move → **Logs**: no errors.

## 12. Weekly backup

Follow [BACKUP_RESTORE.md → Set up](BACKUP_RESTORE.md#set-up-once-at-deploy-time):

1. `npm run backup:keygen`: private key in your home folder (make an offline copy), public key printed.
2. GitHub → the repository → **Settings → Secrets and variables → Actions**:
   - secret `BACKUP_DB_URL`: Supabase → **Connect** → **Session pooler** connection string, with the
     database password filled in;
   - variables `BACKUP_AGE_RECIPIENT` (the public key), `PUBLIC_SUPABASE_URL`, `BACKUP_ENABLED` = `true`.
3. **Actions → Backup → Run workflow**; it must finish green.

## 13. Publish v2 and forward the old address

1. Put the new address in [`vercel-redirect/vercel.json`](../vercel-redirect/vercel.json)
   (`"destination": "https://fresh-move.<subdomain>.workers.dev/:path*"`) and commit it on `v2`.
2. **Vercel** → the project → **Settings → Build and Deployment**:
   - **Root Directory**: `vercel-redirect`
   - **Framework Preset**: Other (no build command)

   Do this **before** merging: Vercel deploys `master` on every push.
3. Merge `v2` into `master` (a pull request on GitHub). Vercel redeploys as a redirect.
4. Check: `curl.exe -sI https://freshmove-seven.vercel.app/trips/` shows `301` and the new address.
5. In Vercel, delete the old environment variables (`SHEETS_WEBHOOK_URL`, `SHEETS_WEBHOOK_SECRET`).
6. Update the **Instagram bio** link to the new address.

## 14. Later

- **Custom domain:** [CUSTOM_DOMAIN.md](CUSTOM_DOMAIN.md) (also makes the site faster: Cloudflare's edge
  cache only works on your own domain).
- **Watch:** the admin overview (storage meter, background jobs), Cloudflare Logs, and GitHub's email if a
  backup fails. Supabase pauses free projects after a week without activity; the daily job prevents that.
- **Free plan limits** to keep an eye on: Supabase 500 MB database / 1 GB storage / 5 GB egress a month;
  Cloudflare Workers 100,000 requests a day and 10 ms CPU per request. If CPU errors show in the logs,
  Workers Paid is $5/month.

## If something goes wrong

| Symptom | Likely cause |
| --- | --- |
| `npm run deploy` lists problems | A value in `.env.production` is missing, local, a test key, or a secret |
| Smoke: "CSP does not allow the Supabase project" | Built without `.env.production`: run `npm run deploy` again |
| Smoke: "dummy token was accepted" | `TURNSTILE_SECRET_KEY` is Cloudflare's test key: `npx wrangler secret put TURNSTILE_SECRET_KEY` with the real one |
| Booking form says it couldn't check you're human | The Turnstile widget's hostname doesn't match the site address |
| No invitation email | Not a member of your Supabase organisation and no custom SMTP (step 4.5); or the 2/hour limit |
| Email link says "isn't valid any more" | Links work once, for an hour: ask for a new one (Forgot your password? / re-invite) |
| Admin page sends you back to sign-in after 2 h | Normal: sign-out after 2 hours without activity |
| Overview: "A background job is late or failing" | Cloudflare → Logs; check the secrets are set; run the job by hand (step 11.5) |
| Backup workflow fails | The `BACKUP_DB_URL` must be the **Session pooler** string with the password; see its log |
