import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createProvisionalRelease } from "../src/domain/provisional.ts";

const batches = await Promise.all(
  ["hume", "locke", "descartes"].map(async (name) =>
    JSON.parse(
      await readFile(
        new URL(`../content-review/${name}-reviewed.json`, import.meta.url),
        "utf8",
      ),
    ),
  ),
);
function release() {
  return structuredClone({
    schema_version: 1,
    release_id: "test-real-source-v1",
    publication_status: "provisional",
    human_review: { status: "pending", reviewer: null, approved_at: null },
    authorized_by: "project-owner-request",
    batches,
    withdrawn: { sources: [], nodes: [], assertions: [], relationships: [] },
    temporal_records: [
      {
        id: "hume-treatise-publication-test",
        node_id: "hume-w-treatise",
        role: "publication",
        date_label: "1739〜1740年",
        original_label: "A Treatise of Human Nature (1739–40)",
        calendar: "西暦",
        normalization: "astronomical_year",
        precision: "year",
        start_earliest: 1739,
        start_latest: 1740,
        end_earliest: null,
        end_latest: null,
        evidence: [
          {
            source: "hume-s-treatise-index",
            locator: "Title and contents",
            role: "support",
          },
        ],
        text_ja: "『人間本性論』各巻は1739〜1740年に刊行された。",
        limit: "原著各巻の刊行範囲。Web版の公開年ではない。",
      },
    ],
  });
}
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("all 36 real nodes project into paginated collections with stable identities and slug routes", () => {
  const draft = release();
  const api = createProvisionalRelease(draft);
  assert.equal(api.catalog().length, 36);
  const first = api.searchNodes("");
  const second = api.searchNodes("", undefined, 20);
  assert.equal(first.items.length, 20);
  assert.equal(first.has_more, true);
  assert.equal(second.items.length, 16);
  assert.equal(second.has_more, false);
  assert.equal(
    new Set([...first.items, ...second.items].map((n) => n.id)).size,
    36,
  );
  for (const batch of draft.batches)
    for (const candidate of batch.node_candidates) {
      const collection = {
        question: "questions",
        person: "people",
        concept: "concepts",
        work: "books",
      }[candidate.type];
      const resolved = api.resolveNode(collection, candidate.id);
      assert.ok(resolved);
      assert.match(resolved.id, uuidV4);
      assert.equal(resolved.redirect, false);
      assert.equal(api.resolveNode(collection, resolved.id).redirect, true);
      const document = api.publicNode(resolved.id);
      assert.match(document.revision_id, uuidV4);
      assert.equal(document.title, candidate.label);
      assert.ok(api.article(resolved.id));
      assert.ok(api.nodePage(resolved.id));
      for (const section of document.article.sections)
        for (const assertion of section.assertions)
          assert.ok(api.evidence(assertion.revision_id));
      for (const relation of api.neighbors(resolved.id).items)
        assert.ok(api.evidence(relation.id));
    }
  assert.equal(api.resolveNode("books", "hume-p-hume"), null);
  assert.equal(api.resolveNode("people", "../hume-p-hume"), null);
  assert.deepEqual(draft.human_review, {
    status: "pending",
    reviewer: null,
    approved_at: null,
  });
  assert.ok(
    draft.batches.every(
      (batch) => batch.published === false && batch.database_imported === false,
    ),
  );
});

test("NFKC, aliases and type filters retain scoped concepts without merging authors", () => {
  const api = createProvisionalRelease(release());
  assert.equal(
    api.searchNodes("ＤＡＶＩＤ　ＨＵＭＥ", "person").items[0].title,
    "デイヴィッド・ヒューム",
  );
  assert.equal(api.searchNodes("ヒューム", "work").items.length, 0);
  const concepts = api.searchNodes("人格同一性", "concept").items;
  assert.deepEqual(
    new Set(concepts.map((node) => node.title)),
    new Set(["人格同一性（ヒューム）", "人格同一性（ロック）"]),
  );
  assert.notEqual(concepts[0].id, concepts[1].id);
  assert.deepEqual(api.searchNodes("", "bad-type"), {
    items: [],
    offset: 0,
    has_more: false,
  });
  assert.equal(api.nodePage("hume-p-hume", -1), null);
});

