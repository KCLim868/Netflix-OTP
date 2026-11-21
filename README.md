# Netflix OTP

A tiny family web app. When someone asks Netflix for a sign-in code, they tap
**I've requested**. The app checks the Gmail inbox over IMAP, finds the Netflix
email and shows the code on that person's phone.

The screen only has the code and one button.

- Only the phone that tapped the button gets the code. Everyone else's screen stays blank.
- The code shows up a few seconds after Netflix sends it. Tap it to copy.
- If Netflix sends a new code within 3 minutes, the screen switches to the new one.
- Codes disappear after 15 minutes, when Netflix stops accepting them.
- For Netflix Household emails ("temporary access code" / "update your Netflix
  Household"), the email has a button instead of a code, so the app shows that
  netflix.com button.

## How it works

```
phone ── tap "I've requested" ──▶ /api/code ──IMAP (read-only)──▶ Gmail
      ◀──────── 4827 ────────────
```

- Logs into Gmail with an **app password** over IMAP. It doesn't use the Gmail
  connector or the Gmail API.
- Searches "All Mail" (so Gmail filters can't hide the email) for messages from
  `netflix.com` that arrived up to 3 minutes before the tap or any time after it.
- Opens the mailbox read-only, so it never marks emails as read, moves them or
  deletes them.
- Only the code (or the netflix.com link) is sent to the phone. Nothing is
  stored on the server.
- Ignores emails from look-alike domains (`netflix-support.com`,
  `netflix.com.evil.com`, …) and only shows `https://*.netflix.com` links.

## Setup (about 10 minutes, once)

### 1. Create a Gmail app password

Use the Gmail account Netflix sends its emails to.

1. Turn on 2-Step Verification: <https://myaccount.google.com/signinoptions/twosv>
2. Create an app password: <https://myaccount.google.com/apppasswords>. Name it
   "Netflix OTP" and copy the 16-letter password.

IMAP is always on in Gmail, so there's nothing to change there.

### 2. Choose a family key

Anyone with this key can see your codes, so don't use a simple PIN. A few words
work well, for example `purple tiger river`. Spaces are fine, and capital letters
don't matter, so `Purple Tiger River` works too.

### 3. Put it online (free, on Vercel)

1. Go to <https://vercel.com/new> and import this GitHub repository.
2. Open **Environment Variables** and add:

   | Name                 | Value                                   |
   | -------------------- | --------------------------------------- |
   | `GMAIL_USER`         | the Gmail address, e.g. `you@gmail.com` |
   | `GMAIL_APP_PASSWORD` | the app password from step 1            |
   | `ACCESS_KEY`         | the family key from step 2              |

3. Click **Deploy**. You get an address like `https://netflix-otp-xyz.vercel.app`.

To run it on a computer at home instead (Node.js 20.12 or newer):

```bash
npm install
cp .env.example .env   # then fill in the three values
npm start              # http://localhost:3000
```

### 4. Share it with the family

Send everyone this link (your address, plus `#key=` and the family key). Write
each space in the key as `%20`, so messaging apps don't cut the link short:

```
https://netflix-otp-xyz.vercel.app/#key=purple%20tiger%20river
```

They open it once, and the key is remembered on that phone. To make it look like
an app, use **Share → Add to Home Screen** (iPhone) or **⋮ → Add to Home screen**
(Android). If the home-screen icon asks for the family key, type it in once.

## Using it

1. On the TV, phone or laptop, ask Netflix to email a code: **Use a sign-in
   code**, or **I'm traveling / Send email** on the Household screen.
2. Open the app and tap **I've requested**.
3. The code appears. Tap it to copy.

If no code arrives within 3 minutes, the app stops checking. Ask Netflix again
and tap the button again.

## Settings

Only the first three are required.

| Name                 | Default          | What it does                                     |
| -------------------- | ---------------- | ------------------------------------------------ |
| `GMAIL_USER`         | —                | Gmail address that receives Netflix emails       |
| `GMAIL_APP_PASSWORD` | —                | Gmail app password (spaces are fine)             |
| `ACCESS_KEY`         | —                | Family key needed to see codes                   |
| `LOOKBACK_SECONDS`   | `180`            | How long before the tap an email can arrive      |
| `MAILBOX`            | Gmail "All Mail" | Folder to search (`INBOX`, a label, …)           |
| `IMAP_HOST`          | `imap.gmail.com` | For Outlook, iCloud, etc.                        |
| `IMAP_PORT`          | `993`            |                                                  |
| `SENDER_DOMAIN`      | `netflix.com`    | Only emails from this domain are read            |

## Good to know

- **Two people at once:** if two family members request codes within the same
  couple of minutes, both see the newest code. Take turns.
- **Wrong key protection:** after 10 wrong family keys, that device is blocked
  for 15 minutes.
- **The app password can read the whole mailbox.** It lives only in Vercel's
  settings (or your `.env`), never in the code or on the phones. If you're
  worried, remove it at <https://myaccount.google.com/apppasswords> at any time;
  the app stops working until you add a new one.
- **Netflix changes its emails sometimes.** If a code is ever missed, open an
  issue with the email's wording (code removed) and the matching rules in
  `lib/extract.js` can be updated.

## Development

```bash
npm test
```

The tests include a full IMAP run against a local fake Gmail server
(`hoodiecrow-imap`), so they don't need a real account.

| File               | What's in it                                            |
| ------------------ | ------------------------------------------------------- |
| `public/index.html`| The whole phone screen (HTML, CSS, JS)                  |
| `api/code.js`      | Vercel function entry point                             |
| `lib/handler.js`   | `/api/code`: family key check, timing, JSON answer      |
| `lib/mailbox.js`   | IMAP search and waiting for the email                   |
| `lib/extract.js`   | Finding the code or netflix.com link in an email        |
| `server.js`        | Runs the same app without Vercel (`npm start`)          |
