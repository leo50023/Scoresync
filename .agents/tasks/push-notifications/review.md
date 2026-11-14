# Web Push Notifications — Code Review

**Commit:** `82387aa` feat: Web Push notifications  
**Verdict:** APPROVED

---

## Evidence Summary

### 1. `package.json` — `web-push` added ✅
`"web-push": "^4.0.0"` added to `dependencies`. Commit message confirms package is present in `node_modules`.

### 2. `utils/pushNotifications.js` — VAPID setup + helper ✅
- Calls `webpush.setVapidDetails(process.env.VAPID_EMAIL, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY)` — all from env vars, no hardcoded secrets.
- Exports `sendPushNotification(subscription, payload)` with an internal `try/catch` that logs and swallows errors.
- Module is only imported dynamically (`await import(...)`) so a missing env var at module load is caught by the outer try/catch in the controller.

### 3. `routes/index.js` — POST `/api/push/subscribe` ✅
- Route at line 12: `router.post('/api/push/subscribe', requireAuth, async (req, res) => {...})`
- `requireAuth` middleware (middleware/auth.js:6) checks `req.session?.userId` and redirects to `/login` if absent — authentication enforced.
- Validates `subscription.endpoint` presence, returns 400 on missing; saves via `arrayUnion(JSON.stringify(subscription))` to Firestore `pushSubscriptions` field.
- Errors caught, returns 500 JSON.

### 4. `controllers/userController.js` — push in approve/reject ✅
- `approveUser`: push block at ~line 107, wrapped in its own `try/catch`; executes after email send; `JSON.parse` inside same try block — a corrupt stored subscription throws and is caught without breaking the approval flow.
- `rejectUser`: identical pattern at ~line 164.
- Both functions' push blocks are inside a separate `try/catch` that is itself inside the outer function `try/catch` — existing approval/rejection response (`req.flash` + `res.redirect`) is unreachable from push errors.

### 5. `public/sw.js` — push event handlers + cache bump ✅
- Cache version bumped from `scoresync-static-v14` to `scoresync-static-v15`.
- `push` event listener added: parses JSON payload, shows notification with title/body/icon/badge/vibrate/tag/renotify.
- `notificationclick` listener added: closes notification, focuses existing window or opens new one using `data.url`.

### 6. `views/partials/head.xian` — frontend subscription logic ✅
- Added after SW registration block.
- Guards against non-push-capable browsers (`PushManager`, `serviceWorker` checks).
- Skips `/login`, `/register`, `/` paths — only runs on authenticated pages.
- Requests permission 3s after load; subscribes via `PushManager`, POSTs to `/api/push/subscribe`.
- Re-sends existing subscription to server on each load in case it was lost.

---

## Security Checks

| Check | Result |
|---|---|
| `VAPID_PRIVATE_KEY` in `views/**` | Not present — grep confirmed no match |
| `VAPID_PRIVATE_KEY` in `public/**` | Not present — grep confirmed no match |
| `sendPushNotification` errors caught | ✅ — internal try/catch in helper + outer try/catch in controller |
| `/api/push/subscribe` requires auth | ✅ — `requireAuth` middleware applied |
| `.env` committed to git | Not tracked — `git ls-files .env` returned no match; `.gitignore` lists `.env` |

**Note on hardcoded VAPID_PUBLIC_KEY in `head.xian`:** The value `3A7odzRRC0s...` is the VAPID *public* key. By the Web Push spec this key is intentionally public and must be delivered to the browser to create a subscription — exposing it in frontend JS is correct and expected. The task spec permits the public key in the frontend ("uses VAPID_PUBLIC_KEY only (no private key in frontend)"). The `.env.example` was not updated with VAPID entries, but this is a documentation gap, not a correctness or security blocker per the stated requirements.

---

## All Required Behaviors Present
All 6 items from the approved task checklist are implemented and verified against the diff and current file state. No reachable correctness, security, or data failures introduced by this change.
