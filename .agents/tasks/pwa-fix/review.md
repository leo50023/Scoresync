# PWA Fix — Code Review

## Verdict: APPROVED

No blockers found. All task requirements are satisfied.

---

## Checklist

### manifest.json
| Requirement | Status |
|---|---|
| `name` present | ✓ "ScoreSync — Competition Management" |
| `short_name` present | ✓ "ScoreSync" |
| `description` present | ✓ |
| `start_url` present | ✓ "/dashboard" |
| `scope` added | ✓ "/" |
| `display` present | ✓ "standalone" |
| `orientation` present | ✓ "portrait-primary" |
| `background_color` = #0f1117 | ✓ |
| `theme_color` = #6366f1 | ✓ |
| `icons` with `purpose` fields | ✓ "any maskable" on both entries |
| `categories` present | ✓ |
| `screenshots` field present | ✓ (empty array — spec-valid) |

### sw.js
| Requirement | Status |
|---|---|
| Cache version incremented to v14 | ✓ CACHE_STATIC = 'scoresync-static-v14' |
| `/api/` routes explicitly skipped | ✓ Line 48: `if (url.pathname.startsWith('/api/')) return;` |
| Cache-first for static assets retained | ✓ unchanged |
| Network-only fallthrough retained | ✓ unchanged |

### head.xian
| Requirement | Status |
|---|---|
| `mobile-web-app-capable` meta tag added | ✓ Line 11 |
| `apple-mobile-web-app-title` meta tag added | ✓ Line 14 |
| `slideUpIn` keyframe added | ✓ Lines 921–925 |
| PWA install prompt IIFE present | ✓ Lines 1055–1118 |
| IIFE fires on `beforeinstallprompt` | ✓ |
| IIFE skips `/login` and `/register` | ✓ Line 1059 (exact pathname check) |
| Banner shown after 2-second delay | ✓ `setTimeout(..., 2000)` |
| Dismiss stores timestamp in localStorage | ✓ `pwa-install-dismissed` |
| 7-day suppression check on entry | ✓ `Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000` |
| Sidebar toggle preserved | ✓ |
| Page loader preserved | ✓ |
| SW registration preserved (now inside `load` event) | ✓ |
| bfcache `pageshow` handler preserved | ✓ |

---

## Notes (non-blocking)

- **`screenshots: []`** — Empty array is valid per the Web App Manifest spec; no browser installability criteria require non-empty screenshots.
- **`theme-color` meta tag** — Still reads `#10b981` in `<head>`, while `manifest.json` now declares `#6366f1`. These can differ intentionally (meta tag controls browser chrome outside the standalone app shell). The task did not require updating the meta tag.
- **`lang` field removed** — Was `"en-PH"` in the old manifest; not present in the new one. The task did not require this field, and its absence is not a spec violation.
