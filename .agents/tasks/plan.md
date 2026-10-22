# Implementation Plan — ScoreSync 3 Features

## Codebase findings

- **Framework**: Express + Handlebars (`.xian` = hbs templates). ESM (`type: module`). No build step.
- **Routing**: All routes in `routes/index.js`. Auth via `requireAuth` / `requireRole` from `middleware/auth.js`.
- **Controllers**: Named async exports. Firebase accessed via `db` from `models/firebaseConfig.js` + `firebase/firestore` functions.
- **Scoring logic**: `resultsPage`, `displayBoard`, `publicResults`, `exportResults` all repeat the same ranking computation inline — the new `scoresJson` endpoint follows the same pattern.
- **`applyTieBreaking(ranked, criteria)`**: shared helper already in `scoringController.js`, reused by new endpoints.
- **DOM safety**: The existing judge-progress updater in `results.xian` uses `document.createElement` (not `innerHTML`) — the new polling renderer must follow the same pattern.
- **CRITERIA_COLORS**: array at top of `scoringController.js`, used by all ranking functions.
- **Existing refresh**: a `<select id="autoRefreshInterval">` + countdown span + a `<script>` that does `window.location.reload()` — this entire block is removed and replaced.
- **Admin dashboard Quick Actions**: a `.p-3.space-y-1` container with four `<a>` link-rows — backup goes as a fifth entry.

---

## Feature dependency order

FEAT-001, FEAT-002, and FEAT-003 are independent of each other. FEAT-001 and FEAT-002 both touch `scoringController.js` and `routes/index.js` — implement them sequentially (FEAT-001 first, then FEAT-002) to avoid merge conflicts. FEAT-003 is fully independent and is implemented last.

---

## FEAT-001 — Real-time Results Polling

- [ ] 1. **Add `scoresJson` to `controllers/scoringController.js`**
      Copy the Firestore fetch + ranking computation from `resultsPage` (four-way `Promise.all` for event/contestants/criteria/scores). Compute `ranked` array with full `breakdown`, `finalScore`, `finalScoreDisplay`, `gapToFirst`, `rank` fields. Call `applyTieBreaking`. Build `judgeCount` from `judgeMap`. Return `res.json({ event: { id: ev.id, name: ev.name }, ranked, criteria, judgeCount })`. Export as `export const scoresJson = async (req, res) => {...}`.
      Files: `controllers/scoringController.js`
      Verify: `node --check controllers/scoringController.js`

- [ ] 2. **Register route `GET /events/:eventId/scores-json`**
      Add `scoresJson` to the destructured import from `scoringController.js` in `routes/index.js`. Add `router.get('/events/:eventId/scores-json', requireAuth, scoresJson);` after the `resultsPage` route.
      Files: `routes/index.js`
      Verify: `node --check routes/index.js`

- [ ] 3. **Replace the auto-refresh dropdown in `views/scoring/results.xian` sticky bar**
      Remove the `<div class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl ...">` block containing `#autoRefreshInterval` select and `#refreshCountdown` span. Replace with the live-indicator + pause/resume control:
      ```html
      <div id="live-bar" class="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs no-print"
           style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1)">
        <span id="live-dot" class="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block"
              style="flex-shrink:0"></span>
        <span id="live-label" class="font-bold" style="color:#34d399">Live</span>
        <button id="pause-btn" onclick="toggleLivePoll()"
                class="btn-sm btn-sm-gray text-xs ml-1" style="min-height:unset;padding:2px 8px">
          Pause
        </button>
      </div>
      ```
      Also add the Announce link (no-print, gold) in the same flex row, after the Export CSV button:
      ```html
      <a href="/events/{{event.id}}/announce"
         class="btn-sm btn-sm-gold text-xs no-print">&#127881; Announce</a>
      ```
      Files: `views/scoring/results.xian`
      Verify: View the results page — no dropdown visible, green pulsing dot present.

