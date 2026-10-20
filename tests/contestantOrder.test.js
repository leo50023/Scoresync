import test from "node:test";
import assert from "node:assert/strict";
import { sortContestantsByNumber } from "../utils/contestantOrder.js";

test("sorts contestants by number numerically", () => {
  const contestants = [
    { id: "ten", number: "10" },
    { id: "two", number: "2" },
    { id: "one", number: "1" },
  ];

  assert.deepEqual(
    sortContestantsByNumber(contestants).map(contestant => contestant.id),
    ["one", "two", "ten"]
  );
});

test("keeps missing contestant numbers after numbered contestants without mutating input", () => {
  const contestants = [
    { id: "missing" },
    { id: "two", number: "2" },
    { id: "blank", number: " " },
  ];

  assert.deepEqual(
    sortContestantsByNumber(contestants).map(contestant => contestant.id),
    ["two", "missing", "blank"]
  );
  assert.deepEqual(contestants.map(contestant => contestant.id), ["missing", "two", "blank"]);
});
