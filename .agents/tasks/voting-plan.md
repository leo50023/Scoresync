# Implementation Plan — Audience Voting (People's Choice Award)

## Codebase findings

- **Framework**: Express + Handlebars (`.xian` = `.hbs`). ESM (`type: module`). No build step; verify with `node --check`.
- **CSRF**: `middleware/csrf.js` is a no-op stub — both middleware functions just call `next()`. Replace it with functional CSRF protection (or an equivalent route-appropriate defense) before enabling state-changing voting routes; do not treat the current stub as protection.
- **Firestore**: accessed via `import { db } from '../models/firebaseConfig.js'` + named `firebase/firestore` imports (see scoringController.js lines 1–6).
- **Flash messages**: `req.flash('success_msg', '...')` / `req.flash('error_msg', '...')` — session-based, exposed as `res.locals.success_msg` / `res.locals.error_msg`.
- **Dropdown mechanism**: `show.xian` has two hidden `<div id="admin-more-content" data-dropdown ...>` and `<div id="org-more-content" data-dropdown ...>` at the bottom of the file (~lines 1031–1059). Items use class `dropdown-item`. Toggle forms inside use `<form method="POST">...<button class="dropdown-item">`.
- **results.xian insert point**: after the `Judge Scoring Progress` section, before `Per-Judge Breakdown` (~line 538).
- **`resultsPage`** in scoringController.js already fetches 4 snapshots via `Promise.all` — extend to 5 to include votes.
- **Voting results policy**: public live tallies can influence later voters. Do not expose vote counts while voting is open; reveal tallies on the public page and endpoint only after voting closes.

---

- [ ] 1. **Create `controllers/votingController.js`** with all 5 exported async handlers.

  Imports: `import { db } from '../models/firebaseConfig.js'`; import the Firestore document, collection, query, transaction, and timestamp functions needed by the implementation; `import crypto from 'crypto'`.

  **`votingPage` (GET)**: fetch and validate the event, then fetch contestants. Only fetch/aggregate votes when voting is closed; while open, pass zero counts so neither the page nor public responses reveal live standings. Compute `votingOpen = event.votingOpen === true`, `maxVotes`, and `totalVotes`. Render `voting/index` passing: `title`, `event` (with `.id`), `contestants` (sorted by `Number(c.number)`), `votingOpen`, and the count data. Return the repository-standard not-found response for a missing event.

  **`submitVote` (POST)**:
  - Validate the event and sanitize `contestantId = String(req.body.contestantId || '').trim()`; reject missing/malformed IDs and IDs longer than 128 characters (do not silently truncate), then verify the contestant document exists under this event.
  - Use the existing request IP handling (verify trusted-proxy configuration) plus user-agent to derive a SHA-256 fingerprint. Treat this only as a duplicate-vote deterrent, not identity verification: shared networks may collide and clients can change/clear these values.
  - Do not silently fingerprint a missing/empty client IP as a shared value; fail explicitly or use a documented alternative identity/rate-limiting strategy. Add a reasonable per-client submission rate limit to reduce automated abuse.
  - Do not store or log the raw IP. Store only the fingerprint digest, contestant ID, and server timestamp; document the digest's retention period and delete vote records after the results/appeals retention window.
  - Make event-open validation, contestant existence validation, and duplicate detection/write atomic in a Firestore transaction. Use a deterministic vote document ID derived from the event-scoped fingerprint, and have the transaction read the event, contestant, and vote documents before creating the vote. This prevents concurrent submissions with the same fingerprint from both succeeding.
  - If the event is missing, voting is closed, contestant is invalid, or a vote already exists, return an explicit appropriate response/flash and redirect. Surface unexpected Firestore failures using the repository's standard error handling; do not silently convert them into success.
  - On success, flash `'Your vote has been cast!'` and redirect to `/events/${eventId}/vote`.

  **`voteResults` (GET)**: redirect to `/events/${eventId}/vote` (voting page already shows results; no separate view needed).

  **`toggleVoting` (POST)**: require authentication and admin/organizer role at the route, then perform an event-scoped authorization check using the same ownership/assignment rule as existing event edit/delete handlers. Reject missing events and users not assigned to the event. Update `votingOpen`, flash the resulting state, and redirect to `/events/${eventId}`.

  **`voteCounts` (GET)**: fetch the event first and set `Cache-Control: no-store`. While voting is open, return an explicit `resultsAvailable: false` response without counts. Once closed, return contestant vote totals and total votes with `resultsAvailable: true`. Do not use a zero-total response to imply there are no votes when results are merely withheld.

  Files: `controllers/votingController.js` (new)
  Verify: `node --check controllers/votingController.js`; add focused tests for transaction validation, duplicate and concurrent submissions, public tally withholding, and rate limiting.

---