- [ ] 4. **Add `id` anchors to the podium and standings sections**
      Add `id="podium-container"` to the outer `<div class="card-flat overflow-hidden animate-fadeup">` wrapping the podium. Add `id="standings-container"` to the `<div class="space-y-3 animate-fadeup-1">` wrapping the full ranked list.
      Files: `views/scoring/results.xian`
      Verify: Browser DevTools — `document.getElementById('podium-container')` and `document.getElementById('standings-container')` return non-null.

- [ ] 5. **Replace the existing `<script>` auto-refresh block with the polling script**
      Remove the `<script>` block with `sel`/`cd`/`timer`/`secs` variables. Replace with:
      ```html
      <script>
      (function() {
        const EVENT_ID = "{{event.id}}";
        let paused = false;

        function toggleLivePoll() {
          paused = !paused;
          const dot   = document.getElementById('live-dot');
          const label = document.getElementById('live-label');
          const btn   = document.getElementById('pause-btn');
          if (paused) {
            dot.style.background   = '#f59e0b';
            dot.classList.remove('animate-ping');
            label.textContent      = 'Paused';
            label.style.color      = '#f59e0b';
            btn.textContent        = 'Resume';
          } else {
            dot.style.background   = '';
            dot.classList.add('animate-ping');
            label.textContent      = 'Live';
            label.style.color      = '#34d399';
            btn.textContent        = 'Pause';
            pollScores(); // immediate update on resume
          }
        }

        async function pollScores() {
          if (paused) return;
          try {
            const resp = await fetch('/events/' + EVENT_ID + '/scores-json');
            if (!resp.ok) return;
            const data = await resp.json();
            renderPodium(data.ranked);
            renderStandings(data.ranked);
          } catch(e) { /* silent */ }
        }

        // Build podium DOM safely (no innerHTML with user data)
        function renderPodium(ranked) {
          const container = document.getElementById('podium-container');
          if (!container) return;
          // Only re-render if data changed — compare JSON to avoid flicker
          const sig = ranked.map(r => r.rank + ':' + r.finalScoreDisplay).join(',');
          if (container.dataset.sig === sig) return;
          container.dataset.sig = sig;
          // Re-fetch the podium inner HTML via a helper that creates DOM nodes
          const top3 = [2, 1, 3].map(rank => ranked.find(r => r.rank === rank)).filter(Boolean);
          // Clear podium blocks area (keep header gradient)
          const podiumBlocks = container.querySelector('[data-role="podium-blocks"]');
          if (!podiumBlocks) return; // fallback: skip if structure not found
          podiumBlocks.innerHTML = ''; // safe — no user data inserted here directly
          top3.forEach(c => {
            const isFirst = c.rank === 1;
            const wrapper = document.createElement('div');
            wrapper.className = 'flex-1 text-center' + (isFirst ? ' -mt-6' : '') + ' max-w-[' + (isFirst ? '200' : '180') + 'px]';
            const score = document.createElement('div');
            score.className = 'font-black text-' + (isFirst ? '3xl text-yellow-600' : '2xl') + ' mt-3 leading-none';
            score.textContent = c.finalScoreDisplay + '%';
            wrapper.appendChild(score);
            podiumBlocks.appendChild(wrapper);
          });
        }

        // Build standings rows safely
        function renderStandings(ranked) {
          const container = document.getElementById('standings-container');
          if (!container) return;
          const sig = ranked.map(r => r.rank + ':' + r.finalScoreDisplay).join(',');
          if (container.dataset.sig === sig) return;
          container.dataset.sig = sig;
          // Keep the header row, replace only contestant cards
          const header = container.querySelector('.flex.items-center.justify-between.px-1');
          // Update contestant count badge
          if (header) {
            const badge = header.querySelector('.badge-blue');
            if (badge) badge.textContent = ranked.length + ' contestants';
          }
          // Remove existing contestant cards (all siblings after header)
          const cards = container.querySelectorAll('[data-contestant-card]');
          cards.forEach(el => el.remove());
          ranked.forEach(c => {
            const card = document.createElement('div');
            card.dataset.contestantCard = '1';
            card.className = 'card-flat overflow-hidden hover:shadow-md transition-shadow';
            const row = document.createElement('div');
            row.className = 'px-5 py-4 flex items-center gap-4';
            // Rank badge
            const rankBadge = document.createElement('div');
            rankBadge.className = 'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shadow-sm';
            rankBadge.textContent = c.rank;
            if (c.rank === 1) rankBadge.style.cssText = 'background:linear-gradient(135deg,#b45309,#f59e0b);color:#fff';
            else if (c.rank === 2) rankBadge.style.cssText = 'background:linear-gradient(135deg,#475569,#94a3b8);color:#fff';
            else if (c.rank === 3) rankBadge.style.cssText = 'background:linear-gradient(135deg,#92400e,#f97316);color:#fff';
            else rankBadge.style.cssText = 'background:#1e293b;color:#94a3b8';
            // Score
            const scoreEl = document.createElement('div');
            scoreEl.className = 'flex-shrink-0 text-right';
            const scoreNum = document.createElement('div');
            scoreNum.className = 'font-black text-xl';
            scoreNum.style.color = c.rank===1 ? '#ca8a04' : c.rank===2 ? '#94a3b8' : c.rank===3 ? '#ea580c' : '#3b82f6';
            scoreNum.textContent = c.finalScoreDisplay + '%';
            scoreEl.appendChild(scoreNum);
            // Name
            const info = document.createElement('div');
            info.className = 'flex-1 min-w-0';
            const name = document.createElement('div');
            name.className = 'font-extrabold text-sm leading-tight truncate';
            name.style.color = '#e2e8f0';
            name.textContent = c.name || '';
            info.appendChild(name);
            row.appendChild(rankBadge);
            row.appendChild(info);
            row.appendChild(scoreEl);
            card.appendChild(row);
            container.appendChild(card);
          });
        }

        // Make toggleLivePoll available globally (called by onclick in HTML)
        window.toggleLivePoll = toggleLivePoll;

        document.addEventListener('DOMContentLoaded', function() {
          pollScores();
          setInterval(function() { if (!paused) pollScores(); }, 8000);
        });
      })();
      </script>
      ```
      Add `data-role="podium-blocks"` attribute to the inner blocks wrapper `<div class="px-6 py-8"...>` that contains the podium columns, so the renderer can locate it.
      Files: `views/scoring/results.xian`
      Verify: DevTools Network — fetch to `/events/.../scores-json` fires every 8s; standings update without reload.

