import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createProvisionalRelease } from "../src/domain/provisional.ts";
import { projectPublicDocument } from "../src/domain/public-projection.ts";

const original = JSON.parse(
  await readFile(
    new URL("../src/data/public-release.json", import.meta.url),
    "utf8",
  ),
);
const relationId = (batch, index) =>
  batch.relationship_candidates[index].id ??
  `${batch.batch_id}:relation:${index}`;
const collection = {
  question: "questions",
  person: "people",
  concept: "concepts",
  work: "books",
};
const fresh = () => structuredClone(original);

function assertEquivalent(raw) {
  const expected = createProvisionalRelease(raw);
  const projected = projectPublicDocument(raw);
  // Round-trip through JSON to exercise the exact anonymous stored payload.
  const actual = createProvisionalRelease(
    JSON.parse(JSON.stringify(projected)),
  );
  assert.deepEqual(actual.catalog(), expected.catalog());
  assert.deepEqual(actual.explorationHome(), expected.explorationHome());
  for (const offset of [0, 20, 40]) {
    assert.deepEqual(
      actual.timelineNodes(offset),
      expected.timelineNodes(offset),
    );
    for (const type of [undefined, "question", "person", "concept", "work"])
      assert.deepEqual(
        actual.searchNodes("", type, offset),
        expected.searchNodes("", type, offset),
      );
  }
  for (const query of [
    "ヒューム",
    "人格同一性",
    "ＤＡＶＩＤ　ＨＵＭＥ",
    "忘",
    "%_",
  ])
    assert.deepEqual(actual.searchNodes(query), expected.searchNodes(query));
  for (const batch of raw.batches) {
    for (const node of batch.node_candidates) {
      const expectedNode = expected.publicNode(node.id);
      assert.deepEqual(actual.publicNode(node.id), expectedNode);
      assert.deepEqual(
        actual.resolveNode(collection[node.type], node.id),
        expected.resolveNode(collection[node.type], node.id),
      );
      assert.deepEqual(
        actual.evidence(`${node.id}-summary`),
        expected.evidence(`${node.id}-summary`),
      );
      if (expectedNode)
        for (const key of [
          node.id,
          expectedNode.id,
          expectedNode.revision_id,
        ]) {
          assert.deepEqual(actual.publicNode(key), expected.publicNode(key));
          assert.deepEqual(
            actual.resolveNode(collection[node.type], key),
            expected.resolveNode(collection[node.type], key),
          );
          assert.deepEqual(actual.nodePage(key), expected.nodePage(key));
          for (const offset of [0, 20])
            assert.deepEqual(
              actual.neighbors(key, offset),
              expected.neighbors(key, offset),
            );
        }
    }
    for (const claim of batch.assertion_candidates) {
      assert.deepEqual(actual.evidence(claim.id), expected.evidence(claim.id));
      const proof = expected.evidence(claim.id);
      if (proof)
        for (const key of [proof.id, proof.revision_id])
          assert.deepEqual(actual.evidence(key), expected.evidence(key));
    }
    for (const [index, relation] of batch.relationship_candidates.entries()) {
      for (const key of [
        relationId(batch, index),
        `${relation.from}->${relation.to}`,
      ]) {
        assert.deepEqual(actual.evidence(key), expected.evidence(key));
        const proof = expected.evidence(key);
        if (proof)
          for (const id of [proof.id, proof.revision_id])
            assert.deepEqual(actual.evidence(id), expected.evidence(id));
      }
    }
  }
  for (const date of raw.temporal_records) {
    assert.deepEqual(actual.evidence(date.id), expected.evidence(date.id));
    const proof = expected.evidence(date.id);
    if (proof)
      for (const key of [proof.id, proof.revision_id])
        assert.deepEqual(actual.evidence(key), expected.evidence(key));
  }
  assert.deepEqual(projected.withdrawn, {
    sources: [],
    nodes: [],
    assertions: [],
    relationships: [],
  });
  assert.equal(projected.release_id, raw.release_id);
  assert.equal(projected.publication_status, "provisional");
  assert.deepEqual(projected.human_review, {
    status: "pending",
    reviewer: null,
    approved_at: null,
  });
  return projected;
}

test("all 36 nodes, slugs, UUIDs, evidence and five timeline records exactly match the raw adapter", () => {
  const projection = assertEquivalent(fresh());
  assert.equal(
    projection.batches.reduce(
      (total, batch) => total + batch.node_candidates.length,
      0,
    ),
    36,
  );
  assert.equal(projection.temporal_records.length, 5);
  assert.deepEqual(projectPublicDocument(projection), projection);
});