- [ ] 2. **Add 5 routes to `routes/index.js`**

  Add a new import block at the top with the other controller imports:
  ```js
  import {
    votingPage, submitVote, voteResults, toggleVoting, voteCounts,
  } from "../controllers/votingController.js";
  ```

  Add a new `// ─── Audience Voting ──` section **before** the `// Public routes — no login required` block in the Scoring section (i.e. before `router.get("/events/:eventId/display", ...)`):
  ```js
  router.get( "/events/:eventId/vote",         votingPage);
  router.post("/events/:eventId/vote",         submitVote);
  router.get( "/events/:eventId/vote/results", requireAuth,                                  voteResults);
  router.post("/events/:eventId/vote/toggle",  requireAuth, requireRole("admin","organizer"), toggleVoting);
  router.get( "/events/:eventId/vote/counts",  voteCounts);
  ```
  Ensure both voting state-changing routes use functional CSRF protection and that the vote form supplies a valid token. The current CSRF middleware is a no-op and must not be relied upon.

  Files: `routes/index.js`, `middleware/csrf.js` (if the current no-op must be replaced), relevant CSRF tests
  Verify: `node --check routes/index.js`; test CSRF rejection and that authentication, role, and event-scoped authorization reject unauthorized voting toggles.

---

- [ ] 3. **Create `views/voting/index.xian`** — standalone public voting page

  Structure (no sidebar, use `{{> head }}` + `{{> navbar }}` only):
  ```
  {{> head }}
  <body class="min-h-screen" style="background:#0a0f1e">
  {{> navbar }}
  <main class="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
    ...
  </main>
  </body>
  ```

  Sections in order:

  **a. Flash banners**: `{{#if success_msg}}<div class="alert-success">...</div>{{/if}}` and `{{#if error_msg}}<div class="alert-error">...</div>{{/if}}`.

  **b. Hero header**: `card-flat` with gradient background (`linear-gradient(135deg,#0f2156,#1a56db)`). Show `event.name`, subtitle `People's Choice Award`, heart SVG (`M20.84 4.61a5.5 5.5...`), and either a green `badge-green` "Voting Open" or a `badge-gray` "Voting Closed" badge based on `{{#if votingOpen}}`.

  **c. Voting closed banner** (shown when `!votingOpen`): `<div class="alert-error animate-fadeup">Voting is currently closed. Check back later.</div>`.

  **d. Already-voted banner** (`id="voted-banner"`, hidden by default, shown by JS): `<div id="voted-banner" class="alert-success animate-fadeup" style="display:none">✓ You already voted! Thank you for participating.</div>`.

  **e. Contestant grid**: `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">`. Each card (`card-flat`, `overflow-hidden`):
  - Photo (`{{#if photo}}<img src="{{photo}}"...>{{else}}<div ...>{{number}}</div>{{/if}}`).
  - Number badge top-left (same style as show.xian: `w-7 h-7 rounded-full ... bg-blue-600`).
  - Name + barangay at bottom.
  - Add `data-contestant-id="{{id}}"` to each contestant card for safe count refresh updates.
  - Vote count bar and label: show them only when voting is closed; while open, do not render public counts or bars. Attach `voteCount` and `voteBarPct` in the controller after close, with a zero-safe denominator.
  - Vote button: POST form to `/events/{{event.id}}/vote`:
    ```html
    <form method="POST" action="/events/{{event.id}}/vote">
      <input type="hidden" name="_csrf" value="{{csrfToken}}">
      <input type="hidden" name="contestantId" value="{{id}}">
      <button type="submit"
        class="vote-btn btn-primary w-full text-sm mt-2"
        data-id="{{id}}"
        {{#unless votingOpen}}disabled{{/unless}}>
        Vote ♥
      </button>
    </form>
    ```

  **f. QR Code section**: below the grid, a card with a `'Show QR Code'` button and overlay (`id="qr-overlay"`): fixed fullscreen, dark backdrop, centered white card containing `<canvas id="qr-canvas">` and a close button. Prefer a locally bundled QR library if supported by the existing asset setup. Load it lazily once when the overlay opens; if using a CDN, pin an exact version, use integrity/crossorigin attributes where supported, and account for the app's CSP. Show a visible, retryable error if loading or QR generation fails. Keep the encoded voting URL same-origin and use `textContent` for dynamic status text.

  **g. Client-side localStorage + closed-results refresh script** (inline `<script>` at bottom of `<main>`):
  ```js
  (function() {
    const STORAGE_KEY = 'ss_voted_' + '{{event.id}}';
    // UX hint only; server-side atomic duplicate detection is authoritative.
    if (localStorage.getItem(STORAGE_KEY)) {
      document.getElementById('voted-banner').style.display = '';
      document.querySelectorAll('.vote-btn').forEach(function(b) { b.disabled = true; b.textContent = '✓ Voted'; });
    }
    // After success flash, mark voted in localStorage
    const successEl = document.querySelector('.alert-success');
    if (successEl && successEl.textContent.includes('vote has been cast')) {
      localStorage.setItem(STORAGE_KEY, '1');
      document.querySelectorAll('.vote-btn').forEach(function(b) { b.disabled = true; b.textContent = '✓ Voted'; });
    }
    // Refresh results only after the server says they are available.
    const EVENT_ID = '{{event.id}}';
    function refreshCounts() {
      fetch('/events/' + EVENT_ID + '/vote/counts')
        .then(function(r) {
          if (!r.ok) throw new Error('Vote-count request failed: ' + r.status);
          return r.json();
        })
        .then(function(data) {
          if (!data.resultsAvailable) return;
          const votes = data.votes;
          const maxVal = Math.max(1, ...Object.values(votes).map(Number));
          document.querySelectorAll('[data-contestant-id]').forEach(function(card) {
            const cid = card.dataset.contestantId;
            const countEl = document.getElementById('count-' + cid);
            const barEl   = document.getElementById('bar-' + cid);
            const count = Number(votes[cid] || 0);
            if (countEl) countEl.textContent = count + ' votes';
            if (barEl) barEl.style.width = Math.round((count / maxVal) * 100) + '%';
          });
        })
        .catch(function(error) {
          console.error('Unable to refresh audience vote results.', error);
          const status = document.getElementById('vote-refresh-status');
          if (status) status.textContent = 'Vote results could not be refreshed. Retrying soon.';
        });
    }
    document.addEventListener('DOMContentLoaded', function() {
      refreshCounts();
      let refreshTimer;
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
          clearInterval(refreshTimer);
        } else {
          refreshCounts();
          refreshTimer = setInterval(refreshCounts, 10000);
        }
      });
      refreshTimer = setInterval(refreshCounts, 10000);
    });
  })();
  ```

  Files: `views/voting/index.xian` (new), `views/voting/` directory (new)
  Verify: start server, visit `http://localhost:3000/events/<id>/vote` without auth, confirm the page renders and voting works; verify the CSRF token is accepted, no counts are exposed while open, counts appear after close, and QR failures have a visible recovery path.

