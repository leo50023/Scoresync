# Review: Low Score Warning System — `views/scoring/judge.xian`

## Evidence Summary

Diff read from `git diff HEAD~1..HEAD`. File read at lines 175–215, 270–292, 1155–1220, 1370–1445. Commit message recorded verification.

---

## Requirement Checklist

### Thresholds
| Threshold | Required | Code |
|---|---|---|
| < 50 → CRITICAL (red) | ✓ | `if (val < 50)` → red border + red glow |
| 50–74 → WARNING (amber) | ✓ | `else if (val < 75)` → amber border + amber glow |
| ≥ 75 → Normal (clear) | ✓ | `else` → restore gold border, clear boxShadow, hide warnDiv |

Task specified thresholds are exactly matched.

### Three simultaneous warning displays
1. **Input border color change** — ✓ `entryEl.style.borderColor` set for all three cases. `boxShadow` added for critical/warning, cleared for normal.
2. **Inline `<div class="score-warning-msg">`** — ✓ Rendered after `.judge-score-row` closing tag inside `{{#each scores}}` loop, wrapped in `{{#unless ../../readOnly}}`. JS writes `textContent`, `color`, and `display:block/none`.
3. **Toast notification** — ✓ `showScoreToast` called only from the warning section (after `if (entryEl.readOnly) return;`). `_toastTimer` variable present. `#score-toast` div added once to the page. 3 s auto-dismiss with 300 ms opacity fade. No call on page load (restoreDraft and init block do not invoke `handleScoreInput`).

### Key constraints
- **`handleScoreInput` extended, not replaced** — ✓ Function is `window.handleScoreInput = function(entryEl)` retaining all prior logic (NaN/empty guard, clamp to max, `updateBox`, `schedSave`), with the warning block appended after.
- **`showScoreToast` and `_toastTimer` added** — ✓ `var _toastTimer = null; window.showScoreToast = function(msg, type) { … }` at line ~1379.
- **`#score-toast` added once** — ✓ Single `<div id="score-toast">` placed before `</main>`.
- **`score-warning-msg` after `.judge-score-row` in `{{#each scores}}`** — ✓ Directly follows the closing `</div>` of `.judge-score-row` at line 196.
- **readOnly: warnings must NOT appear** — ✓ Template guard `{{#unless ../../readOnly}}` prevents rendering the div. JS guard `if (entryEl.readOnly) return;` exits before any warning or toast code.
- **Submit behavior unchanged** — ✓ No modifications to submit handler or hidden `score-input` values.
- **No existing functionality broken** — ✓ NaN/empty-clear path gains only boxShadow reset and warnMsg hide (safe). Clamp-to-max path gains only boxShadow reset (safe). `updateBox` and `schedSave` calls unchanged.

### Observed minor notes (non-blocking)
- When `val > max` the code first sets `borderColor` to the clamped-exceeded red (`rgba(239,68,68,0.6)`), then the warning section immediately overrides it. Since `val` is clamped to `max` before the warning check, `max` is typically ≥ 75, so the `else` branch restores to gold. For edge cases where `max < 75` the clamped value would still be < 75 and trigger the warning branch — this is an acceptable and consistent behaviour, not a correctness failure.
- The diff's toast text uses plain `⚠` while the live file uses `⚠️` (emoji variant). Both are cosmetically equivalent.

---

## Verdict

**APPROVED** — All required behaviours are present and correct. No blockers found.