test("the anonymous JSON allowlist omits private/unknown metadata and source bodies at every level", () => {
  const raw = fresh();
  const marker = "PRIVATE-METADATA-DO-NOT-PUBLISH";
  raw.owner_user_id = marker;
  raw.manifest_sha256 = marker;
  raw.history = [{ document: marker }];
  raw.batches[0].purpose = marker;
  raw.batches[0].human_review.private_note = marker;
  raw.batches[0].node_candidates[0].private_note = marker;
  raw.batches[0].node_candidates.find(
    (node) => node.evidence?.length,
  ).evidence[0].private_note = marker;
  raw.batches[0].sources[0].full_text = marker;
  raw.batches[0].sources[0].original_work = {
    raw_document: marker,
    reviewer: marker,
  };
  raw.batches[0].sources[0].credentials = { token: marker };
  raw.batches[0].sources[0].permission_basis = marker;
  raw.batches[0].assertion_candidates[0].private_note = marker;
  raw.batches[0].relationship_candidates[0].private_note = marker;
  raw.temporal_records[0].private_note = marker;
  const result = projectPublicDocument(raw);
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "schema_version",
      "release_id",
      "publication_status",
      "human_review",
      "authorized_by",
      "batches",
      "withdrawn",
      "temporal_records",
    ].sort(),
  );
  assert.equal(
    result.batches[0].sources[0].title,
    raw.batches[0].sources[0].title,
  );
  assert.equal(
    result.batches[0].sources[0].edition,
    raw.batches[0].sources[0].edition,
  );
  assert.equal(result.batches[0].sources[0].url, raw.batches[0].sources[0].url);
});

const sourceProof = createProvisionalRelease(original).evidence(
  "hume-a-appendix-open",
);
const appendixRevisionId = sourceProof.sources.find((source) =>
  source.url.endsWith("/texts/t/app"),
).source_revision_id;

test("normalization preserves every withdrawal kind when a new release changes revision UUIDs", () => {
  const api = createProvisionalRelease(original);
  const node = api.publicNode("hume-p-hume");
  const claim = api.evidence("hume-a-appendix-open");
  const relationshipKey = relationId(original.batches[0], 0);
  const relationship = api.evidence(relationshipKey);
  const date = api.evidence(original.temporal_records[0].id);
  const inputs = [
    ["sources", "hume-s-appendix", appendixRevisionId],
    ["nodes", "hume-p-hume", node.id],
    ["nodes", "hume-p-hume", node.revision_id],
    ["assertions", "hume-a-appendix-open", claim.id],
    ["assertions", "hume-a-appendix-open", claim.revision_id],
    ["relationships", relationshipKey, relationship.id],
    ["relationships", relationshipKey, relationship.revision_id],
    [
      "relationships",
      relationshipKey,
      `${original.batches[0].relationship_candidates[0].from}->${original.batches[0].relationship_candidates[0].to}`,
    ],
    ["assertions", original.temporal_records[0].id, date.id],
    ["assertions", original.temporal_records[0].id, date.revision_id],
  ];
  for (const [category, stableId, withdrawal] of inputs) {
    const raw = fresh();
    raw.withdrawn[category] = [withdrawal, "unknown-old-tombstone"];
    const before = createProvisionalRelease(raw);
    const normalized = before.normalizedWithdrawals();
    assert.ok(normalized[category].includes(stableId));
    assert.ok(normalized[category].includes(withdrawal));
    assert.ok(normalized[category].includes("unknown-old-tombstone"));
    raw.withdrawn = normalized;
    raw.release_id = "noemap-after-persistent-save";
    assert.deepEqual(
      createProvisionalRelease(raw).visibility(),
      before.visibility(),
    );
  }
});

test("normalization is detached, idempotent and adds only directly withdrawn IDs", () => {
  const raw = fresh();
  raw.withdrawn.sources = [appendixRevisionId];
  const api = createProvisionalRelease(raw);
  const result = api.normalizedWithdrawals();
  assert.deepEqual(result.nodes, []);
  assert.deepEqual(result.assertions, []);
  assert.deepEqual(result.relationships, []);
  assert.deepEqual(raw.withdrawn.sources, [appendixRevisionId]);
  assert.deepEqual(
    createProvisionalRelease({
      ...raw,
      withdrawn: result,
    }).normalizedWithdrawals(),
    result,
  );
  result.sources.length = 0;
  assert.ok(api.normalizedWithdrawals().sources.includes("hume-s-appendix"));
});

