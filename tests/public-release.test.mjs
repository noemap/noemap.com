import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { loadBatches } from "../scripts/content-review.mjs";
import {
  canonicalJson,
  createPublicRelease,
  manifestUrl,
  readSourceHashes,
  releaseUrl,
  sha256,
  validatePublicRelease,
  verifiedTemporalRecords,
} from "../scripts/build-public-release.mjs";

const batches = await loadBatches();
const sourceHashes = await readSourceHashes();
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const release = createPublicRelease(batches, manifest, sourceHashes);

test("the sealed public artifact is deterministic and keeps all 36 nodes awaiting human review", async () => {
  const checkedIn = JSON.parse(await readFile(releaseUrl, "utf8"));
  assert.deepEqual(checkedIn, release);
  assert.deepEqual(validatePublicRelease(checkedIn, manifest), []);
  assert.equal(
    release.batches.reduce(
      (sum, batch) => sum + batch.node_candidates.length,
      0,
    ),
    36,
  );
  assert.equal(release.publication_status, "provisional");
  assert.deepEqual(release.human_review, {
    status: "pending",
    reviewer: null,
    approved_at: null,
  });
  assert.equal(release.authorized_by, "project-owner-request");
  assert.equal(release.manifest_sha256, sha256(canonicalJson(manifest)));
  assert.deepEqual(release.batches, batches);
  for (const batch of release.batches) {
    assert.equal(batch.status, "draft");
    assert.equal(batch.published, false);
    assert.equal(batch.database_imported, false);
    assert.equal(batch.human_review.status, "pending");
    assert.ok(
      batch.sources.every((source) => source.stored_full_text === false),
    );
  }
});

test("publication dates refer to original works and keep Locke's actual and title-page years separate", () => {
  assert.deepEqual(release.temporal_records, verifiedTemporalRecords(batches));
  assert.deepEqual(
    release.temporal_records.map((record) => record.start_earliest),
    [1641, 1689, 1690, 1739, 1740],
  );
  assert.ok(
    release.temporal_records.every(
      (record) =>
        record.role === "publication" &&
        record.precision === "year" &&
        record.calendar === "unspecified",
    ),
  );
  const actual = release.temporal_records.find(
    (record) => record.id === "locke-t-original-publication",
  );
  const title = release.temporal_records.find(
    (record) => record.id === "locke-t-title-page-year",
  );
  assert.equal(actual.node_id, "locke-work");
  assert.match(actual.limit, /人格同一性の章/);
  assert.match(title.date_label, /標題頁/);
  assert.equal(title.start_earliest, 1690);
  assert.notEqual(actual.start_earliest, title.start_earliest);
  for (const record of release.temporal_records) {
    assert.equal(record.start_earliest, record.start_latest);
    assert.equal(record.end_earliest, null);
    assert.equal(record.end_latest, null);
    assert.ok(record.evidence.length > 0);
    assert.ok(
      record.evidence.every((evidence) => evidence.source && evidence.locator),
    );
  }
});

test("a changed raw input is rejected even when semantic JSON content is unchanged", () => {
  const changedHashes = structuredClone(sourceHashes);
  changedHashes[0].sha256 = sha256("different whitespace in a pinned file");
  assert.throws(
    () => createPublicRelease(batches, manifest, changedHashes),
    /source file SHA-256 mismatch/,
  );
});

