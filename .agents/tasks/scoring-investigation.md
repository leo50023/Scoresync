# ScoreSync — Scoring Features Investigation Report

## Summary Answer

| Requirement | Status |
|---|---|
| 1. Report Generation (PDF, digitally signed) | ❌ **Missing** — only browser Print/CSV export exists; no PDF lib, no digital signatures |
| 2. Tally Sheet (per-competition scoring sheet) | ✅ **Exists** — "Official Tabulation Sheet" table in `results.xian` is fully rendered |
| 3. Automatic Ranking System | ✅ **Exists** — full weighted scoring + tie-breaking + rank assignment in `scoringController.js` |
| 4. Judge Score Visibility (judge sees own scores) | ✅ **Exists** — `scoringPage` filters scores by `judgeId` and pre-populates the numpad; judge sees their own values on reload |
| 5. Score Editing Capability (with audit trail) | ⚠️ **Partial** — re-submission overwrites via `setDoc` (idempotent doc ID); **no explicit audit log entry for edits**, and no dedicated edit UI or edit route |

---

## Evidence by Requirement

---

### Requirement 1 — Report Generation (comprehensive PDF, digitally signed)

**Status: ❌ Missing**

**What exists:**
- `results.xian` has a `window.print()` button that triggers browser print-to-PDF. This is a browser-only workaround — not a generated PDF file.
- `exportResults` in `scoringController.js` (line ~345–420) generates a **CSV** download via `GET /events/:eventId/results/export`. No PDF.
- `public.xian` also has a "Print / Save PDF" button that calls `window.print()`.
- No PDF generation library is installed. `package.json` lists only: `@google/genai`, `compression`, `connect-flash`, `cookie-session`, `express`, `express-session`, `firebase`, `hbs`, `inquirer`. No `pdfkit`, `puppeteer`, `playwright`, `jsPDF`, or `html-pdf`.
- No `/report` route exists in `routes/index.js`.
- No report controller file exists in `controllers/` (only: `analyticsController.js`, `authController.js`, `contestantController.js`, `criteriaController.js`, `dashboardController.js`, `eventController.js`, `financeController.js`, `homeController.js`, `inventoryController.js`, `scoringController.js`, `settingsController.js`, `userController.js`).
- The analytics controller does have an `analytics_reports` Firestore collection for AI audit reports, but this is a JSON structure for anomaly detection — not a printable/signed competition results document.

**What is missing:**
- A proper PDF report generation endpoint (server-side, e.g. using `pdfkit` or `puppeteer`)
- A digital signature mechanism for judges — no concept of a judge "signing" a report exists anywhere in the codebase. The only reference to "signed sheets" is a comment in `analyticsController.js` line 351: _"Ensure official signed judge sheets match digitized score records."_ — this is an audit insight text, not a feature.
- A `reportController.js` with the generation logic
- A route such as `GET /events/:eventId/report`

**Recommended implementation approach:**
1. Install `pdfkit` (server-side, no headless browser needed) or use `puppeteer` to render the existing `results.xian` to PDF.
2. Add `GET /events/:eventId/report` → `reportController.generateReport`.
3. The report should include: event metadata, criteria table, ranked results table, judge breakdown, and a signature block at the bottom (one per assigned judge) with name, date, and a blank line for physical signature — or a "signed by" field that gets populated when judges click "Confirm & Sign" to attest their scores are final.
4. Store a `reportSigned` flag per judge in Firestore (e.g. `events/{id}/report_signatures/{judgeId}`).
5. The report PDF is the authoritative printable document; `window.print()` remains as a fallback.

---

### Requirement 2 — Tally Sheet (dedicated scoring sheet per competition)

**Status: ✅ Exists (fully functional)**

**Evidence:**
- `views/scoring/results.xian` lines 252–330: A section labeled **"Official Tabulation Sheet"** renders a full HTML table showing:
  - Rank, contestant number, name, barangay
  - Per-criteria average scores (from all judges) with weighted % and a mini progress bar
  - Final Score % and gap-to-first