test("normalization preserves the adapter's existing explicit relationship ID semantics", () => {
  const raw = fresh();
  const first = raw.batches[0].relationship_candidates[0];
  first.id = "explicit-editorial-edge";
  const alias = `${first.from}->${first.to}`;
  const proof = createProvisionalRelease(raw).evidence(first.id);
  raw.withdrawn.relationships = [alias];
  let api = createProvisionalRelease(raw);
  // Existing explicit relations use their ID as their withdrawal key; the
  // route alias does not directly withdraw one. Normalization must agree.
  assert.ok(api.evidence(first.id));
  assert.deepEqual(api.normalizedWithdrawals().relationships, [alias]);
  raw.withdrawn.relationships.push(proof.revision_id);
  api = createProvisionalRelease(raw);
  raw.withdrawn = api.normalizedWithdrawals();
  assert.ok(raw.withdrawn.relationships.includes(first.id));
  raw.release_id = "noemap-after-explicit-edge-save";
  assert.equal(createProvisionalRelease(raw).evidence(first.id), null);
});

for (const id of ["hume-s-appendix", appendixRevisionId])
  test(`source withdrawal ${id} removes the whole qualification dependency closure`, () => {
    const raw = fresh();
    raw.withdrawn.sources.push(id);
    const marker = "WITHDRAWN-APPENDIX-CONTENT";
    const source = raw.batches[0].sources.find(
      (source) => source.id === "hume-s-appendix",
    );
    source.title = marker;
    const claim = raw.batches[0].assertion_candidates.find(
      (claim) => claim.id === "hume-a-appendix-open",
    );
    claim.text_ja = marker;
    const bundle = raw.batches[0].node_candidates.find(
      (node) => node.id === "hume-c-bundle",
    );
    bundle.label = marker;
    bundle.aliases = [marker];
    bundle.summary_ja = marker;
    const result = assertEquivalent(raw);
    assert.equal(JSON.stringify(result).includes(marker), false);
    const publicApi = createProvisionalRelease(result);
    assert.equal(publicApi.publicNode("hume-c-bundle"), null);
    assert.equal(publicApi.publicNode("hume-c-personal-identity"), null);
    assert.equal(publicApi.evidence("hume-a-bundle"), null);
  });

for (const variant of ["raw", "object", "revision"])
  test(`node withdrawal by ${variant} identity omits node/claim/edge text`, () => {
    const raw = fresh();
    const node = createProvisionalRelease(raw).publicNode("hume-p-hume");
    raw.withdrawn.nodes.push(
      variant === "raw"
        ? "hume-p-hume"
        : variant === "object"
          ? node.id
          : node.revision_id,
    );
    const marker = "WITHDRAWN-HUME-PERSON-CONTENT";
    raw.batches[0].node_candidates.find(
      (node) => node.id === "hume-p-hume",
    ).summary_ja = marker;
    raw.batches[0].assertion_candidates.find(
      (claim) => claim.subject === "hume-p-hume",
    ).text_ja = marker;
    const result = assertEquivalent(raw);
    assert.equal(JSON.stringify(result).includes(marker), false);
  });

for (const variant of ["raw", "object", "revision"])
  test(`assertion withdrawal by ${variant} identity closes subjects and editorial dependants`, () => {
    const raw = fresh();
    const proof = createProvisionalRelease(raw).evidence(
      "hume-a-appendix-open",
    );
    raw.withdrawn.assertions.push(
      variant === "raw"
        ? "hume-a-appendix-open"
        : variant === "object"
          ? proof.id
          : proof.revision_id,
    );
    const result = assertEquivalent(raw);
    assert.equal(
      createProvisionalRelease(result).publicNode("hume-q-personal-identity"),
      null,
    );
  });

for (const variant of ["raw", "alias", "object", "revision"])
  test(`relationship withdrawal by ${variant} identity preserves all later relationship UUIDs`, () => {
    const raw = fresh();
    const first = raw.batches[0].relationship_candidates[0];
    const key = relationId(raw.batches[0], 0);
    const proof = createProvisionalRelease(raw).evidence(key);
    raw.withdrawn.relationships.push(
      variant === "raw"
        ? key
        : variant === "alias"
          ? `${first.from}->${first.to}`
          : variant === "object"
            ? proof.id
            : proof.revision_id,
    );
    first.reason = "WITHDRAWN-RELATIONSHIP-CONTENT";
    const result = assertEquivalent(raw);
    assert.equal(
      JSON.stringify(result).includes("WITHDRAWN-RELATIONSHIP-CONTENT"),
      false,
    );
    assert.equal(
      result.batches[0].relationship_candidates[0].id,
      relationId(raw.batches[0], 1),
    );
  });

