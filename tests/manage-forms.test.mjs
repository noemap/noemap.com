import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  applyManageForm,
  ManageInputError,
} from "../src/domain/manage-forms.ts";
import { createProvisionalRelease } from "../src/domain/provisional.ts";
import { supabaseConfiguration } from "../src/server/supabase-config.ts";
import { createDatasetBackup } from "../src/domain/manage-backup.ts";
import { validateEditableDocument } from "../src/domain/editable.ts";

const original = JSON.parse(
  await readFile(
    new URL("../src/data/public-release.json", import.meta.url),
    "utf8",
  ),
);
const batch = original.batches[0];
const node = batch.node_candidates.find((item) => item.type === "work");
function form(operation, target, values = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    operation,
    target,
    batch: batch.batch_id,
    ...values,
  }))
    if (Array.isArray(value)) value.forEach((item) => data.append(key, item));
    else data.set(key, value);
  return data;
}
const nodeFields = () => ({
  label: node.label,
  summary_ja: "資料に基づく要約の修正。",
  aliases: "Treatise\nTreatise\n人間本性論",
  scope_limit: node.scope_limit ?? "",
  evidence: JSON.stringify(node.evidence),
});

test("node edits preserve the immutable input, source bibliography, permissions and pending review", () => {
  const before = structuredClone(original);
  const { document } = applyManageForm(
    original,
    form("update-node", node.id, nodeFields()),
  );
  assert.deepEqual(original, before);
  assert.equal(
    document.batches[0].node_candidates.find((n) => n.id === node.id)
      .summary_ja,
    "資料に基づく要約の修正。",
  );
  assert.deepEqual(document.batches[0].sources, before.batches[0].sources);
  assert.deepEqual(document.human_review, {
    status: "pending",
    reviewer: null,
    approved_at: null,
  });
  assert.deepEqual(
    document.batches.map((b) => [
      b.status,
      b.database_imported,
      b.published,
      b.human_review.status,
    ]),
    before.batches.map((b) => [
      b.status,
      b.database_imported,
      b.published,
      b.human_review.status,
    ]),
  );
  assert.deepEqual(
    document.batches[0].node_candidates.find((n) => n.id === node.id).aliases,
    ["Treatise", "人間本性論"],
  );
});

test("source-backed new scoped concepts and atomic claims remain provisional", () => {
  const { document } = applyManageForm(
    original,
    form("add-node", "", {
      type: "concept",
      label: "本文の概念（ヒュームの文脈）",
      summary_ja: "本文を読むための要約。",
      aliases: "",
      scope_limit: "現代の一般概念へ統合しない。",
      definition_scope: "参照した著作の意味に限定する。",
      evidence: JSON.stringify(node.evidence),
    }),
  );
  assert.equal(createProvisionalRelease(document).catalog().length, 37);
  const added = document.batches[0].node_candidates.at(-1);
  const next = applyManageForm(
    document,
    form("update-claim", "", {
      subject: added.id,
      nature: "position",
      text_ja: "資料を読むための短い記述。",
      attribution: "NOEMAPによる資料要約",
      limit: "この箇所の文脈に限定する。",
      evidence: JSON.stringify(node.evidence),
    }),
  ).document;
  assert.equal(
    next.batches[0].assertion_candidates.length,
    batch.assertion_candidates.length + 1,
  );
  assert.equal(next.publication_status, "provisional");
  assert.equal(next.human_review.status, "pending");
});

test("missing locators, invalid URLs, missing concept scope and duplicate relationships are rejected", () => {
  assert.throws(
    () =>
      applyManageForm(
        original,
        form("update-node", node.id, {
          ...nodeFields(),
          evidence: JSON.stringify([
            { source: batch.sources[0].id, locator: "", role: "support" },
          ]),
        }),
      ),
    ManageInputError,
  );
  const source = batch.sources[0];
  assert.throws(
    () =>
      applyManageForm(
        original,
        form("update-source", source.id, {
          title: source.title,
          edition: source.edition,
          url: "http://example.com",
          author: source.author ?? "",
          host: source.host ?? "",
        }),
      ),
    ManageInputError,
  );
  assert.throws(
    () =>
      applyManageForm(
        original,
        form("add-node", "", {
          ...nodeFields(),
          type: "concept",
          definition_scope: "",
        }),
      ),
    ManageInputError,
  );
  const relation = batch.relationship_candidates[0];
  assert.throws(
    () =>
      applyManageForm(
        original,
        form("update-relationship", "", {
          from: relation.from,
          to: relation.to,
          relation_reason: relation.reason,
          basis: relation.basis,
        }),
      ),
    ManageInputError,
  );
});

