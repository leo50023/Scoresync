# Multi-Event Series — Code Review

## Evidence Summary

Diff read from `git diff master...HEAD`. Full source of `controllers/eventController.js`, relevant sections of all three modified views, and `index.js` (Handlebars helper registrations) were read directly from the worktree.

Verification recorded in the commit message: `node --check on eventController.js passed with exit 0` — syntax only, no runtime tests.

---

## Findings

### BLOCKER 1 — `contestants.length` always displays 0 in sub-events grid

**File / lines:** `controllers/eventController.js` — `showEvent`, the `subEvents` mapping block (~line 203–213); `views/events/show.xian` sub-events grid (~line 904)

**Evidence:**
- Contestants are stored exclusively as a Firestore sub-collection (`events/{id}/contestants`), confirmed by `contestantController.js` line 9 comment and every other call in the codebase: `getDocs(collection(db, EVENTS, req.params.id, "contestants"))`.
- The event root document never contains a `contestants` array field (search over all controllers confirmed no `contestants: [...]` stored on the event doc).
- In `showEvent`, the sub-event objects are built from the event document's data only:

  ```js
  contestants: sd.contestants || [],   // eventController.js ~line 211
  ```

  `sd.contestants` is always `undefined` on the Firestore document, so this always resolves to `[]`.

**User-visible consequence:** The sub-events grid in `show.xian` renders `{{contestants.length}}` → always `0 contestants` for every sub-event, regardless of actual contestant count.

**Correction:** Either (a) fetch the sub-collection count per sub-event (one `getDocs` per sub-event inside the existing `try` block), or (b) drop the contestants count from the sub-event card since the data isn't available without an extra query per sub-event.

---

### BLOCKER 2 — Deleting a child event does not remove its ID from the parent's `subEvents` array

**File / lines:** `controllers/eventController.js` — `deleteEvent` (~lines 371–380)

**Evidence:**
The existing `deleteEvent` handler clears `parentEventId`/`parentEventName` on children when a **parent** is deleted, but there is no reciprocal cleanup when a **child** (sub-event) is deleted. `arrayRemove` is not imported and is never called. The parent's `subEvents` array is only written via `arrayUnion` during creation.

**User-visible consequence:** After a sub-event is deleted, the parent event's `show` page still counts it in `Sub-Events (N)` and renders a broken card for it. The card's `<a href="/events/{{id}}">` redirects to a deleted document, which triggers the "Event not found" flash and redirect — but only after the user clicks the stale card. The parent's sub-event count in `index.xian` (`{{subEvents.length}}`) is also permanently inflated.

**Correction:** When deleting an event that has a non-empty `parentEventId`, call `updateDoc` on the parent with `arrayRemove(req.params.id)` to remove it from the parent's `subEvents`. Import `arrayRemove` from `firebase/firestore`.

---

## Non-Blocking Observations (out of scope, noted for awareness)

- `updateEvent` does not update `isEventSeries`, `parentEventId`, or `parentEventName`, so series membership cannot be changed after creation. This is not explicitly in scope but could confuse users.
- `preParentId` is interpolated into a `<script>` block as `'{{preParentId}}'`. Handlebars HTML-encodes it (`'` → `&#x27;`), which is not JS-safe encoding. Because the value comes from `req.query.parentEventId` (untrusted URL input), a crafted URL could break the string literal. Practical risk is low since Firestore IDs are alphanumeric, but the pattern is incorrect. Not filed as a blocker because it requires a deliberately malformed URL and produces only a client-side script error, not code execution.
- Both `isAdmin` and `isOrganizer` get separate `{{#if}}` blocks rendering the identical "+ Add Sub-Event" link in `show.xian`, resulting in two buttons being rendered if the user somehow holds both roles (not possible in this app's role model, but the duplication is fragile).