---

## FEAT-002 — Results Announcement Reveal Page

- [ ] 6. **Add `announcePage` to `controllers/scoringController.js`**
      Export `export const announcePage = async (req, res) => {...}`. Fetch event/contestants/criteria/scores via the same four-way `Promise.all` as `resultsPage`. Compute ranked identically (copy loop + sort + `applyTieBreaking` + rank assignment). Take top 3: `const top = ranked.slice(0, Math.min(ranked.length, 3))`. Reverse the array so iteration goes lowest → highest: `top.reverse()`. Serialize for the template: `const placementsJson = JSON.stringify(top.map(c => ({ rank: c.rank, name: c.name, barangay: c.barangay || '', number: c.number || '', photo: c.photo || '', finalScoreDisplay: c.finalScoreDisplay })))`. Call `res.render('scoring/announce', { title: 'Announce — ' + ev.name, event: ev, placementsJson, userName: req.session.userName, userRole: req.session.userRole, userInitial: (req.session.userName||'U')[0].toUpperCase(), isAdmin: req.session.userRole==='admin' })`.
      Files: `controllers/scoringController.js`
      Verify: `node --check controllers/scoringController.js`

- [ ] 7. **Register route `GET /events/:eventId/announce`**
      Add `announcePage` to the destructured import from `scoringController.js`. Add route: `router.get('/events/:eventId/announce', requireAuth, announcePage);` immediately after the `resultsPage` route.
      Files: `routes/index.js`
      Verify: `node --check routes/index.js`

