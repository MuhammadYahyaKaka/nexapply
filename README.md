# NexApply

A public, multi-user job-matching website for Pakistan. Anyone can sign up with their email + a verification code, upload their CV, and see jobs from all over Pakistan matched to their own skills. For jobs that accept applications **by email**, users can turn on **auto-apply**: the site sends the application **from the user's own connected Gmail account**, with their CV attached. Users can always apply themselves instead — both modes work side by side. Portal jobs (Indeed / LinkedIn / Rozee forms) are always applied by the user; the site never asks for portal passwords.

- Public site: `/` — there is **no admin link anywhere** on it.
- Admin panel: `/admin` (hidden, direct address only).
- Light theme (cream / sage green), single Node.js server, JSON-file database.

## Requirements

- Node.js 18 or newer
- One dependency: `nodemailer` (installed with `npm install`)

## Run it

```bash
npm install
node server.js          # or: npm start
```

- Port: `PORT` environment variable, default `3000`.
- Data is created automatically on first run: `data/db.json`; CV files go in `uploads/`.
- On first run the database is seeded with 4 real jobs (found 2026-11-05). More jobs are added from the Admin panel.

## First-time admin setup

1. Start the server and watch the console. If no admin exists, it prints a **one-time admin setup code**, e.g.:

   ```
   ADMIN SETUP REQUIRED — one-time admin setup code:
      >>>  123456  <<<
   ```

2. Open `http://localhost:3000/admin`, enter that code, and choose the admin email + password (min 8 characters).
3. After setup, `/admin` shows the normal login. The setup code never works again.

## Configure verification-code emails (SMTP) — Admin > Settings

Until this is configured, the site runs in **demo mode**: verification codes are printed in the server console instead of being emailed, and the signup page says so. To send real codes:

1. Pick the Gmail account that will send codes (a dedicated "Product Gmail" is recommended; an "Owner Gmail" slot is also kept — you choose which one is **active**).
2. In that Google account: turn on **2-Step Verification**, then create an **App Password** (Google Account → Security → App passwords).
3. In **Admin > Settings**, enter the sender email + app password in its slot and choose it as the active sender. Save.

Nothing is hardcoded — both sender slots, the active choice, and all other settings live in the database and are changed from Admin > Settings. App passwords are never returned by the API once saved.

## Configure Google Connect (users sending from their own email) — Admin > Settings

Auto-apply and one-click email applications send **from each user's own Gmail**. That needs a Google Cloud OAuth client (one-time setup by the site owner):

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. **APIs & Services → Enable APIs**: enable the **Gmail API**.
3. **OAuth consent screen**: External, app name = NexApply, add scopes `openid`, `email`, and `https://www.googleapis.com/auth/gmail.send`. While the app is in Google "testing" status, add each user as a **test user** (works immediately for a limited number of users). For a fully public launch, Google requires an **app verification** review for the gmail.send scope — plan for that before opening to everyone.
4. **Credentials → Create OAuth client ID (Web application)** with this **Authorized redirect URI**:
   `https://YOUR-DOMAIN/api/auth/google/callback` (for local testing: `http://localhost:3000/api/auth/google/callback`).
5. Paste the **Client ID** and **Client Secret** into **Admin > Settings** and save.

How it works for users: a user connects the Google account **with the same email they signed up with** (a mismatch is rejected with a clear message). The site receives a refresh token (stored server-side only) and the `gmail.send` permission — it can send mail as that user, but **cannot read their inbox** and never sees their Google password. Users can disconnect at any time (Settings → Disconnect), which also turns their auto-apply off.

Until Client ID/Secret are set, the Connect button honestly shows "not set up yet".

## Auto-apply rules (as built)

- Per-user toggle, **default OFF**, with an explicit consent line; turning it on requires a connected Google account and an uploaded CV.
- A background engine runs every 15 minutes, and also when a new job is added or a user turns the toggle on.
- Only **email-apply** jobs, only when the job's match % is at or above the Admin threshold (**default 60%**), and only up to the Admin daily cap per user (**default 10/day**).
- An application is sent **once per user + job, ever** — re-running the engine never re-sends. Sent applications appear in the user's history as **Applied (Auto)** with the date.
- If sending fails (e.g. the user revoked Google access), that user's auto-apply is flagged **"needs attention"** and the engine stops trying until they reconnect.
- Portal-apply jobs are **never** auto-applied; the UI says this plainly.

## DEMO_GOOGLE — test hook warning

`DEMO_GOOGLE=1` is a **testing-only** environment flag. With it set, "Connect Google" instantly marks the user as connected (as their own email), and application "sends" are written to `data/outbox.log` instead of going through the real Gmail API. It exists so the whole auto-apply flow can be tested end-to-end **without** the owner's Google Cloud setup. **Never run a public/production instance with `DEMO_GOOGLE=1`** — no real email is sent in that mode.

## Hosting notes (free Render, owner's usual route)

- Deploy as a Node web service (`npm install`, start `node server.js`); Render sets `PORT` automatically.
- **Free-plan warning (important):** Render's free tier sleeps after ~15 minutes idle (first visit can take ~1 minute) and has **no persistent disk** — on every restart/deploy the whole database (users, jobs, settings, admin account) **resets** and a new admin setup code is printed in the Render logs. Fine for testing, **not** for real users.
- For real users, use a paid instance **with a persistent disk** mounted so `data/` and `uploads/` survive restarts (Render Starter + 1 GB disk was ~$7.25/month when quoted on 2026-11-03 — only with the owner's explicit approval).
- Put the site behind its final domain before configuring Google OAuth, and add that domain's callback URI in Google Cloud.

## Project layout

```
server.js        — the whole backend (API, auth, matching, auto-apply engine)
public/          — index.html + app.js (user site), admin.html + admin.js (hidden admin), style.css
data/db.json     — database (auto-created; do not ship a used copy)
uploads/         — user CV files (per-user, never public)
package.json     — dependency: nodemailer only
```
