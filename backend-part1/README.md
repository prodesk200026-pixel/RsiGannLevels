# Gamma X — Unified Backend (Part 1: core)

Core server only: boot, Dhan REST auth, auto token renewal, instrument
resolution. This is the same Part 1 that already lives inside the full
`backend.zip` — this standalone copy is for if you want to deploy/test
just the core first, or re-check it in isolation.

## Files
- `src/config.js` — every tunable number (weights, thresholds, exit plan, poll intervals)
- `src/dhanClient.js` — Dhan v2 REST wrapper (quote, option chain, renew token)
- `src/instruments.js` — resolves NIFTY/BANKNIFTY/SENSEX security IDs from Dhan's live scrip master (no guessed IDs)
- `src/tokenRenewer.js` — auto-calls `/v2/RenewToken` every ~20h (Dhan has no TOTP auto-login like Angel One — this is the closest equivalent)
- `src/server.js` — Express app: `/health`, `/api/status`, `/api/instruments`, `/api/expiries/:underlying`. Also auto-loads a `registerPart2.js` if one is dropped into `src/` later — none is included here, so it runs Part 1 only.

## Deploy (GitHub -> Render)
1. Push this folder as a repo (GitHub web "Upload files", not paste — avoids mobile truncation).
2. Render -> New -> Web Service -> connect repo -> reads `render.yaml` automatically.
3. Set env vars in Render dashboard: `DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN` at minimum.
4. Test `https://<your-service>.onrender.com/health` -> `{"ok":true,...}`.
5. Test `/api/status` -> check `dhan.hasCredentials: true` and `lastAuthError: null`.

## Render free-tier sleep
Free plan spins down after ~15 min idle; first request after that returns
Render's HTML "waking up" page instead of JSON. Fix: ping `/health` every
5 minutes via [cron-job.org](https://cron-job.org).

## This is Part 1 only
Order-flow engine, GEX/hidden-Greeks engine, signal card, push alerts,
`/ws/market`, and the Wall-Sniper-compatible route are in the full
`backend.zip` (Part 1 + Part 2 combined) delivered earlier in this chat.
