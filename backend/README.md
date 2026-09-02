# Gamma X — Unified Backend (Part 1 + Part 2, COMPLETE)

One backend, deployed once, that every Gamma X PWA frontend can point at.

## Files
- `config.js` — every tunable number (weights, thresholds, exit plan, poll speed)
- `dhanClient.js` — Dhan v2 REST wrapper (quote, option chain, renew token)
- `instruments.js` — resolves NIFTY/BANKNIFTY/SENSEX security IDs from Dhan's live scrip master
- `tokenRenewer.js` — auto-calls `/v2/RenewToken` every ~20h (no manual regeneration)
- `orderFlowEngine.js` — rolling-window order-flow proxy: tick/price/volume velocity, directional pressure, liquidity consumption, displacement (x ATR), structure (swing/BOS), impulse score 0-100, min-confirmation noise filter
- `greeksEngine.js` — Black-Scholes plain + hidden Greeks (vanna/charm/vomma/speed/color/zomma), OI-weighted whole-chain GEX, gamma-flip strike, call/put walls, dealer regime (long/short gamma)
- `signalEngine.js` — combines order flow + GEX regime + walls into final BUY CALL / BUY PUT / WAIT card + your fixed exit plan (SL -35%, book half at 2x, trail 30% from peak). Confidence score, never a win-rate claim.
- `push.js` — VAPID web push, alert cooldown
- `wsHub.js` — `/ws/market` broadcasts live JSON to all connected PWAs
- `marketPoller.js` — the heartbeat: polls Dhan REST, feeds engines, stores latest snapshot per underlying
- `registerPart2.js` — wires all of the above into Express routes (auto-loaded by `server.js`)
- `server.js` — boots everything

## Endpoints
- `GET /health`, `GET /api/status`, `GET /api/config`
- `GET /api/instruments`, `GET /api/expiries/:underlying`
- `GET /api/market/:symbol` — spot/LTP
- `GET /api/orderflow/:symbol` — full order-flow proxy metrics
- `GET /api/options/:symbol` — GEX/dealer regime/walls/hidden Greeks per strike
- `GET /api/depth/:symbol` — imbalance + liquidity consumption + walls
- `GET /api/signals` (all) / `GET /api/signals/:symbol` — the final entry card
- `GET /wall-sniper-signal?index=NIFTY` — **compat route**: point your existing Wall Sniper PWA's URL field at this backend and it keeps working unmodified
- `WS /ws/market` — live push for any frontend
- `POST /api/push/subscribe`, `POST /api/push/unsubscribe`, `POST /api/push/test`, `GET /api/push/status`
- `GET /api/_debug/optionchain/:underlying` — raw Dhan response, use this if field names in `marketPoller.js`'s `normalizeChain()` need adjusting against your live account

## IMPORTANT — how live data is fetched
This build polls Dhan's REST batch **Quote** endpoint every 2s and **Option Chain**
every 5s, rather than the raw WebSocket binary tick/depth feed. The binary
protocol needs byte-level testing against a *live funded account* to parse
correctly — I can't do that myself, and a silently-wrong binary parser is worse
than a slightly slower REST poll. This still gives you genuinely live,
continuously-updating data (2-5s granularity), which is what the order-flow
proxy and GEX engine are built to consume. If you want true tick-by-tick later,
that's an isolated upgrade to `marketPoller.js` only — nothing else changes.

## Deploy (GitHub -> Render)
1. Push this folder as a repo (use GitHub's "Upload files" web UI, not paste — avoids mobile truncation).
2. Render -> New -> Web Service -> connect repo -> reads `render.yaml` automatically.
3. Set env vars in Render dashboard: `DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN` (from Dhan web console, Data APIs tab), and `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (generate once: `npx web-push generate-vapid-keys`).
4. Test `/health`, then `/api/status` (check `dhan.hasCredentials: true`, `lastAuthError: null`), then `/api/_debug/optionchain/NIFTY` to confirm real option-chain data is flowing.
5. Point EVERY existing PWA's backend-URL field at this one service. Wall Sniper uses `/wall-sniper-signal` automatically; the new Impulsive Order Flow PWA (Part 2 of this delivery) uses `/api/signals/:symbol` and `/ws/market`.

## Render free-tier sleep (root cause of your "backend unreachable" screenshots)
Free plan spins down after ~15 min idle; first request after that returns Render's
HTML "waking up" page instead of JSON (`Unexpected token '<'`). Fix: a
[cron-job.org](https://cron-job.org) ping hitting `/health` every 5 minutes — same
pattern you already use elsewhere.

## Dhan token — the one real limitation
Dhan does not have a TOTP/API-key silent-login flow like Angel One. You still
generate ONE access token manually, once, from the Dhan web console (Data APIs
tab). `tokenRenewer.js` then keeps that same token alive indefinitely via
`/v2/RenewToken` every ~20h — you should not need to go back to the Dhan
console again unless the token is manually revoked from their side.