- [ ] 8. **Create `views/scoring/announce.xian`**
      Standalone page — NO partials. Full file structure:
      ```html
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{{title}} — ScoreSync</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800;900&display=swap" rel="stylesheet">
        <style>
          /* --- base --- */
          *, *::before, *::after { box-sizing: border-box; font-family: 'Inter', sans-serif; }
          body { margin:0; background:#060b18; color:#fff; overflow:hidden; height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; }

          /* --- start screen --- */
          #start-screen { text-align:center; }
          #start-screen .event-label { font-size:.75rem; text-transform:uppercase; letter-spacing:.2em; color:rgba(255,255,255,.45); margin-bottom:12px; }
          #start-screen .title { font-size:2.5rem; font-weight:900; letter-spacing:-.02em; margin-bottom:8px; }
          #start-screen .crown { font-size:5rem; margin-bottom:24px; filter:drop-shadow(0 4px 16px rgba(251,191,36,.5)); }
          #start-screen .begin-btn {
            padding:14px 40px; border-radius:999px; border:none; cursor:pointer; font-size:1rem; font-weight:700;
            background:linear-gradient(135deg,#b45309,#f59e0b); color:#fff;
            box-shadow:0 8px 32px rgba(245,158,11,.4); transition:transform .12s,box-shadow .12s;
          }
          #start-screen .begin-btn:hover { transform:translateY(-2px); box-shadow:0 12px 40px rgba(245,158,11,.55); }

          /* --- reveal screen --- */
          #reveal-screen { display:none; width:100%; height:100%; align-items:center; justify-content:center; flex-direction:column; position:relative; }

          /* --- placement card --- */
          .placement-card {
            text-align:center; max-width:480px; width:90vw;
            animation: revealIn .6s cubic-bezier(.22,1,.36,1) both;
          }
          @keyframes revealIn {
            from { opacity:0; transform:translateY(40px) scale(.92); }
            to   { opacity:1; transform:translateY(0)    scale(1);   }
          }
          .rank-badge {
            display:inline-block; padding:4px 20px; border-radius:999px;
            font-size:.65rem; font-weight:900; letter-spacing:.18em; text-transform:uppercase; margin-bottom:16px;
          }
          .badge-bronze { background:rgba(205,127,50,.2); color:#cd7f32; border:1px solid rgba(205,127,50,.4); }
          .badge-silver { background:rgba(148,163,184,.15); color:#94a3b8; border:1px solid rgba(148,163,184,.3); }
          .badge-champion { background:rgba(245,158,11,.18); color:#f59e0b; border:1px solid rgba(245,158,11,.4); }
          .contestant-photo {
            width:128px; height:128px; border-radius:50%; object-fit:cover; object-position:center top;
            margin:0 auto 16px; display:block;
          }
          .contestant-number {
            width:128px; height:128px; border-radius:50%; display:flex; align-items:center; justify-content:center;
            margin:0 auto 16px; font-size:2.5rem; font-weight:900;
            background:linear-gradient(135deg,#1e3a8a,#2563eb); color:#fff;
          }
          .contestant-name { font-size:2.2rem; font-weight:900; letter-spacing:-.025em; line-height:1.1; margin-bottom:8px; }
          .contestant-barangay { font-size:1rem; opacity:.55; margin-bottom:20px; }
          .final-score { font-size:3.5rem; font-weight:900; line-height:1; }
          .score-label { font-size:.8rem; opacity:.5; margin-top:6px; }
          .champion-glow { box-shadow:0 0 60px rgba(245,158,11,.5),0 0 120px rgba(245,158,11,.18); border-radius:32px; padding:40px; }

          /* --- nav hint --- */
          #nav-hint { position:fixed; bottom:56px; width:100%; text-align:center; font-size:.72rem; opacity:.3; pointer-events:none; }

          /* --- branding --- */
          #branding { position:fixed; bottom:16px; width:100%; text-align:center; font-size:.72rem; opacity:.35; pointer-events:none; }

          /* --- restart btn --- */
          #restart-btn {
            display:none; margin-top:28px; padding:10px 28px; border-radius:999px; border:none;
            cursor:pointer; font-size:.85rem; font-weight:700;
            background:rgba(255,255,255,.08); color:rgba(255,255,255,.7);
            border:1px solid rgba(255,255,255,.15); transition:background .1s;
          }
          #restart-btn:hover { background:rgba(255,255,255,.14); }

          /* --- confetti --- */
          .confetti-piece {
            position:fixed; top:-20px; width:10px; height:10px; border-radius:2px;
            animation: fall linear forwards;
            pointer-events:none; z-index:9999;
          }
          @keyframes fall {
            to { transform: translateY(110vh) rotate(720deg); opacity:0; }
          }

          /* --- progress dots --- */
          #progress-dots { position:fixed; top:24px; width:100%; text-align:center; display:flex; align-items:center; justify-content:center; gap:8px; }
          .dot { width:8px; height:8px; border-radius:50%; background:rgba(255,255,255,.2); transition:background .3s; }
          .dot.active { background:#f59e0b; }
          .dot.done   { background:rgba(255,255,255,.5); }
        </style>
      </head>
      <body>

      <!-- Start Screen -->
      <div id="start-screen">
        <div class="event-label">{{event.name}}</div>
        <div class="title">OFFICIAL RESULTS</div>
        <div class="crown">👑</div>
        <button class="begin-btn" onclick="beginReveal()">Click to Begin Reveal</button>
      </div>

      <!-- Reveal Screen -->
      <div id="reveal-screen">
        <div id="progress-dots"></div>
        <div id="card-container"></div>
        <button id="restart-btn" onclick="restartReveal()">↺ Restart</button>
      </div>

      <!-- Branding -->
      <div id="branding">{{event.name}} &bull; ScoreSync</div>
      <div id="nav-hint">← → Arrow keys or Space to advance</div>

      <!-- Placement data (injected server-side, safe JSON) -->
      <script id="placements-data" type="application/json">{{{placementsJson}}}</script>

      <script>
      (function() {
        const PLACEMENTS = JSON.parse(document.getElementById('placements-data').textContent);
        let step = -1; // -1 = start screen shown

        const RANK_INFO = {
          // rank number → label, color class, score color
          3: { label: 'BRONZE', badgeClass: 'badge-bronze', scoreColor: '#cd7f32' },
          2: { label: 'SILVER', badgeClass: 'badge-silver', scoreColor: '#94a3b8' },
          1: { label: 'CHAMPION', badgeClass: 'badge-champion', scoreColor: '#f59e0b' },
        };

        function getInfo(rank) {
          return RANK_INFO[rank] || { label: 'RANK ' + rank, badgeClass: 'badge-silver', scoreColor: '#60a5fa' };
        }

        function buildProgressDots() {
          const container = document.getElementById('progress-dots');
          container.innerHTML = '';
          PLACEMENTS.forEach((_, i) => {
            const d = document.createElement('div');
            d.className = 'dot' + (i < step ? ' done' : i === step ? ' active' : '');
            container.appendChild(d);
          });
        }

        function renderCard(idx) {
          const c = PLACEMENTS[idx];
          if (!c) return;
          const info = getInfo(c.rank);
          const container = document.getElementById('card-container');
          container.innerHTML = ''; // clear previous card

          const isChampion = c.rank === 1;
          const card = document.createElement('div');
          card.className = 'placement-card' + (isChampion ? ' champion-glow' : '');

          // Rank badge
          const badge = document.createElement('div');
          badge.className = 'rank-badge ' + info.badgeClass;
          badge.textContent = info.label;
          card.appendChild(badge);

          // Photo or number
          if (c.photo) {
            const img = document.createElement('img');
            img.className = 'contestant-photo';
            img.src = c.photo;
            img.alt = '';
            card.appendChild(img);
          } else {
            const num = document.createElement('div');
            num.className = 'contestant-number';
            num.textContent = c.number || c.rank;
            card.appendChild(num);
          }

          // Name
          const name = document.createElement('div');
          name.className = 'contestant-name';
          name.textContent = c.name || '';
          card.appendChild(name);

          // Barangay
          if (c.barangay) {
            const bgy = document.createElement('div');
            bgy.className = 'contestant-barangay';
            bgy.textContent = 'Brgy. ' + c.barangay;
            card.appendChild(bgy);
          }

          // Score
          const scoreEl = document.createElement('div');
          scoreEl.className = 'final-score';
          scoreEl.style.color = info.scoreColor;
          scoreEl.textContent = c.finalScoreDisplay + '%';
          card.appendChild(scoreEl);

          const scoreLbl = document.createElement('div');
          scoreLbl.className = 'score-label';
          scoreLbl.textContent = 'weighted average';
          card.appendChild(scoreLbl);

          container.appendChild(card);

          if (isChampion) spawnConfetti();
          buildProgressDots();

          // Show/hide restart
          const restartBtn = document.getElementById('restart-btn');
          if (restartBtn) restartBtn.style.display = (idx >= PLACEMENTS.length - 1) ? 'inline-block' : 'none';
        }

        function spawnConfetti() {
          const colors = ['#f59e0b','#fbbf24','#fff','#a78bfa','#60a5fa','#34d399'];
          for (let i = 0; i < 50; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + 'vw';
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.animationDuration = (1.5 + Math.random() * 2) + 's';
            piece.style.animationDelay    = (Math.random() * 1.5) + 's';
            piece.style.width  = (6 + Math.random() * 8) + 'px';
            piece.style.height = piece.style.width;
            document.body.appendChild(piece);
            piece.addEventListener('animationend', () => piece.remove());
          }
        }

        function beginReveal() {
          document.getElementById('start-screen').style.display = 'none';
          const rev = document.getElementById('reveal-screen');
          rev.style.display = 'flex';
          advance();
        }

        function advance() {
          if (step < PLACEMENTS.length - 1) {
            step++;
            renderCard(step);
          }
        }

        function goBack() {
          if (step > 0) {
            step--;
            renderCard(step);
          }
        }

        function restartReveal() {
          step = -1;
          document.getElementById('reveal-screen').style.display = 'none';
          document.getElementById('start-screen').style.display = 'block';
          document.getElementById('card-container').innerHTML = '';
          document.getElementById('restart-btn').style.display = 'none';
          // remove leftover confetti
          document.querySelectorAll('.confetti-piece').forEach(el => el.remove());
        }

        // Make global for onclick attrs
        window.beginReveal   = beginReveal;
        window.restartReveal = restartReveal;

        // Keyboard navigation
        document.addEventListener('keydown', function(e) {
          if (step === -1) return; // wait for start-screen click
          if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); advance(); }
          if (e.key === 'ArrowLeft')  { e.preventDefault(); goBack(); }
        });

        // Click anywhere on reveal screen to advance
        document.getElementById('reveal-screen') && document.getElementById('reveal-screen').addEventListener('click', function(e) {
          if (e.target.id === 'restart-btn') return;
          advance();
        });

        // Init progress dots for start state
        buildProgressDots();
      })();
      </script>
      </body>
      </html>
      ```
      Files: `views/scoring/announce.xian`
      Verify: Navigate to `/events/:eventId/announce`, click Begin, advance through all placements.