---

- [ ] 4. **Update `views/events/show.xian`** — hero badge + dropdown items

  **4a. Hero voting badge**: Find `<span class="badge flex-shrink-0 mt-1 {{#if (eq event.status 'ongoing')}}badge-green...{{/if}}">{{event.status}}</span>` in the hero. Immediately after that `<span>` tag, add:
  ```handlebars
  {{#if event.votingOpen}}<span class="badge badge-green flex-shrink-0 mt-1 ml-1">♥ Voting Open</span>{{else}}<span class="badge badge-gray flex-shrink-0 mt-1 ml-1">Voting Off</span>{{/if}}
  ```

  **4b. admin-more-content** (`id="admin-more-content"`): Find the existing divider `<div style="height:1px;background:rgba(255,255,255,0.07);margin:4px 0"></div>` that precedes the Delete Event form. Insert these two items **before** that divider:
  ```html
  <a href="/events/{{event.id}}/vote" class="dropdown-item">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    Audience Voting
  </a>
  <form method="POST" action="/events/{{event.id}}/vote/toggle">
    <input type="hidden" name="_csrf" value="{{csrfToken}}">
    <button type="submit" class="dropdown-item w-full text-left">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      {{#if event.votingOpen}}Close Voting{{else}}Open Voting{{/if}}
    </button>
  </form>
  ```

  **4c. org-more-content** (`id="org-more-content"`): Add identical markup before its divider.

  Files: `views/events/show.xian`
  Verify: start server, log in as admin, navigate to `/events/:id`, confirm More dropdown shows "Audience Voting" link and "Open Voting" / "Close Voting" button. Confirm voting badge appears in hero.

---

