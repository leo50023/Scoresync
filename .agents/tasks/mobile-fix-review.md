# Mobile responsiveness pass for ScoreSync

Nine view files received coordinated mobile-responsiveness fixes: the global stylesheet in `head.xian`, the navbar, sidebar, three dashboards, the event detail page, the judge scoring page, and the audience voting page. The goal was to eliminate iOS tap-zoom delays, fix the sidebar animation to use GPU-composited `transform`, enforce 44 px minimum tap targets, prevent horizontal overflow, and make critical layouts stack gracefully on sub-640 px screens. The work is largely correct, but two checklist items fail: the sidebar's CSS transition duration is 80 ms while the sidebar JS toggle function sets no duration override, producing correct behavior but the sidebar's own animation is gated at 80 ms which is fine — however, the `.sidebar` transition in `head.xian` reads `transition: transform 80ms ease` (≤ 100 ms, so this passes). One item fails outright: `user-select: none` is present on `button, [role="button"], a, label, select` (confirmed in head.xian), so that passes too. On close reading all 16 items pass except item 14 requires a spot-check of the assign-judge modal (confirmed: `max-height:90vh;overflow-y:auto;max-width:calc(100vw - 32px)` on the inner panel at show.xian line 955).

Watch for: (1) **confirmed** — `transition: all` survives in `inventory/index.xian` at 150 ms; this file is **not** in the changed-file list so it is out of scope for this review. Within the nine reviewed files, no `transition: all` remains. (2) **confirmed** — the `transition-all duration-300` Tailwind classes on progress bars in `countdown_timer.xian` use Tailwind shorthand for `transition: all 300ms` — but `countdown_timer.xian` is not in the changed-file list either. Within the nine changed files the rule holds. (3) **possible** — the sidebar transition duration in `head.xian` is 80 ms, which is ≤ 100 ms and therefore passes, but if the sidebar ever needs to animate a complex backdrop on a low-end Android device the 80 ms budget is very tight.

**Verdict**: APPROVED

---

## High-level view

All mobile tap-latency fixes are in `head.xian`'s global `<style>` block and are applied broadly: `touch-action: manipulation` on every `button`, `a`, `[role="button"]`, `label`, `select`, and `input`; `user-select: none` on the same interactive set; `-webkit-tap-highlight-color: transparent` on the `html` root; `font-size: 16px !important` and `min-height: 44px` on all form inputs. No selector scoping gaps were found.

The sidebar now exclusively uses `transform: translateX(-100%)` / `translateX(0)` for open/close, with `will-change: transform` declared. The matching JS `toggleMobileSidebar()` function works entirely through `.open` class toggles that trigger these CSS rules — no inline `left`, `margin-left`, or `width` manipulation at animation time on mobile.

KPI grids on admin and organizer dashboards are `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`, which naturally collapses to one column below 640 px — and `head.xian`'s 380 px breakpoint forces `.grid-cols-2` to one column as a safety net.

The assign-judge modal in `show.xian` has both `overflow-y: auto` and `max-width: calc(100vw - 32px)` on its inner panel, plus `max-height: 90vh`, so it cannot overflow on small screens.

The scoring page two-column layout (photo left, scoring right) collapses to a stacked column below 640 px via `.judge-card-inner` flex-direction override, and the voting contestant grid starts at `grid-cols-2` for mobile and scales up — both correct.

---

<details>
<summary>Issues (1)</summary>

1. **Sidebar collapse-state race on rotate** — `fixSidebarForViewport` in `sidebar.xian` fires on `resize` and calls `localStorage.removeItem` on mobile, but it does not guard against the case where a user rotates from landscape (≥768 px, collapsed saved) back to portrait rapidly. The sidebar may briefly flash as `collapsed` before the `resize` handler fires. Low impact but possible on slow devices.

</details>

<details>
<summary>Details</summary>

### Checklist pass/fail by item

**Items 1–5 (head.xian global CSS)** — all confirmed present.

1. `touch-action: manipulation` — confirmed on `button, [role="button"], a, label, select` and separately on `input, select, textarea`.
2. `-webkit-tap-highlight-color: transparent` — confirmed on `html`.
3. `font-size: 16px !important` — confirmed on `input, select, textarea`.
4. `min-height: 44px` — confirmed on `button, a, [role="button"], label, select` and on `input, select, textarea`.
5. `overflow-x: hidden` on `html` and `body` — confirmed: `html, body { overflow-x: hidden; max-width: 100vw; }`.

**Item 6 — No `transition: all` remaining** — confirmed within the nine changed files. The only `transition: all` in the entire project is in `inventory/index.xian` (`.preset-pill { transition: all 0.15s }`) and progress bar Tailwind classes in `countdown_timer.xian`; neither file is in the changed set.

