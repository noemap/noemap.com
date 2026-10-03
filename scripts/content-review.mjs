import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const batchFiles = [
  "hume-reviewed.json",
  "locke-reviewed.json",
  "descartes-reviewed.json",
];
const types = new Set(["question", "person", "concept", "work"]);
const roles = new Set(["support", "qualification", "counter"]);
const nonempty = (x) => typeof x === "string" && x.trim().length > 0;

// This validates draft structure, not truth or a person's publication approval.
export function validateBatch(batch) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  check(nonempty(batch.batch_id), "batch_id is required");
  check(batch.status === "draft", "only draft batches are accepted");
  check(
    batch.human_review?.status === "pending" &&
      batch.human_review?.reviewer == null &&
      batch.human_review?.approved_at == null,
    "human review must remain pending without a fabricated reviewer",
  );
  check(
    batch.database_imported === false && batch.published === false,
    "draft package must not claim import or publication",
  );
  const arrays = [
    "node_candidates",
    "sources",
    "assertion_candidates",
    "relationship_candidates",
  ];
  for (const name of arrays)
    check(
      Array.isArray(batch[name]) && batch[name].length > 0,
      `${name} must be nonempty`,
    );
  if (errors.length) return errors;
  const ids = new Set();
  for (const x of [
    ...batch.node_candidates,
    ...batch.sources,
    ...batch.assertion_candidates,
  ]) {
    check(nonempty(x.id) && !ids.has(x.id), `missing or duplicate ID: ${x.id}`);
    ids.add(x.id);
  }
  const nodes = new Set(batch.node_candidates.map((x) => x.id));
  const sources = new Set(batch.sources.map((x) => x.id));
  const claims = new Set(batch.assertion_candidates.map((x) => x.id));
  function evidence(items, owner) {
    check(
      Array.isArray(items) && items.length > 0,
      `${owner}: evidence is required`,
    );
    for (const e of items ?? []) {
      check(sources.has(e.source), `${owner}: unknown source ${e.source}`);
      check(nonempty(e.locator), `${owner}: exact source location is required`);
      check(roles.has(e.role), `${owner}: invalid evidence role`);
    }
  }
  function basis(items, owner) {
    check(
      Array.isArray(items) && items.length > 0,
      `${owner}: editorial basis is required`,
    );
    for (const id of items ?? [])
      check(claims.has(id), `${owner}: unknown assertion basis ${id}`);
  }
  for (const s of batch.sources) {
    let validUrl = false;
    try {
      const u = new URL(s.url);
      validUrl = u.protocol === "https:" && !u.username && !u.password;
    } catch {}
    check(validUrl, `${s.id}: source URL must use HTTPS`);
    check(
      nonempty(s.title) && nonempty(s.language) && nonempty(s.edition),
      `${s.id}: title, language and observed edition are required`,
    );
    check(
      /^\d{4}-\d{2}-\d{2}$/.test(s.accessed_date ?? ""),
      `${s.id}: access date is required`,
    );
    check(
      s.usage_permissions &&
        Object.values(s.usage_permissions).every((v) =>
          ["unknown", "allowed", "denied"].includes(v),
        ),
      `${s.id}: use permissions must be explicit`,
    );
    if (Object.values(s.usage_permissions ?? {}).includes("allowed"))
      check(
        nonempty(s.permission_basis),
        `${s.id}: allowed use requires documented grounds`,
      );
  }
  for (const n of batch.node_candidates) {
    check(
      types.has(n.type) && nonempty(n.label) && nonempty(n.summary_ja),
      `${n.id}: type, label and summary are required`,
    );
    if (n.type === "concept")
      check(
        nonempty(n.definition_scope),
        `${n.id}: concept identity needs an explicit scope`,
      );
    if (n.nature === "editorial") basis(n.basis, n.id);
    else evidence(n.evidence, n.id);
  }
  for (const a of batch.assertion_candidates) {
    check(
      a.kind === "claim" &&
        ["position", "fact_report", "interpretation", "editorial"].includes(
          a.nature,
        ),
      `${a.id}: invalid assertion kind/nature`,
    );
    check(
      nodes.has(a.subject) && nonempty(a.text_ja),
      `${a.id}: subject and text are required`,
    );
    check(
      nonempty(a.attribution) && nonempty(a.limit),
      `${a.id}: attribution and limits are required`,
    );
    evidence(a.evidence, a.id);
  }
  for (const [i, r] of batch.relationship_candidates.entries()) {
    check(
      nodes.has(r.from) && nodes.has(r.to) && r.from !== r.to,
      `relation ${i}: invalid endpoints`,
    );
    check(
      r.nature === "editorial" && nonempty(r.reason),
      `relation ${i}: comparison must be labeled editorial with a reason`,
    );
    basis(r.basis, `relation ${i}`);
    check(
      !["influenced", "same_as", "caused"].includes(r.predicate),
      `relation ${i}: unsupported historical or equivalence predicate`,
    );
  }
  return errors;
}

export async function loadBatches(
  root = new URL("../content-review/", import.meta.url),
) {
  const batches = await Promise.all(
    batchFiles.map(async (file) =>
      JSON.parse(await readFile(new URL(file, root), "utf8")),
    ),
  );
  const errors = batches.flatMap((b) =>
    validateBatch(b).map((e) => `${b.batch_id}: ${e}`),
  );
  const ids = new Set();
  for (const b of batches)
    for (const item of [
      ...b.node_candidates,
      ...b.sources,
      ...b.assertion_candidates,
    ]) {
      if (ids.has(item.id)) errors.push(`cross-batch duplicate ID: ${item.id}`);
      ids.add(item.id);
    }
  const count = batches.reduce((n, b) => n + b.node_candidates.length, 0);
  if (count < 30 || count > 50)
    errors.push(`expected 30–50 scoped draft nodes, got ${count}`);
  if (errors.length) throw new Error(errors.join("\n"));
  return batches;
}

export async function buildReview() {
  const batches = await loadBatches();
  const template = await readFile(
    new URL("../content-review/review-template.html", import.meta.url),
    "utf8",
  );
  const json = JSON.stringify(batches)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  await writeFile(
    new URL("../content-review/index.html", import.meta.url),
    template.replace("__BATCH_DATA__", json),
  );
  const result = {
    date: "2026-10-03",
    status: "passed",
    scope: "draft structure and reference integrity only",
    human_review: "pending",
    database_imported: false,
    published: false,
    batches: batches.length,
    nodes: batches.reduce((n, b) => n + b.node_candidates.length, 0),
    assertions: batches.reduce((n, b) => n + b.assertion_candidates.length, 0),
    relationships: batches.reduce(
      (n, b) => n + b.relationship_candidates.length,
      0,
    ),
    sources: batches.reduce((n, b) => n + b.sources.length, 0),
    files: batchFiles,
    commands: [
      "node scripts/content-review.mjs",
      "node tests/content-review.test.mjs",
    ],
    remaining: [
      "人による文面・根拠・版・編集関係の照合",
      "既存Entityとの同一性・ID対応",
      "資料の用途と公開版集合の確認",
      "DB下書き登録と公開経路の検証",
    ],
  };
  await mkdir(new URL("../docs/validation/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    new URL("../docs/validation/content-review-results.json", import.meta.url),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await buildReview();
