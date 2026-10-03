import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateEditableDocument,
  preserveWithdrawals,
} from "../src/domain/editable.ts";
import { createProvisionalRelease } from "../src/domain/provisional.ts";
const original = JSON.parse(
  await readFile(
    new URL("../src/data/public-release.json", import.meta.url),
    "utf8",
  ),
);
test("current 36 source-backed items pass editable validation", () => {
  assert.doesNotThrow(() => validateEditableDocument(original));
});
test("editor cannot manufacture completed human review", () => {
  const changed = structuredClone(original);
  changed.human_review = {
    status: "approved",
    reviewer: "test",
    approved_at: "2026-10-03",
  };
  assert.throws(() => validateEditableDocument(changed));
});
test("full text and oversized body are refused before storage", () => {
  for (const extra of [
    { raw_html: "source" },
    { stored_full_text: true },
    { extra: "x".repeat(6001) },
  ]) {
    const changed = structuredClone(original);
    Object.assign(changed.batches[0].sources[0], extra);
    assert.throws(() => validateEditableDocument(changed));
  }
});
test("broken source links and missing qualifications cannot be saved", () => {
  const changed = structuredClone(original);
  changed.batches[0].node_candidates.find(
    (node) => node.evidence?.length,
  ).evidence[0].source = "missing";
  assert.throws(() => validateEditableDocument(changed));
});
test("restore preserves withdrawals and hides dependent pages", () => {
  const changed = structuredClone(original);
  changed.withdrawn.sources.push("hume-s-appendix");
  const restored = preserveWithdrawals(original, changed);
  assert.deepEqual(restored.withdrawn, changed.withdrawn);
  assert.equal(
    createProvisionalRelease(restored).catalog().length,
    createProvisionalRelease(changed).catalog().length,
  );
  assert.ok(
    createProvisionalRelease(restored).catalog().length <
      createProvisionalRelease(original).catalog().length,
  );
  assert.equal(original.withdrawn.sources.length, 0);
});
test("restore retains tombstones for newer stable IDs", () => {
  const changed = structuredClone(original);
  changed.withdrawn.sources.push("source-added-after-original");
  const restored = preserveWithdrawals(original, changed);
  assert.doesNotThrow(() => validateEditableDocument(restored));
  assert.ok(restored.withdrawn.sources.includes("source-added-after-original"));
});