const mutationChecks = [
  [
    "fabricated public human reviewer",
    (candidate) => {
      candidate.human_review = {
        status: "approved",
        reviewer: "AI",
        approved_at: "2026-10-03",
      };
    },
    /human review must remain pending/,
  ],
  [
    "fake visual approval status",
    (candidate) => {
      candidate.publication_status = "approved";
    },
    /identity\/status mismatch/,
  ],
  [
    "fake extra reviewed flag",
    (candidate) => {
      candidate.reviewed = true;
    },
    /unexpected public release field/,
  ],
  [
    "changed manifest seal",
    (candidate) => {
      candidate.manifest_sha256 = "0".repeat(64);
    },
    /manifest SHA-256 mismatch/,
  ],
  [
    "changed wording after sealing",
    (candidate) => {
      candidate.batches[0].node_candidates[0].summary_ja += "変更";
    },
    /batch content SHA-256 mismatch/,
  ],
  [
    "source lookup failure",
    (candidate) => {
      candidate.batches[0].assertion_candidates[0].evidence[0].source =
        "missing";
    },
    /unknown source/,
  ],
  [
    "missing evidence location",
    (candidate) => {
      candidate.batches[0].assertion_candidates[0].evidence[0].locator = "";
    },
    /exact source location/,
  ],
  [
    "unsupported influence",
    (candidate) => {
      candidate.batches[0].relationship_candidates[0].predicate = "influenced";
    },
    /unsupported historical/,
  ],
  [
    "invented birth year",
    (candidate) => {
      candidate.temporal_records[0].role = "birth";
    },
    /verified publication metadata/,
  ],
  [
    "lost title-page qualification",
    (candidate) => {
      candidate.temporal_records[2].limit = "";
    },
    /verified publication metadata/,
  ],
  [
    "unsealed withdrawal",
    (candidate) => {
      candidate.withdrawn.sources.push(candidate.batches[0].sources[0].id);
    },
    /withdrawal manifest mismatch/,
  ],
];
for (const [label, mutate, expected] of mutationChecks)
  test(`reject ${label}`, () => {
    const candidate = structuredClone(release);
    mutate(candidate);
    assert.match(
      validatePublicRelease(candidate, manifest).join("\n"),
      expected,
    );
  });

// Re-seal deliberate mutations here so these tests exercise content policy,
// not just a mismatching checksum.
function resealBatch(candidate, candidateManifest, index = 0) {
  candidateManifest.batch_files[index].content_sha256 = sha256(
    canonicalJson(candidate.batches[index]),
  );
  candidate.manifest_sha256 = sha256(canonicalJson(candidateManifest));
}
for (const [label, mutate, expected] of [
  [
    "stored primary full text",
    (source) => {
      source.stored_full_text = true;
    },
    /stored_full_text must/,
  ],
  [
    "missing explicit storage restriction",
    (source) => {
      delete source.stored_full_text;
    },
    /stored_full_text must/,
  ],
  [
    "full_text field with unknown permission",
    (source) => {
      source.full_text = "copied primary text";
    },
    /full text or source excerpts/,
  ],
  [
    "nested fullTextContent field",
    (source) => {
      source.original_work = { fullTextContent: "copied text" };
    },
    /full text or source excerpts/,
  ],
  [
    "generic source body field",
    (source) => {
      source.body = "copied primary text";
    },
    /source body fields/,
  ],
])
  test(`reject ${label} even with a matching content digest`, () => {
    const candidate = structuredClone(release);
    const candidateManifest = structuredClone(manifest);
    mutate(candidate.batches[0].sources[0]);
    resealBatch(candidate, candidateManifest);
    assert.match(
      validatePublicRelease(candidate, candidateManifest).join("\n"),
      expected,
    );
  });

test("sealed known withdrawal IDs are accepted and unknown IDs are rejected", () => {
  const candidate = structuredClone(release);
  const candidateManifest = structuredClone(manifest);
  candidateManifest.withdrawn.sources.push(candidate.batches[0].sources[0].id);
  candidate.withdrawn = structuredClone(candidateManifest.withdrawn);
  candidate.manifest_sha256 = sha256(canonicalJson(candidateManifest));
  assert.deepEqual(validatePublicRelease(candidate, candidateManifest), []);
  candidateManifest.withdrawn.sources.push("missing");
  candidate.withdrawn = structuredClone(candidateManifest.withdrawn);
  candidate.manifest_sha256 = sha256(canonicalJson(candidateManifest));
  assert.match(
    validatePublicRelease(candidate, candidateManifest).join("\n"),
    /unknown withdrawn sources ID/,
  );
});

test("a forged approval inside the publication authorization remains rejected", () => {
  const candidateManifest = structuredClone(manifest);
  candidateManifest.human_review.status = "approved";
  assert.throws(
    () => createPublicRelease(batches, candidateManifest, sourceHashes),
    /human review must remain pending/,
  );
});