test("object UUIDs and canonical slugs survive a new release while revision IDs change", () => {
  const first = createProvisionalRelease(release());
  const next = release();
  next.release_id = "test-real-source-v2";
  const second = createProvisionalRelease(next);
  const one = first.publicNode("hume-p-hume");
  const two = second.publicNode("hume-p-hume");
  assert.equal(one.id, two.id);
  assert.equal(one.href, two.href);
  assert.notEqual(one.revision_id, two.revision_id);
  assert.notEqual(
    first.evidence("hume-a-introspection").revision_id,
    second.evidence("hume-a-introspection").revision_id,
  );
});

test("node summary evidence, concept scope, limits and all Hume qualifications remain readable", () => {
  const api = createProvisionalRelease(release());
  const bundle = api.publicNode("hume-c-bundle");
  const overview = bundle.article.sections[0];
  assert.match(overview.text, /このページで扱う意味/);
  assert.match(overview.text, /補遺/);
  assert.equal(
    overview.assertions[0].sources.filter(
      (source) => source.role === "qualification",
    ).length,
    1,
  );
  assert.ok(
    overview.assertions[0].sources.every(
      (source) => source.url && source.edition && source.locator,
    ),
  );
  assert.ok(
    api
      .evidence("hume-p-hume-summary")
      .sources.some((source) => source.url.endsWith("/texts/t/notes")),
  );
  const personal = api.publicNode("hume-c-personal-identity");
  const content = personal.article.sections
    .map((section) => section.text)
    .join("\n");
  assert.match(content, /まだ見いだせない/);
  assert.match(content, /絶対に克服不能とは判断しない/);
  const open = api.evidence("hume-a-appendix-open");
  assert.equal(open.sources[0].role, "qualification");
  assert.match(open.texts[0].content, /読み取る範囲/);
  assert.match(open.attributions[0].context, /全面撤回/);
  assert.match(
    api.evidence("hume-a-author").attributions[0].speaker,
    /Hume Texts Online編者/,
  );
});

test("source withdrawal removes dependent nodes, searches, relations and standalone proof together", () => {
  const base = createProvisionalRelease(release());
  const originalBundle = base.publicNode("hume-c-bundle");
  const claim = base.evidence("hume-a-bundle");
  const source = claim.sources.find((source) => source.url.endsWith("/1/4/6"));
  const next = release();
  next.withdrawn.sources.push(source.source_revision_id);
  const api = createProvisionalRelease(next);
  assert.equal(api.publicNode(originalBundle.id), null);
  assert.equal(api.resolveNode("concepts", "hume-c-bundle"), null);
  assert.equal(api.searchNodes("知覚の束").items.length, 0);
  assert.equal(api.evidence(claim.revision_id), null);
  assert.equal(api.evidence("hume-c-bundle-summary"), null);
  assert.equal(api.evidence("hume-c-personal-identity->hume-c-bundle"), null);
  assert.equal(
    api.catalog().some((node) => node.id === originalBundle.id),
    false,
  );
  for (const item of api.searchNodes("").items)
    assert.equal(
      api
        .neighbors(item.id)
        .items.some((edge) => edge.node.id === originalBundle.id),
      false,
    );
  assert.ok(api.publicNode("hume-c-impression"));
});

test("withdrawing the Appendix never leaves a stronger unqualified bundle page", () => {
  const next = release();
  next.withdrawn.sources.push("hume-s-appendix");
  const api = createProvisionalRelease(next);
  assert.equal(api.publicNode("hume-c-bundle"), null);
  assert.equal(api.publicNode("hume-c-personal-identity"), null);
  assert.equal(api.evidence("hume-a-bundle"), null);
  assert.equal(api.evidence("hume-a-appendix-open"), null);
  assert.equal(
    api
      .explorationHome()
      .questions.some((node) => node.href.endsWith("hume-q-personal-identity")),
    false,
  );
});