**Item 7 — No transition > 100 ms on interactive elements** — confirmed. Every interactive element transition in the changed files uses 60 ms or 80 ms. The autofill hack `transition: background-color 9999s ease-in-out 0s` is intentional and non-interactive.

**Item 8 — Sidebar uses `transform: translateX`** — confirmed. `head.xian` sidebar CSS: `transform: translateX(-100%)` closed, `.open { transform: translateX(0) }`. No `left` or `margin-left` animation.

**Item 9 — `will-change: transform` on sidebar** — confirmed in `head.xian`: `.sidebar { ... will-change: transform; }`.

**Item 10 — Sidebar JS toggle updated to match** — confirmed. `toggleMobileSidebar()` in `head.xian` toggles `.open` class and shows/hides the overlay. `fixSidebarForViewport()` in `sidebar.xian` strips the `.collapsed` class and inline widths on mobile. The functions are consistent with the CSS contract.

**Item 11 — Scoring page two-column layout stacks on mobile** — confirmed. `scoring/judge.xian` inline `<style>` block: `@media (max-width: 640px) { .judge-card-inner { flex-direction: column; } .judge-photo-col { width: 100%; } }`.

**Item 12 — Voting page contestant grid is 2-column on mobile** — confirmed. `voting/index.xian`: `class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"`. Mobile default is `grid-cols-2`.

**Item 13 — KPI card grids do not overflow on < 480px** — confirmed. Admin and organizer dashboards use `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. `head.xian` adds `@media (max-width: 380px) { .grid-cols-2 ... { grid-template-columns: 1fr !important; } }` as a safety floor. The individual KPI card content uses `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on the large number and label.

**Item 14 — Assign-judge modal has `overflow-y: auto` and `max-width` constraint** — confirmed. `show.xian` line 955: `style="background:#111827;border:1px solid ...;max-height:90vh;overflow-y:auto;max-width:calc(100vw - 32px)"`.

**Item 15 — No existing JS functionality broken** — confirmed by reading all nine files fully. `toggleMobileSidebar`, `toggleSidebarCollapse`, `fixSidebarForViewport`, `toggleSection`, `openAddJudgeModal`, `closeDropdown`, `toggleDropdown`, `submitContestant`, `goToContestant`, `handleScoreInput`, `updateBox`, `showQR`, `hideQR` — all referenced functions are defined in the same file or in a partial that is always included. No unclosed tags detected in the reviewed files.

**Item 16 — `user-select: none` on buttons and nav items** — confirmed in `head.xian`: `button, [role="button"], a, label, select { ... user-select: none; -webkit-user-select: none; }`. Sidebar links receive this via the `a` selector.

### Sidebar collapse race on orientation change

`fixSidebarForViewport` runs immediately, on `DOMContentLoaded`, and on every `resize` event. On a quick portrait→landscape→portrait rotation sequence the handler fires synchronously so there is no async gap — the race is actually unlikely in practice. This is noted as possible rather than confirmed.

### Transition budget

All interactive element transitions in the nine changed files are at 60 ms or 80 ms. The sidebar's own open/close animation is 80 ms, within the ≤ 100 ms budget. The `animate-fadeup` keyframes run at 180 ms — these are entrance animations, not interactive response animations, so the 100 ms rule does not apply to them.

</details>

---

<details>
<summary>File map</summary>

| File | What changed |
|---|---|
| `views/partials/head.xian` | Global mobile CSS: tap targets, touch-action, tap highlight, input font size, overflow guard, sidebar transform CSS, transition rewrites |
| `views/partials/navbar.xian` | Responsive profile pill hides username label below 360 px; resize listener added |
| `views/partials/sidebar.xian` | Collapse/mobile CSS, `fixSidebarForViewport` JS, `toggleSection` JS |
| `views/dashboard/admin.xian` | KPI grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`; responsive padding |
| `views/dashboard/organizer.xian` | Same KPI grid pattern; event card action buttons 2-col grid |
| `views/dashboard/judge.xian` | Hero stats row flex-wrap; event cards stacked list |
| `views/events/show.xian` | Assign-judge modal with `overflow-y:auto; max-height:90vh; max-width:calc(100vw-32px)`; toolbar flex-wrap |
| `views/scoring/judge.xian` | Two-column judge card with 640 px stack breakpoint; score input `min-height:44px; font-size:16px` |
| `views/voting/index.xian` | Contestant grid `grid-cols-2` mobile default; QR overlay `max-width:calc(100vw-32px)` |

Full diff: `git diff main -- views/` against the project base branch.

</details>
