import test from "node:test";
import assert from "node:assert/strict";
import {
  hasPeoplesChoiceCriterion,
  parseEventCriteria,
} from "../utils/eventCriteria.js";

test("parses criteria from Express extended URL-encoded body shape", () => {
  const criteria = parseEventCriteria({
    criteria: {
      name: ["Beauty of Face", "Beauty of Figure"],
      weight: ["25", "20"],
      max: ["100", "100"],
      desc: ["", ""],
    },
  });

  assert.deepEqual(criteria, [
    { name: "Beauty of Face", description: "", weight: 25, maxScore: 100 },
    { name: "Beauty of Figure", description: "", weight: 20, maxScore: 100 },
  ]);
});

test("supports single criterion values and legacy flat form keys", () => {
  assert.deepEqual(
    parseEventCriteria({
      "criteria[name]": "  Accuracy  ",
      "criteria[weight]": "100",
      "criteria[max]": "50",
      "criteria[desc]": "  Precision  ",
    }),
    [{ name: "Accuracy", description: "Precision", weight: 100, maxScore: 50 }]
  );
});

test("omits incomplete criteria", () => {
  assert.deepEqual(
    parseEventCriteria({
      criteria: {
        name: ["Valid", "Missing weight", ""],
        weight: ["100", "", "20"],
        max: ["100", "100", "100"],
      },
    }),
    [{ name: "Valid", description: "", weight: 100, maxScore: 100 }]
  );
});

test("detects common People's Choice criterion name variants", () => {
  assert.equal(hasPeoplesChoiceCriterion(["People’s Choice"]), true);
  assert.equal(hasPeoplesChoiceCriterion(["PEOPLE'S CHOICE AWARD"]), true);
  assert.equal(hasPeoplesChoiceCriterion(["People Choice"]), true);
  assert.equal(hasPeoplesChoiceCriterion(["Peoples Choice Award"]), true);
  assert.equal(hasPeoplesChoiceCriterion(["Audience Impact"]), false);
  assert.equal(hasPeoplesChoiceCriterion([]), false);
});
