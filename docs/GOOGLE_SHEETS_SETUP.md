# Google Sheets setup (membership form)

The membership form on the website saves each sign-up as a new row in a Google Sheet.
It works like this:

```
Website form  →  /api/join on Vercel (checks everything, adds the secret)
              →  your Google Apps Script Web App (checks the secret again)
              →  new row in your Google Sheet
```

The Apps Script URL and the secret are stored only in Vercel. They never appear in the website code
that visitors download. Follow these steps once. It takes about 10 minutes.

## 1. Create the Sheet

1. Go to <https://sheets.google.com> with the Google account that should own the member list
   (ideally a club account, not a personal one).
2. Create a **Blank spreadsheet** and name it, for example, `Fresh Move - Members`.
3. Leave it empty. The script creates a `Members` tab with the header row:
   `Timestamp (Africa/Algiers) | Full name | Phone | Wilaya code | Wilaya name | Age | Language | Consent | Source page | Duplicate`

## 2. Add the script

1. In the Sheet, open **Extensions → Apps Script**.
2. Delete everything in `Code.gs` and paste the full content of [`apps-script/Code.gs`](../apps-script/Code.gs)
   from this repository.
3. Click the **Save** icon (💾). Name the project `Fresh Move form`.

## 3. Create the secret

1. Make a long random secret (at least 32 characters). One easy way: open
   <https://www.random.org/strings/?num=1&len=40&digits=on&upperalpha=on&loweralpha=on&unique=on&format=html&rnd=new>
   or run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` on your computer.
2. In Apps Script, click the ⚙️ **Project Settings** icon on the left.
3. Scroll to **Script Properties → Add script property**:
   - Property: `SHARED_SECRET`
   - Value: your secret
4. Click **Save script properties**.

Keep the secret somewhere safe (a password manager). You'll paste the same value into Vercel. **Don't send it
in a chat, email or Instagram message.**

## 4. Run the setup once

1. Go back to the **Editor** (`<>` icon).
2. In the function dropdown at the top, select **`setup`** and click **Run**.
3. Google asks for permission: **Review permissions** → choose your account → **Advanced** →
   **Go to Fresh Move form (unsafe)** → **Allow**. ("Unsafe" only means Google hasn't reviewed your own script.)
4. The log should say `SHARED_SECRET is set (… chars).` and the Sheet now has a `Members` tab with headers.

## 5. Deploy as a Web App

1. Click **Deploy → New deployment**.
2. Click the ⚙️ next to "Select type" → **Web app**.
3. Fill in:
   - Description: `v1`
   - **Execute as: Me**
   - **Who has access: Anyone**
4. Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

"Anyone" is required so the website's server can reach it without a Google login. Requests without the
secret are rejected by the script.

## 6. Put the URL and secret in Vercel

In the Vercel dashboard: **Project → Settings → Environment Variables**, add both for **Production** and
**Preview**:

| Name | Value |
|---|---|
| `SHEETS_WEBHOOK_URL` | the Web app URL from step 5 |
| `SHEETS_WEBHOOK_SECRET` | the same secret as `SHARED_SECRET` |

Then redeploy (**Deployments → … → Redeploy**) so the function picks them up. (If you're working with
Claude on the deployment, it can set these with the Vercel CLI. You'll type the values into your own
terminal, not into the chat.)

## 7. Test it

Submit the form on the live site with a test name. A new row should appear within a few seconds.
Delete the test row afterwards.

## Updating the script later

If you change `Code.gs`: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
The URL stays the same. (A "New deployment" creates a new URL, which you'd have to update in Vercel.)

## Rotating the secret

Change `SHARED_SECRET` in Script Properties and `SHEETS_WEBHOOK_SECRET` in Vercel at the same time,
then redeploy on Vercel.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Form shows "That didn't go through" | Check Vercel → Project → Logs for `/api/join`. `upstream rejected` with `unauthorized` = the two secrets don't match. |
| `not configured` in Vercel logs | The environment variables are missing, or you didn't redeploy after adding them. |
| Phone shows as a number without `+` | The Phone column lost its text format. Run `setup` again. |
| Duplicate column says `YES` | That phone number had already signed up. The row is kept on purpose. |
| Nothing happens for 10+ s | Apps Script can be slow on the first call of the day ("cold start"). Try again. |

## Privacy

Only share the Sheet with club admins. Delete a member's row when they ask (see the privacy page on the
site). The site's privacy notice references Algerian Law 18-07.
