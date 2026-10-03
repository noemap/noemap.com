import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBatches, validateBatch } from "../scripts/content-review.mjs";

test("source-backed drafts have 30–50 scoped nodes and complete internal references", async () => {
  const batches = await loadBatches();
  assert.equal(batches.length, 3);
  for (const batch of batches) assert.deepEqual(validateBatch(batch), []);
});

const mutations = [
  [
    "unknown evidence source",
    (b) => (b.assertion_candidates[0].evidence[0].source = "missing"),
    /unknown source/,
  ],
  [
    "missing exact location",
    (b) => (b.assertion_candidates[0].evidence[0].locator = ""),
    /source location/,
  ],
  [
    "unknown relationship target",
    (b) => (b.relationship_candidates[0].to = "missing"),
    /invalid endpoints/,
  ],
  [
    "unsupported influence relation",
    (b) => (b.relationship_candidates[0].predicate = "influenced"),
    /unsupported historical/,
  ],
  [
    "fabricated human review",
    (b) => (b.human_review = { status: "approved", reviewer: "AI" }),
    /human review must remain pending/,
  ],
  [
    "accidental publication flag",
    (b) => (b.published = true),
    /must not claim import or publication/,
  ],
  [
    "duplicate draft identity",
    (b) => (b.node_candidates[1].id = b.node_candidates[0].id),
    /duplicate ID/,
  ],
  [
    "editorial relationship without basis",
    (b) => (b.relationship_candidates[0].basis = []),
    /editorial basis/,
  ],
  [
    "use permission without grounds",
    (b) => {
      b.sources[0].usage_permissions.quote_display = "allowed";
      delete b.sources[0].permission_basis;
    },
    /allowed use requires/,
  ],
];
for (const [label, mutate, expected] of mutations)
  test(`reject ${label}`, async () => {
    const batches = await loadBatches();
    const batch = structuredClone(batches[0]);
    mutate(batch);
    assert.match(validateBatch(batch).join("\n"), expected);
  });