---

## FEAT-003 — Admin Data Backup

- [ ] 9. **Create `controllers/backupController.js`**
      ```js
      import { db } from "../models/firebaseConfig.js";
      import { collection, getDocs } from "firebase/firestore";

      export const backupData = async (req, res) => {
        try {
          const eventsSnap = await getDocs(collection(db, "events"));
          const eventsData = [];
          for (const evDoc of eventsSnap.docs) {
            const evObj = { id: evDoc.id, ...evDoc.data() };
            const [cSnap, crSnap, sSnap, aSnap] = await Promise.all([
              getDocs(collection(db, "events", evDoc.id, "contestants")),
              getDocs(collection(db, "events", evDoc.id, "criteria")),
              getDocs(collection(db, "events", evDoc.id, "scores")),
              getDocs(collection(db, "events", evDoc.id, "audit_log")),
            ]);
            evObj.contestants = cSnap.docs.map(d  => ({ id: d.id,  ...d.data() }));
            evObj.criteria    = crSnap.docs.map(d => ({ id: d.id,  ...d.data() }));
            evObj.scores      = sSnap.docs.map(d  => ({ id: d.id,  ...d.data() }));
            evObj.audit_log   = aSnap.docs.map(d  => ({ id: d.id,  ...d.data() }));
            eventsData.push(evObj);
          }
          const usersSnap = await getDocs(collection(db, "users"));
          const usersData = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const date   = new Date().toISOString().split("T")[0];
          const backup = {
            exportedAt:  new Date().toISOString(),
            exportedBy:  req.session.userName || "admin",
            version:     "1.0",
            events:      eventsData,
            users:       usersData,
          };
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Content-Disposition", `attachment; filename=scoresync-backup-${date}.json`);
          return res.status(200).send(JSON.stringify(backup, null, 2));
        } catch (err) {
          console.error(err);
          return res.status(500).json({ error: "Backup failed." });
        }
      };
      ```
      Files: `controllers/backupController.js` (new file)
      Verify: `node --check controllers/backupController.js`