test("claim and node withdrawal close dependent pages and their proof endpoints", () => {
  const next = release();
  next.withdrawn.assertions.push("hume-a-appendix-open");
  const api = createProvisionalRelease(next);
  assert.equal(api.publicNode("hume-c-personal-identity"), null);
  assert.equal(api.evidence("hume-a-scope"), null);
  assert.equal(api.publicNode("hume-q-personal-identity"), null);
  assert.ok(api.publicNode("hume-c-bundle"));
  const nodeRelease = release();
  const base = createProvisionalRelease(nodeRelease);
  nodeRelease.withdrawn.nodes.push(base.publicNode("hume-p-hume").id);
  const nodeApi = createProvisionalRelease(nodeRelease);
  assert.equal(nodeApi.publicNode("hume-p-hume"), null);
  assert.equal(nodeApi.evidence("hume-a-introspection"), null);
  assert.equal(nodeApi.evidence("hume-p-hume->hume-w-treatise"), null);
});

test("relationship withdrawal hides only that connection and its editorial proof", () => {
  const next = release();
  const original = createProvisionalRelease(next);
  const edgeProof = original.evidence("hume-p-hume->hume-w-treatise");
  assert.ok(edgeProof.basis.length);
  assert.ok(edgeProof.sources.length);
  next.withdrawn.relationships.push(edgeProof.id);
  const api = createProvisionalRelease(next);
  assert.equal(api.evidence(edgeProof.revision_id), null);
  assert.equal(
    api
      .neighbors("hume-p-hume")
      .items.some((edge) => edge.id === edgeProof.revision_id),
    false,
  );
  assert.ok(api.publicNode("hume-p-hume"));
  assert.ok(api.publicNode("hume-w-treatise"));
  const manifestWithdrawal = release();
  manifestWithdrawal.withdrawn.relationships.push(
    `${manifestWithdrawal.batches[0].batch_id}:relation:0`,
  );
  assert.equal(
    createProvisionalRelease(manifestWithdrawal).evidence(
      edgeProof.revision_id,
    ),
    null,
  );
});

test("source-backed timeline and date proof use the same node/source visibility", () => {
  const original = createProvisionalRelease(release());
  const date = original.timelineNodes().items[0];
  assert.equal(date.date_label, "1739〜1740年");
  assert.equal(original.publicNode("hume-w-treatise").dates[0].id, date.id);
  assert.match(
    original.evidence(date.id).texts[0].content,
    /Web版の公開年ではない/,
  );
  const next = release();
  next.withdrawn.sources.push("hume-s-treatise-index");
  const api = createProvisionalRelease(next);
  assert.equal(api.publicNode("hume-w-treatise"), null);
  assert.equal(api.timelineNodes().items.length, 0);
  assert.equal(api.evidence(date.id), null);
  assert.equal(api.evidence("hume-a-author"), null);
});

test("one captured snapshot cannot mix subsequent caller mutations", () => {
  const mutable = release();
  const api = createProvisionalRelease(mutable);
  mutable.withdrawn.sources.push("hume-s-appendix");
  mutable.batches[0].node_candidates[0].summary_ja =
    "changed after construction";
  assert.ok(api.publicNode("hume-c-bundle"));
  assert.doesNotMatch(
    api.publicNode("hume-q-personal-identity").summary,
    /changed after/,
  );
  assert.equal(
    createProvisionalRelease(mutable).publicNode("hume-c-bundle"),
    null,
  );
  assert.throws(() => {
    api.publicNode("hume-q-personal-identity").title = "mutated response";
  }, TypeError);
  assert.equal(api.searchNodes("mutated response").items.length, 0);
});

test("release validation rejects invented human approval and broken evidence", () => {
  const approved = release();
  approved.human_review = {
    status: "approved",
    reviewer: "AI",
    approved_at: "2026-10-03",
  };
  assert.throws(
    () => createProvisionalRelease(approved),
    /human review must remain pending/,
  );
  const broken = release();
  broken.batches[0].assertion_candidates[0].evidence[0].source =
    "missing-source";
  assert.throws(() => createProvisionalRelease(broken), /evidence reference/);
  const unauthorized = release();
  unauthorized.authorized_by = "assumed";
  assert.throws(() => createProvisionalRelease(unauthorized), /authorization/);
  const reversedDate = release();
  reversedDate.temporal_records[0].start_latest = 1738;
  assert.throws(() => createProvisionalRelease(reversedDate), /date range/);
});