- [ ] 5. **Update `controllers/scoringController.js` — `resultsPage`** to fetch votes

  Extend the existing `Promise.all` from 4 items to 5:
  ```js
  const [eSnap, cSnap, crSnap, sSnap, vSnap] = await Promise.all([
    getDoc(doc(db, "events", eventId)),
    getDocs(collection(db, "events", eventId, "contestants")),
    getDocs(collection(db, "events", eventId, "criteria")),
    getDocs(collection(db, "events", eventId, "scores")),
    getDocs(collection(db, "events", eventId, "votes")),   // NEW
  ]);
  ```

  After `const allScores = sSnap.docs.map(d => d.data());` add:
  ```js
  const allVotes = vSnap.docs.map(d => d.data());
  const votesByContestant = {};
  allVotes.forEach(v => {
    if (v.contestantId) votesByContestant[v.contestantId] = (votesByContestant[v.contestantId] || 0) + 1;
  });
  const totalAudienceVotes = allVotes.length;
  ```

  After the existing judge-ranking/tie-breaking logic, build a separate `audienceRanked` array from the contestants. Attach `audienceVoteCount` and `audienceVotePct` to each contestant, sort by audience vote count descending and contestant number ascending for deterministic display, and assign equal audience counts the same rank. Keep the existing judge-ranked array and rank behavior unchanged. Add `audienceResultsAvailable = event.votingOpen !== true`; include `votesByContestant`, `totalAudienceVotes`, `audienceRanked`, and `audienceResultsAvailable` in the `res.render` call object. Do not show audience standings on this page until voting has closed.

  Files: `controllers/scoringController.js`
  Verify: `node --check controllers/scoringController.js`; verify a zero-vote contestant gets a zero-width bar and equal vote totals are ranked consistently.

---

- [ ] 6. **Update `views/scoring/results.xian`** — add People's Choice section

  Insert the following section **after** the closing `</div>` of the `<!-- ── Judge Scoring Progress ──` section (`{{/if}}` block that ends around line 537) and **before** the `<!-- ── Per-Judge Breakdown ──` section:

  ```handlebars
  <!-- ── People's Choice — Audience Vote ── -->
  {{#if audienceResultsAvailable}}
  {{#if totalAudienceVotes}}
  <div class="section-card animate-fadeup-2 no-print">
    <div class="section-header">
      <h2>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e11d48" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        People's Choice
        <span class="badge badge-red text-xs ml-2">Audience Vote</span>
      </h2>
      <span class="badge badge-gray text-xs">{{totalAudienceVotes}} votes cast</span>
    </div>
    <div class="px-5 py-4 space-y-3">
      {{#each audienceRanked}}
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-extrabold flex-shrink-0 shadow-sm" style="background:linear-gradient(135deg,#881337,#e11d48)">{{audienceRank}}</div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-sm truncate" style="color:#e2e8f0">{{name}}</div>
          <div class="mt-1 h-2 rounded-full overflow-hidden" style="background:rgba(255,255,255,0.08)">
            <div class="h-full rounded-full transition-all duration-700" style="background:linear-gradient(90deg,#be185d,#f43f5e);width:{{audienceVotePct}}%"></div>
          </div>
        </div>
        <div class="text-sm font-extrabold flex-shrink-0" style="color:#f43f5e">{{audienceVoteCount}} votes</div>
      </div>
      {{/each}}
    </div>
  </div>
  {{/if}}
  {{/if}}
  ```

  Use the separate audience ranking so judge order cannot obscure the People's Choice winner. Keep the section hidden when there are no audience votes. Do not register or override Handlebars' built-in `lookup` helper; pass the rendered count directly on each contestant.

  Files: `views/scoring/results.xian`, `controllers/scoringController.js`
  Verify: start server, navigate to `/events/:eventId/results`, and confirm the section orders by audience votes (not judge rank), tie ranks match, bars reflect percentages, it is hidden when no votes exist, and judges' results remain unchanged.

---

- [ ] 7. **Add focused voting tests**

  Use the repository's existing test runner and conventions. Cover:
  - missing event, closed voting, malformed contestant ID, and contestant from another event;
  - successful vote and repeat vote, including two concurrent requests with the same fingerprint (exactly one succeeds);
  - missing/non-assigned event organizer and insufficient role on voting toggle;
  - public vote counts withheld while voting is open and available after close;
  - vote page rendering, audience ranking/ties/zero votes, localStorage as UX-only, and QR library load/generation failure feedback.

  Files: relevant existing test files or focused new voting tests
  Verify: run the narrow voting test suite, then the repository's relevant lint/type/syntax checks. Do not rely on `node --check` alone for behavior.

---

- [ ] 8. **Commit and push**

  ```
  git -C c:\Users\ACER\Downloads\https-github.com-MSWDO11-ScoreSync1.0.1-main add -A
  git -C c:\Users\ACER\Downloads\https-github.com-MSWDO11-ScoreSync1.0.1-main commit -m "feat: audience QR voting — People's Choice Award"
  git -C c:\Users\ACER\Downloads\https-github.com-MSWDO11-ScoreSync1.0.1-main push origin master
  ```

  Files: git operations only
  Verify: `git log --oneline -1` confirms the commit exists; `git push` completes without error.

---

## Dependency order

1 → 2 (routes import the controller) → 3 (view) → 4, 5 (controller/results integration), 6 (view integration), 7 (tests) → 8 (commit)

Items 4, 5, and 6 can be developed in parallel after steps 1–3; tests in step 7 should validate the integrated behavior. All implementation and tests must pass before step 8.