- [ ] 10. **Register route `GET /admin/backup`**
       Add at the top of the admin users block in `routes/index.js`:
       ```js
       import { backupData } from "../controllers/backupController.js";
       ```
       Add route right after the users routes block (before events routes):
       ```js
       router.get("/admin/backup", requireAuth, requireRole("admin"), backupData);
       ```
       Files: `routes/index.js`
       Verify: `node --check routes/index.js`

- [ ] 11. **Add 'Download Backup' to admin dashboard Quick Actions**
       In `views/dashboard/admin.xian`, inside the `.p-3.space-y-1` Quick Actions container, after the Analytics `<a>` block and before the closing `</div>`, insert:
       ```html
       <a href="/admin/backup"
         class="flex items-center gap-3 p-3 rounded-xl transition"
         style="border:1px solid transparent"
         onmouseover="this.style.background='rgba(20,184,166,0.07)';this.style.borderColor='rgba(20,184,166,0.18)'"
         onmouseout="this.style.background='';this.style.borderColor='transparent'">
         <div class="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
           style="background:linear-gradient(135deg,#134e4a,#14b8a6)">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5">
             <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
             <polyline points="7 10 12 15 17 10"/>
             <line x1="12" y1="15" x2="12" y2="3"/>
           </svg>
         </div>
         <div class="flex-1">
           <div class="text-xs font-bold" style="color:#e2e8f0">Download Backup</div>
           <div class="text-[11px]" style="color:#374151">Full JSON export</div>
         </div>
         <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2.5">
           <polyline points="9 18 15 12 9 6"/>
         </svg>
       </a>
       ```
       Files: `views/dashboard/admin.xian`
       Verify: Log in as admin, open dashboard — 'Download Backup' appears in Quick Actions. Click it, confirm browser downloads `scoresync-backup-YYYY-MM-DD.json`.

---

## Ordering dependencies

| Step | Depends on |
|------|-----------|
| 1 (scoresJson) | nothing |
| 2 (route scores-json) | step 1 |
| 3–5 (results.xian polling UI) | step 2 (endpoint must exist) |
| 6 (announcePage) | nothing (but edit same file as step 1 — implement after step 1 to avoid conflict) |
| 7 (route announce) | step 6 |
| 8 (announce link in results) | steps 3–5 (if FEAT-001 already added it, skip) |
| 9 (backupController) | nothing |
| 10 (route backup) | step 9 |
| 11 (admin.xian button) | step 10 |
