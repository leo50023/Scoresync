# ScoreSync Mobile Fix — Implementation Plan

> Project: Node/Express + Handlebars (`.xian` templates), TailwindCSS CDN, no build step.
> Run server: `npm run dev` (node index.js). No automated test suite — verify visually at 320 px, 375 px, and 768 px in DevTools.
> All CSS/JS changes are inline in the `.xian` template files; there is no separate stylesheet to compile.

---

## Pre-read findings

| File | Key gaps found |
|---|---|
| `head.xian` | `overflow-x:hidden` only on `main`, not `html`/`body`. Inputs/selects lack `min-height:44px` and `font-size:16px`. `user-select:none` missing on buttons/nav. `transition:all` not used (good — already uses specific props). |
| `navbar.xian` | Username label show/hide uses direct `.style.display` (instant — fine). Profile pill padding change is instant too. No bug here, but role-badge pill can wrap on very narrow screens. |
| `sidebar.xian` | Sidebar already uses `transform:translateX` and `will-change` is absent. `transition` is on the `.sidebar` class in `head.xian` but `will-change:transform` is missing. |
| `organizer.xian` | KPI grid is `grid-cols-2 lg:grid-cols-4` — collapses to 2 col on mobile (fine). Quick Actions grid is `grid-cols-1 sm:grid-cols-2` — fine. No overflow issues found. |
| `judge.xian` (dashboard) | Stats mini row uses `flex items-center gap-3 flex-wrap sm:flex-nowrap` — fine. |
| `admin.xian` | KPI grid is `grid-cols-2 lg:grid-cols-4` — fine. Table inside `.overflow-x-auto` — fine. |
| `scoring/judge.xian` | `.judge-card-inner` already has `@media (max-width:640px)` stack rule. `score-entry-input` is `width:72px;height:40px` — below 44 px tap target height and too narrow on 320 px. Quick-pick buttons: none present. Nav dots row uses `overflow-x:auto` — fine but dots can be tiny (32 px wide × 32 px tall — borderline). Bottom Prev/Next bar fixed — can overlap content on very small screens. |
| `voting/index.xian` | Grid is `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` — 2-col on mobile already. Vote button uses `btn-primary w-full` — full width already. QR overlay uses `padding:16px` and `max-width:340px` — fine but needs `overflow-y:auto` on inner panel. |
| `events/show.xian` | Action toolbar is `flex flex-wrap` with `btn-sm` buttons — good. Dropdown portal (JS-positioned) needs `max-width:100vw` guard. `add-judge-modal` inner div is `max-w-md` but no `overflow-y:auto` or `max-height` — can clip on short phones. |

---

## Implementation Plan

- [ ] 1. **`head.xian` — overflow & body scroll fix**

  Add `overflow-x:hidden` to both `html` and `body` elements (currently only `main` has it). This prevents the rubber-band horizontal scroll that appears on 320 px devices when any child is slightly wider than the viewport.

  **Exact change** — inside the `<style>` block, find:
  ```css
  body { background: #0a0f1e; color: #e2e8f0; -webkit-font-smoothing: antialiased; }
  ```
  Replace with:
  ```css
  html, body { overflow-x: hidden; max-width: 100%; }
  body { background: #0a0f1e; color: #e2e8f0; -webkit-font-smoothing: antialiased; }
  ```

  Files: `views/partials/head.xian`
  Verify: Start server (`npm run dev`), open any page at 320 px width in DevTools — no horizontal scrollbar appears, page does not bounce sideways on swipe.

---

- [ ] 2. **`head.xian` — touch response & tap highlight global rules**

  Add `user-select:none` to buttons and nav links, and ensure `-webkit-tap-highlight-color:transparent` is on the `html` selector (it already exists there — keep it). Add `user-select: none` to nav links.

  **Exact change** — find the existing rule:
  ```css
  button, a { touch-action: manipulation; }
  ```
  Replace with:
  ```css
  button, a { touch-action: manipulation; user-select: none; }
  ```

  Also find:
  ```css
  button { -webkit-appearance: none; appearance: none; }
  ```
  No change needed here — it already exists.

  The `-webkit-tap-highlight-color: transparent` already lives on `html`. Confirm the line reads:
  ```css
  html { scroll-behavior: smooth; -webkit-tap-highlight-color: transparent; }
  ```
  No edit needed there.

  Files: `views/partials/head.xian`
  Verify: On an iOS simulator or Chrome DevTools mobile emulation — tap any button and confirm no blue/grey flash appears.

