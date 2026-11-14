# Notification bell panel v2: premium redesign + dismiss/filter/seen state

The notification panel is reworked from a basic flyout into a fully stateful component. The header gains a 2-row layout (title+badge+clear-all on row 1, volume controls on row 2), filter tabs (All / Critical / Info) sit between the header and the list, and the footer moves the timestamp from the header to a flex row alongside "View all events". Functionally, every alert can now be dismissed to localStorage, seen state drives the unread badge independently of the API count, and clicking a notification closes the panel before navigating. The 15-second poll and the API endpoint are untouched.

Watch for: **(confirmed)** the "new alert" reset wipes the entire `ss-notif-dismissed` list rather than only new IDs, so a user who dismissed old alerts loses those dismissals the moment a new alert arrives. **(confirmed)** seen state is marked inside `loadNotifications()` on fetch completion — the badge drops to zero on the next poll even if the user opened and immediately closed the panel. **(possible)** `escHtml` is used for the URL inside the JS `onclick` string, which would produce broken JS for any URL containing a single quote.

**Verdict**: NEEDS_CHANGES

---

## High-level view

The header restructure hits every spec point: 0.9rem/weight-900 title, 3-state badge pill, clear-all button hidden at zero alerts, 28px volume row with correct IDs. The filter tab HTML and `setNotifFilter` are present and cover All / Critical / Info as spec'd.

The dismissed-list reset on new alerts is too aggressive — it removes dismissals for every alert in the store, not just the newly arrived ones. A user who dismissed five old alerts and then receives one new one will see all five re-appear. The fix is to filter only new IDs out of the dismissed list rather than calling `localStorage.removeItem('ss-notif-dismissed')`.

Seen state is set the moment `loadNotifications()` completes, before the user has had a chance to read anything. The badge therefore drops to zero on the next 15-second poll even if the panel was opened and immediately closed. The practical effect is that the bell badge is unreliable as an unread indicator after the first open.

The commit also deletes seven `.agents/tasks/` planning documents (1,900+ lines) alongside the feature change — an unrelated bundle that makes bisecting harder.

---

<details>
<summary>Issues (4)</summary>

1. **Dismissed-list nuke on new alert** — `localStorage.removeItem('ss-notif-dismissed')` wipes all prior dismissals when any new alert ID appears. Fix: replace the `removeItem` call with a filter that removes only `newIds` from the existing dismissed array: `setDismissed(getDismissed().filter(function(id){ return newIds.indexOf(id)===-1; }))`.

2. **Badge drops to zero after first panel open** — `loadNotifications()` calls `addSeen(fetchedIds)` immediately on fetch completion, so the background poll's `updateBadgeFromData` zeroes the badge on the next tick regardless of how long the panel was open. Record seen state on panel *close* (or after a minimum dwell) rather than on fetch, if the badge is intended to reflect unread count.

3. **`escHtml` applied to URL in JS string context** — `escHtml(link)` in the `onclick` attribute encodes `'` as `&#x27;`, which is not resolved by the JS parser; a URL with a single quote produces broken JS. Use a separate JS-string escape (`link.replace(/'/g, "\\'")`) for the onclick value and keep `escHtml` only for the `href`.

4. **Unrelated files bundled in commit** — seven `.agents/tasks/` planning artifacts are deleted in the same commit as the feature. These should be in a separate cleanup commit.

</details>

---

<details>
<summary>Details</summary>

## Dismissed-list reset scope

Inside `pollNotifications`, when `newIds.length > 0` and it is not the first poll, the code calls `localStorage.removeItem('ss-notif-dismissed')`. This deletes the entire dismissed list, not just entries for the new IDs. Any alert the user had explicitly cleared will reappear the next time they open the panel. The correct fix removes only `newIds` from the dismissed array:

```js
var dismissed = getDismissed();
var updated = dismissed.filter(function(id) { return newIds.indexOf(id) === -1; });
setDismissed(updated);
```

## Seen-state timing and badge accuracy

`loadNotifications()` marks every fetched ID as seen synchronously after the fetch resolves. The background poll's `updateBadgeFromData` computes the badge as `undismissed AND unseen`, which will be zero after the first panel open. The badge will show zero for 15 seconds even if the user opened the panel for half a second and didn't read anything. Whether this is acceptable depends on the product intent, but it makes the bell badge unreliable as an "unread" indicator after the first interaction.

## `escHtml` in JS onclick context

The notification item template builds an `onclick` attribute like this:

```js
'onclick="event.preventDefault();_notifCloseAndNavigate(\'' + escHtml(link) + '\')"'
```

`escHtml` replaces `'` with `&#x27;`. Browsers resolve HTML entities in attribute values before passing them to the HTML parser, but the JS engine sees the raw attribute string — `&#x27;` is a literal five-character sequence, not a quote. A URL with a single quote (possible in query strings) would produce a JS syntax error. The fix is a separate escape for the JS context: `link.replace(/'/g, "\\'")`.

## Unrelated deletions

The commit removes seven `.agents/tasks/` files totaling ~1,900 lines of planning and review artifacts. These files have no relationship to the notification panel changes. The deletions don't affect production behavior but make the diff harder to read and the commit harder to bisect.

</details>

---

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `views/partials/navbar.xian` | Notification panel full redesign — header 2-row layout, filter tabs, animated empty state, seen/dismissed state, `closeAndNavigate`, `setNotifVolume`, `clearAllNotifs`, `setNotifFilter` |
| `.agents/tasks/plan.md` | Deleted (planning artifact) |
| `.agents/tasks/review.md` | Deleted (planning artifact) |
| `.agents/tasks/mobile-fix-plan.md` | Deleted (planning artifact) |
| `.agents/tasks/mobile-fix-review.md` | Deleted (planning artifact) |
| `.agents/tasks/scoring-investigation.md` | Deleted (planning artifact) |
| `.agents/tasks/voting-plan.md` | Deleted (planning artifact) |
| `.agents/tasks/2026-10-10-215611-review.md` | Deleted (planning artifact) |

Full diff: `git diff HEAD~1 -- views/partials/navbar.xian`

</details>
