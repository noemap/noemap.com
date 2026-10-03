import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createProvisionalRelease } from "../src/domain/provisional.ts";
import {
  projectEntry,
  entrySelection,
  filterEntryNodes,
  validateEntryCatalog,
} from "../src/domain/entry.ts";
const catalog = JSON.parse(
  await readFile("src/data/entry-catalog.json", "utf8"),
);
const release = JSON.parse(
  await readFile("src/data/public-release.json", "utf8"),
);
const d = createProvisionalRelease(release);
const nodes = [
  ...d.searchNodes("", undefined, 0).items,
  ...d.searchNodes("", undefined, 20).items,
];
let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log("PASS " + name);
}
check(
  "catalogue references immutable published node IDs and correct question types",
  () => validateEntryCatalog(catalog, nodes),
);
const themes = projectEntry(catalog, nodes);
check("eight ordered entrance themes, only available groups expand", () => {
  assert.equal(themes.length, 8);
  assert.deepEqual(
    themes.filter((t) => t.groups.length).map((t) => t.id),
    ["mind", "self", "knowledge"],
  );
});
check(
  "same question shared across themes retains one ID and canonical URL",
  () => {
    const mind = themes.find((t) => t.id === "mind").groups[0].questions;
    const self = themes.find((t) => t.id === "self").groups[0].questions;
    assert.deepEqual(mind, self);
  },
);
check("invalid and unavailable URL state is discarded", () => {
  assert.deepEqual(entrySelection(themes, "society", "identity"), {
    theme: null,
    group: null,
  });
  assert.deepEqual(entrySelection(themes, "self", "missing"), {
    theme: "self",
    group: null,
  });
});
check(
  "withdrawn source removes its questions, overview and groups from the entrance",
  () => {
    const r = structuredClone(release);
    r.withdrawn.sources.push(...r.batches[0].sources.map((s) => s.id));
    const projected = createProvisionalRelease(r);
    const publicNodes = [
      ...projected.searchNodes("", undefined, 0).items,
      ...projected.searchNodes("", undefined, 20).items,
    ];
    const visible = projectEntry(catalog, publicNodes);
    const ids = new Set(publicNodes.map((n) => n.id));
    for (const t of visible)
      for (const g of t.groups) {
        assert.ok(g.questions.every((q) => ids.has(q.id)));
        assert.ok(!g.overview || ids.has(g.overview.id));
      }
    assert.ok(
      visible.find((t) => t.id === "self").groups[0].questions.length <
        themes.find((t) => t.id === "self").groups[0].questions.length,
    );
  },
);
check(
  "an entirely unpublished projection creates no article or overview links",
  () => {
    assert.ok(projectEntry(catalog, []).every((t) => !t.groups.length));
  },
);
check("theme filtering precedes pagination with no duplicate IDs", () => {
  const pages = [
    filterEntryNodes(nodes, catalog, { theme: "self" }),
    filterEntryNodes(nodes, catalog, { theme: "self", offset: 20 }),
  ];
  assert.equal(
    new Set(pages.flatMap((p) => p.items.map((n) => n.id))).size,
    pages.flatMap((p) => p.items).length,
  );
  assert.ok(pages[0].has_more);
  assert.equal(pages[1].has_more, false);
});
check("alias search combines type, theme and discipline filters", () => {
  const page = filterEntryNodes(nodes, catalog, {
    q: "Ｄａｖｉｄ　Ｈｕｍｅ",
    type: "person",
    theme: "self",
    discipline: "philosophy",
  });
  assert.equal(page.items.length, 1);
  assert.match(page.items[0].title, /ヒューム/);
  assert.equal(
    filterEntryNodes(nodes, catalog, { discipline: "psychology" }).items.length,
    0,
  );
});
check("wrong-type and broken references fail catalogue validation", () => {
  const x = structuredClone(catalog);
  x.groups[0].questionIds = [nodes.find((n) => n.type === "person").id];
  assert.throws(() => validateEntryCatalog(x, nodes), /wrong-type/);
  x.groups[0].questionIds = ["missing"];
  assert.throws(() => validateEntryCatalog(x, nodes), /Missing/);
});
check("duplicate IDs and theme slugs fail catalogue validation", () => {
  const x = structuredClone(catalog);
  x.themes[1].slug = x.themes[0].slug;
  assert.throws(() => validateEntryCatalog(x, nodes), /Duplicate/);
  const y = structuredClone(catalog);
  y.groups.push(y.groups[0]);
  assert.throws(() => validateEntryCatalog(y, nodes), /Duplicate/);
});
console.log(checks + " entry data checks passed");
