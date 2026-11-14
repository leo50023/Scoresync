# Review: Overall Results Event Series Feature

## Commit
`010b9d0` — feat: Event Series: Overall Results page with cross-sub-event contestant ranking

---

## Evidence Checked

| Check | Result |
|---|---|
| `where` import in scoringController.js | PASS — added to firestore import destructuring (line 3) |
| Route `GET /events/:eventId/series-results` present | PASS — routes/index.js line 174 |
| Route uses `requireRole("admin","organizer","tabulator")` | PASS — confirmed in diff and grep |
| `seriesOverallResults` imported in routes/index.js | PASS — added to import block |
| Redirect guard for non-series events (`!parentSnap.data().isEventSeries`) | PASS — controller line ~1427 |
| Overall Results button in `{{#if isAdmin}}` section of show.xian | PASS — after Results button, inside `{{#if event.isEventSeries}}` |
| Overall Results button in `{{#if isOrganizer}}` section of show.xian | PASS — after Results button, inside `{{#if event.isEventSeries}}` |
| Overall Results button in `{{#if isTabulator}}` section of show.xian | **FAIL — no isTabulator section exists in show.xian toolbar; button absent for tabulators** |
| `{{overallJson}}` / `{{subEventResultsJson}}` escaping in script tag | **FAIL — double-brace `{{}}` used; Handlebars HTML-escapes output, corrupting JSON in script tag** |
| `node --check` on scoringController.js | PASS (commit message) |
| `node --check` on routes/index.js | PASS (commit message) |

---

## Blockers

### BLOCKER 1 — JSON data HTML-escaped in script tag, breaking `JSON.parse()`

**File:** `views/scoring/series-results.xian`, lines 98–100

**Code:**
```
<script id="series-data" type="application/json">{
  "overall": {{overallJson}},
  "subEventResults": {{subEventResultsJson}}
}</script>
```

**Root cause:** The `.xian` engine wraps `hbs.__express` without altering Handlebars' default HTML escaping. `{{expression}}` encodes `&`, `<`, `>`, and `"` to HTML entities. Any contestant name or event name containing these characters (e.g. `"Miss & Mr. Fiesta"`, `"Category <A>"`) will be emitted as `&amp;`, `&lt;`, etc., producing malformed JSON that `JSON.parse()` will throw on. The breakdown table JS will then catch the error, hide the table, and show the empty-state message instead.

**Consequence:** Breakdown table silently fails for any event/contestant name with `&`, `<`, `>`, or `"`. Even without special characters, a JSON string value containing `>` (e.g. scores serialised via `JSON.stringify`) may be corrupted.

**Correction:** Use triple-brace unescaped output for both variables:
```
"overall": {{{overallJson}}},
"subEventResults": {{{subEventResultsJson}}}
```
Both values are produced by `JSON.stringify()` server-side, which guarantees valid JSON. No additional escaping is needed inside `type="application/json"` script tags.

---

### BLOCKER 2 — Overall Results button missing for `tabulator` role in show.xian

**File:** `views/events/show.xian`

**Root cause:** The task requires the button to appear for `isAdmin`, `isOrganizer`, and `isTabulator` sections. The action toolbar in `show.xian` has sections for `{{#if isAdmin}}`, `{{#if isJudge}}`, `{{#if isEncoder}}`, and `{{#if isOrganizer}}`. There is no `{{#if isTabulator}}` block in this file at all — a grep for both `isTabulator` and `Tabulator` returns no matches. The commit message itself only claims the button was added for "isAdmin and isOrganizer sections," omitting isTabulator.

**Consequence:** A logged-in tabulator visiting the parent event's show page sees no "Overall Results" button, even though the route is accessible to them. The route guard is correct (`requireRole("admin","organizer","tabulator")`), but the UI entry point is missing for that role.

**Correction:** Add a `{{#if isTabulator}}` toolbar section (or add the button to an existing tabulator section if one exists elsewhere in the view) with the same `{{#if event.isEventSeries}}` guard:
```handlebars
{{#if isTabulator}}
<a href="/events/{{event.id}}/results" class="btn-sm btn-sm-green">...</a>
{{#if event.isEventSeries}}
<a href="/events/{{event.id}}/series-results" class="btn-sm btn-sm-purple text-xs">
  <svg ...></svg> Overall Results
</a>
{{/if}}
{{/if}}
```

---

## Non-blocking Observations (out of scope)

- Score computation falls back through three field shapes (`scoreDoc.score`, `judgeScoreArr[0][cr.id]`, `judgeScoreArr[0].scores[cr.id]`) without clear priority; this is a pre-existing scoring architecture issue, not introduced by this change.
- `subEventResults` passed to `res.render()` includes `scoreByName` objects whose keys are raw Firestore data; the template strips them in `subEventResultsForTemplate` correctly for JSON serialisation.