- The table header is generated dynamically from `{{#each criteria}}` so it adapts to any event's criteria configuration.
- A print-specific title block (`class="hidden print-show"`) is revealed on print with the event name, judge count, and generated date.
- `scoringController.js` → `resultsPage()` builds the full `ranked` array with `breakdown` objects per contestant per criteria, which the template consumes.
- `GET /events/:eventId/results/export` produces a matching CSV for spreadsheet use.

**Nothing missing** for this requirement as specified. The tally sheet is screen-visible and printable.

---

### Requirement 3 — Automatic Ranking System (1st, 2nd, 3rd, etc.)

**Status: ✅ Exists (fully functional with tie-breaking)**

**Evidence in `scoringController.js`:**

```
// resultsPage(), ~line 225–285
ranked.sort((a, b) => b.finalScore - a.finalScore);
applyTieBreaking(ranked, criteria);
ranked.forEach((c, i) => { c.rank = i + 1; ... });
```

- **Weighted scoring formula:** `(avg / maxScore) * weight` per criterion, summed to `finalScore` (4 decimal places for precision).
- **Tie-breaking:** `applyTieBreaking()` (lines ~145–185) resolves ties by comparing per-criterion averages in descending weight order. If still tied, `tieBroken: false` is set and a "Tie" badge appears.
- **Rankings displayed:**
  - `results.xian`: Podium (1st/2nd/3rd with gold/silver/bronze styling) + full standings table with rank badges.
  - `display.xian`: Live public scoreboard with same podium and full list.
  - `public.xian`: Public-facing results page with rank badges.
- The same logic is applied consistently in `resultsPage`, `displayBoard`, `publicResults`, and `exportResults`.

**Nothing missing** for this requirement.

---

### Requirement 4 — Judge Score Visibility (judges see their own submitted scores)

**Status: ✅ Exists (pre-populated on scoring page)**

**Evidence in `scoringController.js`:**

```js
// scoringPage(), lines ~55–65
const scoreMap = {};
sSnap.docs.forEach(d => {
  const s = d.data();
  if (s.judgeId === judgeId) {          // ← filters to ONLY this judge's scores
    scoreMap[`${s.contestantId}|${s.criteriaId}`] = s.score;
  }
});

const matrix = contestants.map(c => ({
  ...c,
  scores: criteria.map(cr => ({
    ...
    value: scoreMap[`${c.id}|${cr.id}`] ?? "",  // ← passed to template
  })),
}));
```

**Evidence in `judge.xian`:**
- Line 177: `{{#if value}}{{value}}{{else}}—{{/if}}` displays the pre-loaded score in the big score display.
- Line 222: `value="{{value}}"` pre-fills the hidden `<input>` so the numpad restores its selected state (lines 362–367 in the JS: `// Restore existing value`).
- The judge can see every score they already submitted across all contestants and criteria on the same page they used to enter them.

**Nothing missing** for this requirement as specified.

---

### Requirement 5 — Score Editing Capability (modify after submission, with audit trail)

**Status: ⚠️ Partial**

**What works (implicit re-submission/overwrite):**

In `submitScores` (scoringController.js, lines ~100–145), score documents are written using:
```js
const docId = `${judgeId}_${contestantId}_${criteriaId}`;
setDoc(doc(db, "events", eventId, "scores", docId), { ... })
```

Because `setDoc` with a deterministic ID replaces the whole document, a judge who submits scores a second time simply **overwrites** the previous values. The scoring page pre-populates all previous scores (Req. 4), so a judge can change values and re-submit. This is the implicit editing mechanism.

**What is missing / incomplete:**

1. **No audit log entry for score edits.** The `audit_log` subcollection is written once on initial submission with `action: "scores_submitted"`. When a judge re-submits to overwrite existing scores, **the audit log entry is identical** — no `action: "scores_edited"`, no `previousScore`, no `newScore`, no diff. The full audit trail for edits does not exist.

   Evidence: `submitScores` has only one `addDoc(... audit_log ...)` call (lines ~149–157):
   ```js
   await addDoc(collection(db, "events", eventId, "audit_log"), {
     action:    "scores_submitted",
     judgeId,
     judgeName: req.session.userName || "Unknown",
     scoreCount: ...,
     timestamp: serverTimestamp(),
   });
   ```
   There is no logic to detect whether this is an initial submission or an edit.

