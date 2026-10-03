import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { format } from "prettier";
import { batchFiles, loadBatches, validateBatch } from "./content-review.mjs";

export const manifestUrl = new URL(
  "../content-release/manifest.json",
  import.meta.url,
);
export const releaseUrl = new URL(
  "../src/data/public-release.json",
  import.meta.url,
);
const sourceRoot = new URL("../content-review/", import.meta.url);
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const digestPattern = /^[a-f0-9]{64}$/;
const pendingReview = (review) =>
  review?.status === "pending" &&
  review.reviewer === null &&
  review.approved_at === null &&
  Object.keys(review).sort().join(",") === "approved_at,reviewer,status";

// Sorting object keys makes the content seal independent of indentation.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");
export const relationshipId = (batch, index) =>
  batch.relationship_candidates[index].id ??
  `${batch.batch_id}:relation:${index}`;

export async function readSourceHashes(root = sourceRoot) {
  return Promise.all(
    batchFiles.map(async (file) => {
      const bytes = await readFile(new URL(file, root));
      return {
        file,
        sha256: sha256(bytes),
        content_sha256: sha256(
          canonicalJson(JSON.parse(bytes.toString("utf8"))),
        ),
      };
    }),
  );
}

function rejectFullText(value, path, errors) {
  if (typeof value === "string" && value.length > 6000)
    errors.push(
      `${path}: long source/body content is not permitted in a summary release`,
    );
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replaceAll(/[-_]/g, "").toLowerCase();
    if (
      normalized !== "fulltextpublication" &&
      (/^(fulltext|rawtext|sourcetext|originaltext|documenttext|documentbody|rawhtml|rawmarkdown|pdftext)/.test(
        normalized,
      ) ||
        /^(transcript|quotedtext|excerpts?)$/.test(normalized))
    )
      errors.push(
        `${path}.${key}: full text or source excerpts are not permitted`,
      );
    if (normalized === "storedfulltext" && child !== false)
      errors.push(`${path}.${key}: stored_full_text must be false`);
    rejectFullText(child, `${path}.${key}`, errors);
  }
}

// These records describe original publication metadata, never online edition dates
// or a person's lifetime. An unspecified calendar avoids inventing old/new style.
export function verifiedTemporalRecords(batches) {
  const hume = batches.find((b) =>
    b.node_candidates.some((n) => n.id === "hume-w-treatise"),
  );
  const locke = batches.find((b) =>
    b.node_candidates.some((n) => n.id === "locke-work"),
  );
  const descartes = batches.find((b) =>
    b.node_candidates.some((n) => n.id === "descartes-w-meditations"),
  );
  const humeYears = hume?.bibliographic_review?.original_publication;
  const lockeOriginal = locke?.sources.find(
    (s) => s.id === "locke-source-pg-text",
  )?.original_work;
  const descartesOriginal = descartes?.sources.find(
    (s) => s.id === "descartes-s-johnston",
  )?.original_work;
  if (
    humeYears?.volumes_1_and_2?.year !== 1739 ||
    humeYears?.volume_3?.year !== 1740 ||
    lockeOriginal?.original_title_page_year !== 1690 ||
    !lockeOriginal?.original_publication?.startsWith("1689") ||
    descartesOriginal?.first_publication_year !== 1641
  )
    throw new Error(
      "verified original publication metadata changed; temporal records require source rechecking",
    );
  const record = (
    id,
    node_id,
    year,
    date_label,
    source,
    locator,
    text_ja,
    limit,
  ) => ({
    id,
    node_id,
    role: "publication",
    date_label,
    original_label: String(year),
    calendar: "unspecified",
    normalization: "astronomical_year",
    precision: "year",
    start_earliest: year,
    start_latest: year,
    end_earliest: null,
    end_latest: null,
    evidence: [{ source, locator, role: "support" }],
    text_ja,
    limit,
  });
  return [
    record(
      "descartes-t-original-publication",
      "descartes-w-meditations",
      1641,
      "1641年 — ラテン語初版",
      "descartes-s-johnston",
      "TRANSLATOR’S NOTE: first Latin edition (1641)",
      "ラテン語初版の刊行年。",
      "訳者注による書誌情報。今回参照した英訳の公開年ではない。原刊本との直接照合は未実施。",
    ),
    record(
      "locke-t-original-publication",
      "locke-work",
      1689,
      "1689年 — 実際の初刊年",
      "locke-source-edition-note",
      "Published / Copytext / publication paragraph",
      "初刊年。標題頁の年とは区別する。",
      "サイトの書誌説明は1689年12月刊、標題頁1690年と区別する。月日は正規化しない。人格同一性の章の追加年ではない。",
    ),
    record(
      "locke-t-title-page-year",
      "locke-work",
      1690,
      "1690年 — 初版標題頁の年",
      "locke-source-edition-note",
      "Published / Copytext / publication paragraph: title page year",
      "初版標題頁に記された年。",
      "実際の初刊年1689年とは別の表示年。第二版や人格同一性の章の刊行年として扱わない。原刊標題頁の再照合待ち。",
    ),
    record(
      "hume-t-volumes-1-2",
      "hume-w-treatise",
      1739,
      "1739年 — 第1・第2巻",
      "hume-s-copytexts",
      "§1 List of Editions, Treatise paragraph: volumes 1 and 2",
      "第1・第2巻の刊行年。",
      "オンライン版の公開年ではない。現在のBook区分と原刊巻の区分を混同しない。",
    ),
    record(
      "hume-t-volume-3",
      "hume-w-treatise",
      1740,
      "1740年 — 第3巻",
      "hume-s-copytexts",
      "§1 List of Editions, Treatise paragraph: volume 3",
      "第3巻の刊行年。",
      "全巻が1739年に刊行されたとは表示しない。オンラインの本文編集日とは別。",
    ),
  ];
}

