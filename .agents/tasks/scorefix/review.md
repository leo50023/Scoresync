# Remove AI Score Audit, cap scores to 0–100%, add announce back button

This change deletes the AI Score Audit feature end to end (controller, routes, view, and every link that opened it) and reroutes every final-score computation in `scoringController` through a single `computeFinalScore` helper. The announce page's 412% came from summing weighted criterion contributions flat across all categories in a multi-category event; the helper instead averages the per-category scores (each 0–100), so the result stays in range. A print-hidden "Back to Results" link is added to the announce page. All four requested tasks are correctly and completely done; what remains is cleanup, not correctness.

**Watch for:** a large button-utility/emoji refactor across roughly a dozen views plus `head.xian` is bundled in the same working tree and is not part of these four fixes — if committed with `git add -A` under the fix-scoped message, those changes ship undescribed.

**Verdict: APPROVED**

## High-level view

AI Score Audit is gone from the source. The four routes and the `analyticsController` import were removed from `routes/index.js`, `controllers/analyticsController.js` and `views/analytics/` were deleted, and the three UI entry points were taken out — the results-toolbar "AI Audit" button, the event More-menu "AI Score Audit" item, and the admin dashboard "Analytics" card. No view or route references `/analytics` anymore, and the sidebar never carried an Analytics item.

The score fix is a consolidation rather than a new formula. `announcePage`, `displayBoard`, `publicResults`, `exportResults`, `scoresJson`, the tabulator totals map, and the per-judge totals in `resultsPage` and `reportPage` all now call `computeFinalScore`. That helper sums `(avg / maxScore) * weight` per criterion for flat events (0–100 when weights total 100) and averages per-category scores for multi-category events — each category is 0–100 because within-category weights are validated to ≤100, so the average is too. The flat cross-category sum that produced 412% no longer exists anywhere.

The announce page renders `c.finalScoreDisplay + '%'` straight from that helper, so the displayed score is bounded, and a "Back to Results" link to `/events/:id/results` sits fixed top-left, styled `btn-sm btn-sm-gray` with a `no-print` class plus a print media rule, so it is on-screen and gone on paper. The announce view is a full-screen presentation page with no standard nav bar, so the fixed overlay is the right placement.

Two cleanup residues: `@google/genai` is now an unused dependency (the deleted controller was its only importer), and the working tree also carries an unrelated button-utility/emoji refactor across many views plus `head.xian` from earlier session work.

<details>
<summary>Issues (3)</summary>

1. **Orphaned `@google/genai` dependency** — `analyticsController` was the only importer of `@google/genai`; after its deletion no source file imports it. Drop `@google/genai` from `package.json` (and reinstall) so the now-unused SDK isn't shipped.
2. **Back-button arrow is a chevron, not the literal "←"** — the link uses a left-chevron SVG plus the text "Back to Results" rather than the "←" glyph named in the brief. Functionally a back arrow + label; only matters if the exact glyph was required.
3. **Unrelated UI refactor bundled in the working tree** — about a dozen views plus `head.xian` carry a button-utility/emoji restyle that sits outside the four fixes. If committing via `git add -A` with the fix-scoped message, split it into its own commit or broaden the message so those changes aren't shipped undescribed.

</details>

<details>
<summary>Details</summary>

### AI Score Audit removed from routes, controller, view, and links

`routes/index.js` drops the `analyticsController` import and all four routes — `GET /analytics`, `GET /analytics/export`, `POST /analytics/run`, `POST /analytics/flags/:flagId/status` (the handlers `analyticsDashboard`, `exportAnalyticsCSV`, `runAIAnalytics`, `updateFlagStatus`). The removal is clean: nothing else in the codebase imports `analyticsController`, and a repo-wide search finds no remaining `/analytics` link in any view or route. `controllers/analyticsController.js` and `views/analytics/index.xian` are deleted and the `views/analytics` directory is gone.

The three places that opened the audit are all cut: the results toolbar `btn-sm-purple` "AI Audit" button (`/analytics?eventId=...`) in `views/scoring/results.xian`, the "AI Score Audit" dropdown item in the event More-menu in `views/events/show.xian`, and the "Analytics" card in `views/dashboard/admin.xian`. `views/partials/sidebar.xian` has no Analytics entry, so there was nothing to remove there. The only code-side residue is the now-unused `@google/genai` dependency in `package.json` (its lockfile entries remain). The `analytics_reports` Firestore collection the controller wrote to is runtime data, not code, so it is out of scope.