---

- [ ] 3. **`head.xian` — form input minimum tap target and iOS zoom prevention**

  Add `min-height:44px` and `font-size:16px !important` to all `input`, `select`, and `textarea` elements to meet the 44 px tap target minimum and prevent iOS Safari from zooming in when a field is focused.

  **Exact change** — locate the existing rule block that styles dark-mode inputs (the one beginning with):
  ```css
  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]),
  textarea {
    background: rgba(255,255,255,0.05) !important;
    color: #e2e8f0 !important;
    border: 1.5px solid rgba(255,255,255,0.13) !important;
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
  }
  ```
  Add two lines to that rule:
  ```css
  input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]),
  textarea {
    background: rgba(255,255,255,0.05) !important;
    color: #e2e8f0 !important;
    border: 1.5px solid rgba(255,255,255,0.13) !important;
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    min-height: 44px;
    font-size: 16px !important;
  }
  ```

  Also add to the `select` dark-mode override that starts with:
  ```css
  select.bg-white, select.bg-slate-50, select.bg-slate-100,
  select.bg-slate-800, select { background-color: rgba(13,20,36,0.85) !important; color: #e2e8f0 !important; border-radius: 12px !important; }
  ```
  Append to that rule: `min-height: 44px; font-size: 16px !important;`

  Resulting in:
  ```css
  select.bg-white, select.bg-slate-50, select.bg-slate-100,
  select.bg-slate-800, select {
    background-color: rgba(13,20,36,0.85) !important;
    color: #e2e8f0 !important;
    border-radius: 12px !important;
    min-height: 44px;
    font-size: 16px !important;
  }
  ```

  Files: `views/partials/head.xian`
  Verify: Open any form page on iOS Safari (or DevTools iPhone emulation) — focus a text input; the page must NOT zoom in. All visible inputs and selects must be at least 44 px tall.

---

- [ ] 4. **`head.xian` — global max-width 100% safety net for overflowing elements**

  The existing rule `img { ... max-width: 100%; }` covers images. Add a blanket rule for other common overflow offenders (tables rendered without `.overflow-x-auto`, wide pre blocks, iframes) so no single element can force a wider-than-viewport layout.

  **Exact change** — immediately after the `img` rule, add:
  ```css
  /* Prevent any element from causing horizontal overflow */
  pre, iframe, video, canvas, svg:not(.inline-svg) { max-width: 100% !important; }
  ```

  Files: `views/partials/head.xian`
  Verify: On 320 px DevTools, load every page — horizontal scrollbar must be absent.

---

- [ ] 5. **`head.xian` — KPI card grid single-column at < 380 px already exists; verify 480 px breakpoint**

  The existing `@media (max-width:380px)` already forces `.grid-cols-2` to 1 column. The `@media (max-width:480px)` rule forces `.grid-cols-2, .grid-cols-3, .grid-cols-4` to `repeat(2, 1fr)`. The KPI grids in all dashboards use `grid-cols-2 lg:grid-cols-4` so at 480 px they are already 2 columns. **No code change needed here** — but confirm the text inside KPI cards does not clip.

  Add text overflow protection inside the `@media (max-width: 480px)` block:
  ```css
  @media (max-width: 480px) {
    /* existing rules … */
    .kpi-card p, .kpi-card span, [class*="rounded-2xl"] p, [class*="rounded-2xl"] span {
      overflow: hidden; text-overflow: ellipsis; max-width: 100%;
    }
  }
  ```

  Files: `views/partials/head.xian`
  Verify: On 375 px, KPI numbers (`{{totalEvents}}`, `{{totalUsers}}`) must not overflow their card borders.

---