export function validateManifest(manifest) {
  const errors = [];
  if (manifest?.schema_version !== 1)
    errors.push("manifest schema_version must be 1");
  if (!nonempty(manifest?.release_id))
    errors.push("manifest release_id is required");
  if (manifest?.publication_status !== "provisional")
    errors.push("publication status must remain provisional");
  if (!pendingReview(manifest?.human_review))
    errors.push(
      "human review must remain pending without a fabricated reviewer",
    );
  if (
    manifest?.authorized_by !== "project-owner-request" ||
    manifest?.authorized_date !== "2026-10-03" ||
    manifest?.authorization_scope !==
      "provisional-publication-with-human-content-review-pending"
  )
    errors.push(
      "explicit project owner provisional-publication authorization is required",
    );
  if (manifest?.expected_node_count !== 36)
    errors.push("this release is authorized for 36 scoped nodes");
  if (
    !Array.isArray(manifest?.batch_files) ||
    manifest.batch_files.length !== batchFiles.length
  )
    errors.push("manifest must pin the three reviewed batch files");
  else
    for (const [index, entry] of manifest.batch_files.entries()) {
      if (
        entry.file !== batchFiles[index] ||
        !digestPattern.test(entry.sha256 ?? "") ||
        !digestPattern.test(entry.content_sha256 ?? "")
      )
        errors.push(`invalid source hash entry ${index}`);
    }
  for (const key of ["sources", "nodes", "assertions", "relationships"])
    if (
      !Array.isArray(manifest?.withdrawn?.[key]) ||
      !manifest.withdrawn[key].every(nonempty) ||
      new Set(manifest.withdrawn[key]).size !== manifest.withdrawn[key].length
    )
      errors.push(`withdrawn.${key} must contain unique IDs`);
  for (const key of Object.keys(manifest?.withdrawn ?? {}))
    if (!["sources", "nodes", "assertions", "relationships"].includes(key))
      errors.push(`unknown withdrawal collection: ${key}`);
  if (!Array.isArray(manifest?.temporal_records))
    errors.push("temporal_records is required");
  const fields = new Set([
    "schema_version",
    "release_id",
    "publication_status",
    "human_review",
    "authorized_by",
    "authorized_date",
    "authorization_scope",
    "expected_node_count",
    "batch_files",
    "withdrawn",
    "temporal_records",
  ]);
  for (const key of Object.keys(manifest ?? {}))
    if (!fields.has(key)) errors.push(`unexpected manifest field: ${key}`);
  rejectFullText(manifest, "manifest", errors);
  return errors;
}