test("source display edits retain original and observed edition metadata and usage conditions", () => {
  const source = batch.sources[0];
  const { document } = applyManageForm(
    original,
    form("update-source", source.id, {
      title: `${source.title} — 表示情報を補足`,
      edition: source.edition,
      url: source.url,
      author: source.author ?? "",
      host: source.host ?? "",
    }),
  );
  const edited = document.batches[0].sources[0];
  for (const key of Object.keys(source).filter(
    (key) => !["title", "edition", "url", "author", "host"].includes(key),
  ))
    assert.deepEqual(edited[key], source[key]);
});

test("withdrawal hides all dependent reader projections and cannot be undone by this form", () => {
  const sourceId = node.evidence[0].source;
  const { document } = applyManageForm(
    original,
    form("withdraw-source", sourceId),
  );
  assert.ok(document.withdrawn.sources.includes(sourceId));
  const reader = createProvisionalRelease(document);
  assert.equal(reader.publicNode(node.id), null);
  assert.ok(
    !reader
      .searchNodes(node.label)
      .items.some((item) => item.href.endsWith(node.id)),
  );
  assert.throws(
    () =>
      applyManageForm(
        document,
        form("withdraw-source", sourceId, { restore: "1" }),
      ),
    ManageInputError,
  );
});

test("tampered human approval never passes an editor save", () => {
  const bad = structuredClone(original);
  bad.human_review = {
    status: "approved",
    reviewer: "invented",
    approved_at: "2026-10-03",
  };
  assert.throws(
    () => applyManageForm(bad, form("update-node", node.id, nodeFields())),
    ManageInputError,
  );
});

test("connection configuration rejects privileged keys and credential-bearing URLs", () => {
  const before = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  try {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fixture.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_fixture";
    assert.equal(supabaseConfiguration(), null);
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture";
    assert.equal(supabaseConfiguration()?.url, "https://fixture.supabase.co");
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      "https://user:secret@fixture.supabase.co";
    assert.equal(supabaseConfiguration(), null);
  } finally {
    if (before.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = before.url;
    if (before.key === undefined)
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = before.key;
  }
});

test("latest/draft backup preserves restoreable content and withdrawals while excluding actor/Auth/private metadata", () => {
  const current = structuredClone(original);
  current.batches[0].sources[0].private_credentials = {
    password: "fixture-sensitive-value",
    email: "private@example.invalid",
  };
  current.batches[0].private_notes = { token: "fixture-sensitive-value" };
  const draft = structuredClone(current);
  draft.release_id = "backup-draft-v2";
  draft.withdrawn.sources = [node.evidence[0].source];
  const backup = createDatasetBackup({
    current: {
      document: current,
      actor_label: "editor@example.invalid",
      reason: "private reason",
    },
    draft: { document: draft, actor_label: "editor@example.invalid" },
  });
  assert.deepEqual(Object.keys(backup), [
    "schema_version",
    "kind",
    "human_review",
    "current",
    "draft",
  ]);
  assert.equal(backup.kind, "noemap-backup");
  assert.equal(backup.human_review, "pending");
  assert.equal(backup.current.release_id, original.release_id);
  assert.deepEqual(backup.draft.withdrawn, draft.withdrawn);
  assert.deepEqual(
    backup.current.batches[1].sources[0].original_work,
    original.batches[1].sources[0].original_work,
  );
  assert.deepEqual(
    backup.current.batches[0].sources[0].usage_permissions,
    original.batches[0].sources[0].usage_permissions,
  );
  assert.equal(backup.current.batches[0].sources[0].stored_full_text, false);
  assert.ok(!JSON.stringify(backup).includes("fixture-sensitive-value"));
  assert.ok(!JSON.stringify(backup).includes("@example.invalid"));
  validateEditableDocument(backup.current);
  validateEditableDocument(backup.draft);
});

test("backup refuses contact/Auth values placed in an otherwise exportable content field", () => {
  const current = structuredClone(original);
  current.batches[0].sources[0].title = "private@example.invalid";
  assert.throws(
    () => createDatasetBackup({ current: { document: current }, draft: null }),
    /連絡先/,
  );
});