### Score calculation unified through `computeFinalScore` (root cause of the >100% bug)

The 412% figure came from `announcePage` computing `finalScore` as a flat sum of `(avg / maxScore) * weight` across every criterion, ignoring category boundaries. In a multi-category event each category's criterion weights total ~100, so summing across N categories topped out near N×100. The same flat-sum pattern was present in `displayBoard`, `publicResults`, `exportResults`, `scoresJson`, the tabulator totals map, and the per-judge totals in `resultsPage` and `reportPage` — so every one of those could exceed 100% for a multi-category event, not just the announce page.

The fix replaces each of those inline blocks with a call to `computeFinalScore(c, criteria, allScores)`. The helper (pre-existing, unmodified) takes two paths: flat events sum `(avg / maxScore) * weight` per criterion, landing at 0–100 when weights total 100; multi-category events compute each category's score — itself a 0–100 sum, since `storeCategorycriterion` rejects weights that would push a category past 100 — and then average the category scores. Averaging values that are each ≤100 keeps the result ≤100. Because categories carry only `name`/`order` (no per-category weight in the data model), the simple average is the only sensible combination and matches the brief's "average, not sum" intent.

The per-judge totals pass that judge's score subset (`allScores.filter(s => s.judgeId === jId)`) into `computeFinalScore`, so a single judge's reported total is category-averaged and bounded too — previously a flat sum that could exceed 100% in multi-category events. Every consuming view renders the server's `{{finalScoreDisplay}}%` directly (`results.xian`, `report.xian`, `public.xian`, `display.xian`, the announce JS `c.finalScoreDisplay + '%'`); none re-sums the `breakdown` client-side, so the UI cannot reintroduce the flat cross-category sum.

### Announce page back button

A fixed top-left link `<a href="/events/{{event.id}}/results">` is added right after `<body>`, with class `btn-sm btn-sm-gray no-print announce-back-btn`, `aria-label="Back to Results"`, a left-chevron SVG, and the text "Back to Results". It is hidden on print two ways — the global `no-print` class and a dedicated `@media print { .announce-back-btn { display: none !important; } }` rule — so it shows on screen and disappears on paper as required. The announce view is a full-screen presentation (start screen, cards, confetti) with no standard top nav, so the fixed overlay satisfies the brief's "add to the nav bar if one exists." The arrow is a chevron icon rather than the literal "←" glyph the brief named.

</details>

<details>
<summary>File map</summary>

- `controllers/analyticsController.js` — deleted; the AI Score Audit controller (dashboard, run, flag-status, CSV export, `@google/genai` integration).
- `views/analytics/index.xian` — deleted; the AI Score Audit dashboard view. The `views/analytics` folder is gone.
- `routes/index.js` — removed the `analyticsController` import and the four `/analytics` routes.
- `controllers/scoringController.js` — `announcePage`, `displayBoard`, `publicResults`, `exportResults`, `scoresJson`, the tabulator totals map, and the `resultsPage`/`reportPage` per-judge totals now use `computeFinalScore` instead of inline flat sums.
- `views/scoring/announce.xian` — added the print-hidden "Back to Results" link; score still rendered as `finalScoreDisplay`%.
- `views/scoring/results.xian` — removed the "AI Audit" toolbar link.
- `views/events/show.xian` — removed the "AI Score Audit" More-menu item.
- `views/dashboard/admin.xian` — removed the "Analytics" card (plus button-utility restyle).
- `views/partials/head.xian` — added `btn-sm-*` / `btn-solid-*` / `btn-icon` utility classes (UI refactor, outside the four fixes).
- `views/scoring/tabulator.xian`, `views/scoring/judge.xian`, `views/criteria/index.xian`, `views/dashboard/judge.xian`, `views/dashboard/organizer.xian`, `views/events/index.xian`, `views/inventory/index.xian`, `views/settings/index.xian`, `views/setup.xian`, `views/users/index.xian`, `views/voting/index.xian`, `views/voting/qr.xian` — button-utility/emoji restyle (UI refactor, outside the four fixes).

Full diff: `git diff HEAD`.

</details>
