# Nokael Driver — Web (PWA)

A web version of the Android **Nokael Driver** app, for drivers who don't have the
Android app installed or whose phone is not Android (iPhone included). It uses the same
backend as the Android app (the Supabase `driver_*` functions), the same job rules and
the same screens, so a driver can switch between the two mid-job.

## What's the same as the Android app

| Area | Behaviour |
|---|---|
| Sign in | Phone/email → password (`driver_login`), same error messages, 15-min lockout countdown, "Call dispatch" link. Session kept between visits (`driver_me` on open, retry screen when offline). |
| Home | Online/offline toggle, stats (today's jobs, completed, earnings), active + upcoming jobs, "Cancelled by dispatch" list, polling every 25 s while on screen. |
| Job execution | Progress and details cards, the one big next-step button (I AM HERE → PICK UP → I AM HERE → DROP OFF → COMPLETE JOB), Navigate, Call client, Dispatch sheet (call / message), remarks (auto-saved after typing stops), Return package. |
| Hand-off OTP | 6-digit keypad, auto-submit, wrong-code flash, lock after 5 wrong codes → "Call Dispatch". |
| Return | Required reason with quick-pick chips, `driver_return_job`. |
| Result | Job Complete / Return Initiated / Job Cancelled (shown automatically if dispatch cancels mid-job). |
| Offline | Last job list shown with no signal; "I am here" taps made with no signal are queued and sent when the connection returns. |
| Live location | Sent to dispatch every ~10 s while signed in, online and location is allowed (`driver_publish_location` / `driver_stop_location`). |

The Kotlin → web mapping is 1:1: `src/logic/*` mirrors `app/src/main/java/com/nokael/driver/logic`,
`src/ui/screens/*` mirrors `ui/screens`. A change to one app's rules should be made in both.

## Web-only differences (platform limits)

- **Live location only while the app is open on screen.** Browsers don't allow a
  background location service like the Android foreground service. The server already
  treats a stale position as offline. Drivers should keep the app open while driving.
- **Location needs HTTPS.** Browsers only give location on `https://` (or `localhost`).
- The session token is kept in the browser's local storage (Android uses the encrypted
  Keystore). Signing out, or dispatch ending the session, clears it.
- "Add to home screen" is offered on the login screen (Android Chrome: install button;
  iPhone: Share → Add to Home Screen). Once added it opens full-screen like an app.
- Return Package is blocked with a short message before pickup / after delivery
  instead of opening a screen the server would reject.

## Where it lives

Drivers open **https://coc.nokael.com/driver-app/**. This folder sits inside the
Confirmation Portal repo, and the portal's Render service builds and serves it:

- `npm run build` in the portal root runs `build:driver`, which builds this app into
  `dist/driver-app` (base path `/driver-app/`, set in `vite.config.ts`).
- `server.ts` serves it; extension-less paths under `/driver-app/` return its `index.html`.
- It has its own service worker (scope `/driver-app/`) and manifest, separate from the portal's.

## Setup

```bash
cd driver-app
npm install
cp .env.example .env    # same values as the Android local.properties
npm run dev             # http://localhost:5180/driver-app/
```

The app always talks to the live Supabase backend; `VITE_SUPABASE_ANON_KEY` must be set.

## Deploy (Render)

The Render build reads the same environment as the portal. `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` are shared (same Supabase project). One extra variable is
required on the Render service:

- `VITE_DISPATCH_PHONE` — the number behind Call / Message dispatch.

The driver build refuses to build without the anon key or a dispatch number (the
same rule as the Android release build), so a missing variable fails the deploy
instead of shipping a broken app.

## Icons

`npm run icons` regenerates `public/icons/*` from the Android launcher glyph (pure Python, no dependencies).