- [ ] 6. **`sidebar.xian` — add `will-change: transform` to the sidebar element**

  The `.sidebar` transition rule lives in `head.xian` and already uses `transform`. Adding `will-change:transform` to the sidebar element itself (in `sidebar.xian`) promotes it to a GPU layer, eliminating the jank on first open on low-end Android phones.

  **Exact change** — in `sidebar.xian`, the `<aside>` opening tag is:
  ```html
  <aside id="main-sidebar" class="sidebar flex flex-col shadow-2xl">
  ```
  Add an inline style:
  ```html
  <aside id="main-sidebar" class="sidebar flex flex-col shadow-2xl" style="will-change:transform">
  ```

  Files: `views/partials/sidebar.xian`
  Verify: On a mobile emulation, toggle the sidebar 5 times rapidly — animation must stay smooth with no visible repaint flash.

---

- [ ] 7. **`scoring/judge.xian` — score entry input: full-width on mobile and 44 px min-height**

  The score input currently has `width:72px; height:40px` inline. On 320 px screens this is too narrow. On mobile it should be full-width inside a flex row. The 40 px height is also below the 44 px target.

  **Exact change** — locate the `<input type="number"` with class `score-entry-input` inside the criteria panel. Its current inline style is:
  ```
  style="width:72px;height:40px;font-size:1.25rem;font-weight:900;text-align:center;border-radius:10px;border:1.5px solid rgba(201,162,39,0.4);background:rgba(0,0,0,0.35);color:#f0c040;outline:none;-webkit-appearance:none;-moz-appearance:textfield"
  ```
  Change `width:72px` → `width:72px` (keep for desktop) but add a CSS override in the `<style>` block near the other `.score-entry-input` rules:
  ```css
  @media (max-width: 480px) {
    .score-entry-input {
      width: 100% !important;
      min-height: 44px !important;
      font-size: 1.1rem !important;
    }
    /* Also make the progress-bar + input row stack vertically */
    .criteria-panel > div[style*="display:flex;align-items:center;gap:8px"] {
      flex-wrap: wrap;
    }
  }
  ```

  Because the `<style>` block is already present in `scoring/judge.xian`, append these rules at the bottom of that block, just before the closing `</style>`.

  Files: `views/scoring/judge.xian`
  Verify: Open scoring page at 320 px — each criteria row's score input must span the full available width and be at least 44 px tall.

---

- [ ] 8. **`scoring/judge.xian` — nav dots minimum tap target**

  Nav dots are `min-w-[32px] h-8` = 32 px height, below the 44 px target. Since dots can be many (one per contestant), expanding them to 44 px would waste space. The fix is to wrap them in a scroll container with `padding-block: 6px` (adding invisible tap area) and keep the visual size.

  **Exact change** — find the nav-dots row div:
  ```html
  <div class="px-4 sm:px-6 py-2 flex items-center gap-1.5 overflow-x-auto" style="border-top:1px solid rgba(255,255,255,0.04)">
  ```
  Change `py-2` to `py-2` (already 8 px each side — total 16 px + 32 px = 48 px touch row height). The dots themselves need a larger invisible hit area. Add to the `<style>` block in this file:
  ```css
  @media (max-width: 640px) {
    .nav-dot {
      min-height: 44px !important;
      min-width: 44px !important;
    }
  }
  ```
  Append these rules at the bottom of the existing `<style>` block in `scoring/judge.xian`.

  Files: `views/scoring/judge.xian`
  Verify: On 375 px, each contestant nav dot must be touchable without needing pixel-perfect aim.

---

- [ ] 9. **`scoring/judge.xian` — sticky bottom nav bar: prevent content overlap on small screens**

  The fixed bottom Prev/Next bar is `py-3` (~46 px tall). The main content has `pb-32` (128 px). On 320 px devices the fixed bar may still overlap the Submit button. Increase bottom padding on very small screens.

  **Exact change** — add to the `<style>` block:
  ```css
  @media (max-width: 480px) {
    #scoring-main { padding-bottom: 96px !important; }
  }
  ```

  Files: `views/scoring/judge.xian`
  Verify: At 320 px, scroll to the bottom of any contestant panel — the Submit button must not be hidden behind the bottom bar.

---