export function validatePublicRelease(release, manifest) {
  const errors = validateManifest(manifest);
  if (errors.length) return errors;
  if (
    release?.schema_version !== 1 ||
    release?.release_id !== manifest.release_id ||
    release?.publication_status !== "provisional"
  )
    errors.push("public release identity/status mismatch");
  if (!pendingReview(release?.human_review))
    errors.push(
      "public human review must remain pending without a fabricated reviewer",
    );
  if (release?.authorized_by !== "project-owner-request")
    errors.push("public authorization mismatch");
  if (release?.manifest_sha256 !== sha256(canonicalJson(manifest)))
    errors.push("manifest SHA-256 mismatch");
  const fields = new Set([
    "schema_version",
    "release_id",
    "publication_status",
    "human_review",
    "authorized_by",
    "manifest_sha256",
    "batches",
    "withdrawn",
    "temporal_records",
  ]);
  for (const key of Object.keys(release ?? {}))
    if (!fields.has(key))
      errors.push(`unexpected public release field: ${key}`);
  if (
    !Array.isArray(release?.batches) ||
    release.batches.length !== batchFiles.length
  )
    return [...errors, "public release requires three batches"];
  const ids = new Set();
  const collections = {
    sources: new Set(),
    nodes: new Set(),
    assertions: new Set(),
    relationships: new Set(),
  };
  let nodeCount = 0;
  for (const [index, batch] of release.batches.entries()) {
    errors.push(
      ...validateBatch(batch).map((error) => `${batch.batch_id}: ${error}`),
    );
    if (
      sha256(canonicalJson(batch)) !==
      manifest.batch_files[index].content_sha256
    )
      errors.push(`${batch.batch_id}: batch content SHA-256 mismatch`);
    nodeCount += batch.node_candidates?.length ?? 0;
    for (const [key, collection] of [
      ["node_candidates", "nodes"],
      ["sources", "sources"],
      ["assertion_candidates", "assertions"],
    ])
      for (const item of batch[key] ?? []) {
        if (ids.has(item.id))
          errors.push(`cross-batch duplicate ID: ${item.id}`);
        ids.add(item.id);
        collections[collection].add(item.id);
      }
    for (const [relationIndex] of (
      batch.relationship_candidates ?? []
    ).entries())
      collections.relationships.add(relationshipId(batch, relationIndex));
    for (const source of batch.sources ?? []) {
      if (source.stored_full_text !== false)
        errors.push(`${source.id}: stored_full_text must be explicitly false`);
      for (const key of ["text", "body", "content", "html", "markdown", "data"])
        if (Object.hasOwn(source, key))
          errors.push(`${source.id}.${key}: source body fields are forbidden`);
    }
  }
  if (nodeCount !== manifest.expected_node_count)
    errors.push("public node count differs from authorization");
  if (canonicalJson(release.withdrawn) !== canonicalJson(manifest.withdrawn))
    errors.push("withdrawal manifest mismatch");
  for (const [key, withdrawnIds] of Object.entries(manifest.withdrawn))
    for (const id of withdrawnIds)
      if (!collections[key].has(id))
        errors.push(`unknown withdrawn ${key} ID: ${id}`);
  try {
    const expectedTemporals = verifiedTemporalRecords(release.batches);
    if (
      canonicalJson(manifest.temporal_records) !==
        canonicalJson(expectedTemporals) ||
      canonicalJson(release.temporal_records) !==
        canonicalJson(expectedTemporals)
    )
      errors.push("temporal records differ from verified publication metadata");
  } catch (error) {
    errors.push(error.message);
  }
  const temporalIds = new Set();
  for (const temporal of release.temporal_records ?? []) {
    if (temporalIds.has(temporal.id))
      errors.push(`duplicate temporal ID: ${temporal.id}`);
    temporalIds.add(temporal.id);
    if (!collections.nodes.has(temporal.node_id))
      errors.push(`unknown temporal node: ${temporal.node_id}`);
    for (const evidence of temporal.evidence ?? [])
      if (!collections.sources.has(evidence.source))
        errors.push(`unknown temporal source: ${evidence.source}`);
  }
  rejectFullText(release, "release", errors);
  return errors;
}

export function createPublicRelease(batches, manifest, sourceHashes) {
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length) throw new Error(manifestErrors.join("\n"));
  if (canonicalJson(sourceHashes) !== canonicalJson(manifest.batch_files))
    throw new Error("source file SHA-256 mismatch; the pinned content changed");
  const release = {
    schema_version: 1,
    release_id: manifest.release_id,
    publication_status: "provisional",
    human_review: { status: "pending", reviewer: null, approved_at: null },
    authorized_by: "project-owner-request",
    manifest_sha256: sha256(canonicalJson(manifest)),
    batches: structuredClone(batches),
    withdrawn: structuredClone(manifest.withdrawn),
    temporal_records: structuredClone(manifest.temporal_records),
  };
  const errors = validatePublicRelease(release, manifest);
  if (errors.length) throw new Error(errors.join("\n"));
  return release;
}

export async function buildPublicRelease() {
  const batches = await loadBatches();
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const sourceHashes = await readSourceHashes();
  const release = createPublicRelease(batches, manifest, sourceHashes);
  await mkdir(new URL("../src/data/", import.meta.url), { recursive: true });
  await writeFile(
    releaseUrl,
    await format(JSON.stringify(release), { parser: "json" }),
  );
  console.log(
    JSON.stringify({
      release_id: release.release_id,
      publication_status: release.publication_status,
      human_review: release.human_review.status,
      nodes: manifest.expected_node_count,
      temporal_records: release.temporal_records.length,
      manifest_sha256: release.manifest_sha256,
    }),
  );
  return release;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--print-source-hashes") {
    // A read-only aid for a deliberate re-pin after reviewing the input diff.
    // Never silently update the publication authorization or its content seal.
    await loadBatches();
    console.log(JSON.stringify(await readSourceHashes(), null, 2));
  } else if (args.length === 0) await buildPublicRelease();
  else
    throw new Error(
      "usage: node scripts/build-public-release.mjs [--print-source-hashes]",
    );
}