2. **No dedicated edit UI.** There is no "Edit My Scores" button, modal, or separate route. The judge must navigate back to `/events/:eventId/scoring`, which shows their existing scores, change them, and re-submit the full form. This is functional but not explicitly communicated — the page says "Save Scores & Finish" not "Update / Edit Scores".

3. **No per-score timestamp of last modification.** The `score` document has a `submittedAt` field (serverTimestamp), but it is overwritten on re-submission. There is no `updatedAt` or `editHistory` array stored.

4. **Score lock blocks re-submission.** If the organizer has locked scoring (`ev.scoringLocked === true`), `submitScores` returns early, so judges cannot edit even if they need to fix a typo after the lock is applied. This may be intentional but conflicts with the edit requirement.

**Recommended implementation approach:**
1. **Detect edit vs. initial submission:** Before calling `setDoc`, check if a doc with `docId` already exists in Firestore. If it does, log `action: "score_edited"` with `previousScore` and `newScore` fields.
2. **Or use `updateDoc` with a history append:** Store score edits in an `editHistory` array field on the score document.
3. **Add a `lastEditedAt` field** alongside `submittedAt` so the audit record is timestamped.
4. **Update the UI copy** on the scoring page to communicate that judges are viewing and can update their previously submitted scores.
5. **Consider an explicit "Edit Mode"** toggle that makes the intent clear and logs edits separately from initial submissions.

---

## Audit Log — Current State

The `audit_log` subcollection (`events/{eventId}/audit_log`) is used in two places:

- **Written:** `scoringController.js` → `submitScores` — logs `scores_submitted` with `judgeId`, `judgeName`, `scoreCount`, `timestamp`. Written on every form submission (initial and re-submissions alike, indistinguishably).
- **Read:** `eventController.js` → `showEvent` — fetches and passes `auditLog` to `events/show.xian` (sorted newest-first with localized timestamp strings).

The `events/show.xian` view likely renders these entries in an activity log section (not read in this investigation, but the data is passed in). The log only captures submission events; it does **not** capture edits, score locks/unlocks (lock uses `updateDoc` on the event doc but does not write to `audit_log`), or judge assignments.

---

## Conclusions & Gap Summary

### Build immediately (fully missing):
- **Report Generation with Digital Signature** — requires installing a PDF library (`pdfkit` recommended for server-side simplicity), a new `reportController.js`, a new route, a new `views/scoring/report.xian` template, and a Firestore `report_signatures` subcollection to store judge attestations.

### Enhance (partially done):
- **Score Editing Audit Trail** — the mechanical overwrite works; add pre-check logic in `submitScores` to distinguish edits from initial submissions, write a separate `action: "score_edited"` audit entry with `previousScore`/`newScore`, and add a `lastEditedAt` field to the score document.
- **Edit UI clarity** — update the scoring page header/button copy to inform judges they can update previously submitted scores.

### Already done (no work needed):
- Tally Sheet — `results.xian` "Official Tabulation Sheet" section
- Automatic Ranking — `scoringController.js` `resultsPage` with `applyTieBreaking`
- Judge Score Visibility — `scoringPage` filters by `judgeId` and pre-populates the form

---

## Files Relevant to Implementation

| File | Role |
|---|---|
| `controllers/scoringController.js` | All scoring logic — add edit detection and PDF generation here or in a new reportController |
| `views/scoring/results.xian` | Tally sheet and ranking display — add signature block here for print |
| `views/scoring/judge.xian` | Judge scoring form — update UI copy for "edit" awareness |
| `routes/index.js` | Add new report/edit routes here |
| `package.json` | Add `pdfkit` or `puppeteer` dependency |
| `controllers/eventController.js` | Reads `audit_log` — the event detail page already surfaces audit entries |