- [ ] 10. **`voting/index.xian` — vote button full-width on mobile (already is), QR overlay overflow fix**

  The vote button already uses `btn-primary w-full` — no change needed there. The QR overlay inner panel needs `overflow-y:auto` and a `max-height` so it doesn't clip on short devices (e.g. iPhone SE in landscape).

  **Exact change** — locate the QR overlay inner `<div>`:
  ```html
  <div style="background:#0d1424;border:1px solid rgba(255,255,255,0.12);border-radius:20px;
              padding:28px 24px;max-width:340px;width:100%;text-align:center;
              box-shadow:0 24px 64px rgba(0,0,0,0.7)">
  ```
  Add `max-height:90vh;overflow-y:auto;` to its inline style:
  ```html
  <div style="background:#0d1424;border:1px solid rgba(255,255,255,0.12);border-radius:20px;
              padding:28px 24px;max-width:340px;width:100%;text-align:center;
              box-shadow:0 24px 64px rgba(0,0,0,0.7);max-height:90vh;overflow-y:auto">
  ```

  Files: `views/voting/index.xian`
  Verify: Open voting page on 320×568 (iPhone SE portrait) — tap "Show QR Code" — the QR panel must fit entirely on screen and be scrollable if it doesn't.

---

- [ ] 11. **`events/show.xian` — dropdown portal: clamp width on mobile**

  The `toggleDropdown` JS function positions a portal `<div>` absolutely. On narrow screens this portal can extend off the right edge. The function is defined around line 765 in `show.xian`. After the portal is positioned, clamp it to not overflow.

  **Exact change** — locate the `toggleDropdown` function in the `<script>` block of `show.xian`:
  ```js
  function toggleDropdown(id, btn) {
    var portal  = getPortal();
    var content = document.getElementById(id + '-content');
  ```
  After the portal positioning logic, add a viewport clamp. Find the section where `portal.style.left` or `portal.style.top` are set (inside `toggleDropdown` or its helper). Add these lines immediately after position is applied:
  ```js
  // Clamp portal to viewport width on mobile
  var portalRect = portal.getBoundingClientRect();
  if (portalRect.right > window.innerWidth) {
    portal.style.left = 'auto';
    portal.style.right = '4px';
  }
  if (portalRect.left < 0) {
    portal.style.left = '4px';
    portal.style.right = 'auto';
  }
  portal.style.maxWidth = (window.innerWidth - 8) + 'px';
  ```

  To find exactly where position is applied: search for `portal.style.left` or `portal.style.top` in the script block near line 770–810 of `show.xian`, and insert the clamp block immediately after those assignments.

  Files: `views/events/show.xian`
  Verify: On 375 px, open the "More" dropdown — no part of the menu must extend beyond the right edge of the screen.

---

- [ ] 12. **`events/show.xian` — assign-judge modal: overflow-y and max-height**

  The modal inner div has `max-w-md` but no height cap. On an iPhone SE (568 px viewport height) with many judges listed, the modal can grow taller than the screen.

  **Exact change** — find the modal inner div:
  ```html
  <div class="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
    style="background:#111827;border:1px solid rgba(99,102,241,0.3)">
  ```
  Add a max-height and overflow to make it scrollable:
  ```html
  <div class="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
    style="background:#111827;border:1px solid rgba(99,102,241,0.3);max-height:90vh;overflow-y:auto;-webkit-overflow-scrolling:touch">
  ```

  Files: `views/events/show.xian`
  Verify: On 320×568, open the Assign Judge modal when several judges are listed — the modal must not extend beyond the screen and must be scrollable.

---

- [ ] 13. **`head.xian` — replace `transition: all` usages with specific properties (performance)**

  Grep the entire codebase for `transition: all` or `transition:all`. Based on the read files, no usage of `transition:all` was found in head.xian or the page files — the existing code already uses specific properties (`background`, `color`, `border-color`, `transform`, `box-shadow`, `opacity`). **No code change needed.**

  Confirm with: `grep -r "transition: all\|transition:all" views/` — if any results appear, replace each with specific properties matching what is animated.

  Files: none (confirm only)
  Verify: Run `grep -r "transition:all" views/` on the project — zero results expected.

---