for (const variant of ["raw", "object", "revision"])
  test(`temporal withdrawal by ${variant} identity omits date text without hiding its work`, () => {
    const raw = fresh();
    const date = raw.temporal_records[0];
    const proof = createProvisionalRelease(raw).evidence(date.id);
    raw.withdrawn.assertions.push(
      variant === "raw"
        ? date.id
        : variant === "object"
          ? proof.id
          : proof.revision_id,
    );
    date.text_ja = "WITHDRAWN-TEMPORAL-CONTENT";
    date.date_label = "WITHDRAWN-TEMPORAL-CONTENT";
    const result = assertEquivalent(raw);
    assert.equal(
      JSON.stringify(result).includes("WITHDRAWN-TEMPORAL-CONTENT"),
      false,
    );
    assert.ok(createProvisionalRelease(result).publicNode(date.node_id));
    assert.equal(result.temporal_records.length, 4);
  });

test("nested assertion basis dependencies settle to the same fixed point", () => {
  const raw = fresh();
  const claim = raw.batches[0].assertion_candidates.find(
    (claim) => claim.id === "hume-a-classification",
  );
  claim.basis = ["hume-a-appendix-open"];
  raw.withdrawn.assertions.push("hume-a-appendix-open");
  const result = assertEquivalent(raw);
  assert.equal(
    createProvisionalRelease(result).publicNode("hume-c-perception"),
    null,
  );
  assert.equal(createProvisionalRelease(result).evidence(claim.id), null);
});

test("withdrawing every source produces an empty, valid anonymous document", () => {
  const raw = fresh();
  raw.withdrawn.sources = raw.batches.flatMap((batch) =>
    batch.sources.map((source) => source.id),
  );
  const result = assertEquivalent(raw);
  assert.equal(result.batches.length, 3);
  for (const batch of result.batches) {
    assert.equal(batch.node_candidates.length, 0);
    assert.equal(batch.sources.length, 0);
    assert.equal(batch.assertion_candidates.length, 0);
    assert.equal(batch.relationship_candidates.length, 0);
  }
  assert.equal(result.temporal_records.length, 0);
});

test("projection, returned visibility arrays and callers cannot mutate one another", () => {
  const raw = fresh();
  const before = structuredClone(raw);
  const result = projectPublicDocument(raw);
  assert.deepEqual(raw, before);
  result.batches[0].sources[0].title = "changed response";
  result.batches[0].node_candidates[0].basis.push("changed response");
  assert.deepEqual(raw, before);
  const api = createProvisionalRelease(raw);
  api.visibility().nodes.length = 0;
  api.visibility().sources.push("changed response");
  assert.equal(api.visibility().nodes.length, 36);
  assert.equal(api.visibility().sources.includes("changed response"), false);
});

test("projection rejects fake human approval and broken source references before publishing anything", () => {
  const fake = fresh();
  fake.human_review.status = "approved";
  assert.throws(
    () => projectPublicDocument(fake),
    /human review must remain pending/,
  );
  const broken = fresh();
  broken.batches[0].assertion_candidates[0].evidence[0].source = "missing";
  assert.throws(() => projectPublicDocument(broken), /evidence reference/);
});

test("objects nested in nominal public string fields cannot smuggle private metadata", () => {
  const hidden = { private_note: "PRIVATE-CREDENTIAL-IN-PUBLIC-FIELD" };
  for (const inject of [
    (raw) => {
      raw.batches[0].batch_id = hidden;
    },
    (raw) => {
      raw.batches[0].node_candidates[0].aliases = [hidden];
    },
    (raw) => {
      raw.batches[0].node_candidates[0].nature = hidden;
    },
    (raw) => {
      raw.batches[0].node_candidates[0].definition_scope = hidden;
    },
    (raw) => {
      raw.batches[0].node_candidates[0].scope_limit = hidden;
    },
    (raw) => {
      raw.batches[0].sources[0].author = hidden;
    },
    (raw) => {
      raw.batches[0].sources[0].host = hidden;
    },
    (raw) => {
      raw.batches[0].assertion_candidates[0].nature = hidden;
    },
    (raw) => {
      raw.batches[0].relationship_candidates[0].id = hidden;
    },
  ]) {
    const raw = fresh();
    inject(raw);
    assert.throws(
      () => projectPublicDocument(raw),
      /Invalid public projection field/,
    );
  }
});