- [ ] 14. **`head.xian` / page files — add `loading="lazy"` to non-critical images**

  Images that already have `loading="lazy"`: contestant photo in `voting/index.xian`. Images that are missing it: cover photo in `events/show.xian` (inside event card header), contestant grid photos in `events/show.xian` (the `<img src="{{photo}}"` inside `.group.relative`), and the contestant photo in `scoring/judge.xian` (`.judge-photo-col img`).

  **Exact changes:**

  In `views/events/show.xian`, find:
  ```html
  <img src="{{event.coverPhoto}}" alt="{{event.name}}" class="absolute inset-0 w-full h-full object-cover" style="opacity:0.3"/>
  ```
  Add `loading="lazy"`:
  ```html
  <img src="{{event.coverPhoto}}" alt="{{event.name}}" class="absolute inset-0 w-full h-full object-cover" loading="lazy" style="opacity:0.3"/>
  ```

  In `views/events/show.xian`, find the contestant grid photo:
  ```html
  <img src="{{photo}}" alt="{{name}}"
    class="absolute inset-0 w-full h-full object-cover"
    style="object-position:center top"/>
  ```
  Add `loading="lazy"`:
  ```html
  <img src="{{photo}}" alt="{{name}}"
    class="absolute inset-0 w-full h-full object-cover"
    loading="lazy"
    style="object-position:center top"/>
  ```

  In `views/scoring/judge.xian`, find:
  ```html
  <img src="{{photo}}" alt="{{name}}"
    style="width:100%;height:100%;object-fit:cover;...
  ```
  Add `loading="lazy"` attribute after `alt="{{name}}"`.

  Files: `views/events/show.xian`, `views/scoring/judge.xian`
  Verify: In DevTools Network tab (throttled to Slow 3G), load the events show page — cover photo and below-fold contestant photos must show as lazy (loaded only when scrolled near).

---

- [ ] 15. **`head.xian` — add `content-visibility: auto` to off-screen sections**

  Add a utility CSS class that can be applied to large below-fold sections to defer their layout/paint cost.

  **Exact change** — append inside the `<style>` block in `head.xian`, just before the closing `</style>`:
  ```css
  /* Deferred rendering for off-screen sections */
  .cv-auto {
    content-visibility: auto;
    contain-intrinsic-size: 0 400px;
  }
  ```

  Then in `views/dashboard/organizer.xian`, find the Quick Actions + Judges section:
  ```html
  <div class="grid lg:grid-cols-3 gap-5 animate-fadeup-2">
  ```
  Add the class:
  ```html
  <div class="grid lg:grid-cols-3 gap-5 animate-fadeup-2 cv-auto">
  ```

  In `views/dashboard/admin.xian`, find:
  ```html
  <div class="grid lg:grid-cols-3 gap-5 animate-fadeup-2">
  ```
  Add:
  ```html
  <div class="grid lg:grid-cols-3 gap-5 animate-fadeup-2 cv-auto">
  ```

  In `views/dashboard/judge.xian`, find the Quick Tips grid:
  ```html
  <div class="grid sm:grid-cols-3 gap-3 animate-fadeup-2">
  ```
  Add:
  ```html
  <div class="grid sm:grid-cols-3 gap-3 animate-fadeup-2 cv-auto">
  ```

  Files: `views/partials/head.xian`, `views/dashboard/organizer.xian`, `views/dashboard/admin.xian`, `views/dashboard/judge.xian`
  Verify: In DevTools Performance tab, record a dashboard page load — the below-fold section's layout time should decrease. No visual regression on scroll.

---

## Summary — files changed

| File | Items |
|---|---|
| `views/partials/head.xian` | 1, 2, 3, 4, 5, 15 |
| `views/partials/sidebar.xian` | 6 |
| `views/scoring/judge.xian` | 7, 8, 9, 14 |
| `views/voting/index.xian` | 10 |
| `views/events/show.xian` | 11, 12, 14 |
| `views/dashboard/organizer.xian` | 15 |
| `views/dashboard/admin.xian` | 15 |
| `views/dashboard/judge.xian` | 15 |

## Items with no code change required (already correct)

- `navbar.xian`: label show/hide already uses direct `.style.display` — zero-delay, no `setTimeout`. Profile pill already uses `flex-shrink-0` and truncation.
- `sidebar.xian`: already uses `transform:translateX` for open/close (in `head.xian` `.sidebar` rule). Transition is already `transition: transform 160ms cubic-bezier(...)`.
- Voting page vote button: already `w-full`.
- `transition:all` usage: not found anywhere.
- KPI card grid collapsing: already handled by existing `@media (max-width:380px)` and `@media (max-width:480px)` in `head.xian`.
