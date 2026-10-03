import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const origin = process.env.NOEMAP_TEST_ORIGIN ?? "http://127.0.0.1:4330";
const release = JSON.parse(
  await readFile("src/data/public-release.json", "utf8"),
);
const checks = [];
async function check(name, work) {
  await work();
  checks.push({ name, status: "passed" });
  console.log(`PASS ${name}`);
}
async function response(path, options) {
  const result = await fetch(new URL(path, origin), {
    redirect: "manual",
    ...options,
    signal: AbortSignal.timeout(15000),
  });
  return result;
}
async function html(path) {
  const result = await response(path);
  assert.equal(result.status, 200, path);
  assert.match(result.headers.get("cache-control"), /no-store/);
  return result.text();
}
async function json(path) {
  const result = await response(path);
  assert.equal(result.status, 200, path);
  assert.match(result.headers.get("cache-control"), /no-store/);
  return result.json();
}

await check(
  "home serves real content with honest publication status",
  async () => {
    const page = await html("/");
    assert.match(page, /公開試行版/);
    assert.match(page, /人による内容確認/);
    assert.doesNotMatch(page, /本文と資料は架空例|Coming Soon/);
    assert.doesNotMatch(page, /href="\/editor"/);
  },
);
let nodes;
await check(
  "search pagination exposes all 36 unique released nodes",
  async () => {
    const first = await json("/api/search");
    const next = await json("/api/search?offset=20");
    assert.equal(first.has_more, true);
    assert.equal(next.has_more, false);
    nodes = [...first.items, ...next.items];
    assert.equal(nodes.length, 36);
    assert.equal(new Set(nodes.map((n) => n.id)).size, 36);
  },
);
await check(
  "all node routes render and UUID routes redirect to canonical URLs",
  async () => {
    for (const node of nodes) {
      const page = await html(node.href);
      assert.ok(page.includes(node.title), node.title);
      const collection = node.href.split("/")[1];
      const redirect = await response(`/${collection}/${node.id}`);
      assert.equal(redirect.status, 308);
      assert.ok(redirect.headers.get("location").endsWith(node.href));
      const api = await json(`/api/nodes/${node.id}`);
      assert.equal(api.document.id, node.id);
      for (const relation of api.neighbors.items)
        assert.ok(nodes.some((n) => n.id === relation.node.id));
    }
  },
);
await check(
  "node summaries and every visible claim retain accessible source pages",
  async () => {
    const evidenceIds = new Set();
    for (const node of nodes) {
      const api = await json(`/api/nodes/${node.id}`);
      for (const section of api.document.article.sections)
        for (const assertion of section.assertions)
          evidenceIds.add(assertion.revision_id);
      for (const relation of api.neighbors.items) evidenceIds.add(relation.id);
    }
    assert.ok(evidenceIds.size > 70);
    for (const id of evidenceIds) {
      const page = await html(`/evidence/${id}`);
      assert.match(page, /記述と出典/);
      assert.ok(
        page.includes("https://") || page.includes("比較に使った記述と出典"),
      );
    }
  },
);
await check(
  "English aliases and NFKC search work through the public API",
  async () => {
    const ascii = await json("/api/search?q=David%20Hume");
    const fullwidth = await json(
      `/api/search?q=${encodeURIComponent("Ｄａｖｉｄ　Ｈｕｍｅ")}`,
    );
    assert.ok(ascii.items.some((n) => n.title.includes("ヒューム")));
    assert.deepEqual(
      fullwidth.items.map((n) => n.id),
      ascii.items.map((n) => n.id),
    );
  },
);
await check("all collections and the search form load", async () => {
  for (const path of [
    "/questions",
    "/people",
    "/concepts",
    "/books",
    "/search?q=ロック",
  ])
    await html(path);
});
await check(
  "chronology separates five sourced publication and title-year records",
  async () => {
    const timeline = await json("/api/timeline");
    assert.equal(timeline.items.length, release.temporal_records.length);
    assert.equal(timeline.items.length, 5);
    for (const item of timeline.items) {
      assert.equal(item.role, "publication");
      await html(`/evidence/${item.id}`);
    }
    await html("/timeline");
  },
);
await check(
  "invalid public queries fail with 400 and unknown items with 404",
  async () => {
    for (const path of [
      "/api/search?type=private",
      "/api/search?offset=-1",
      "/api/timeline?offset=-1",
    ])
      assert.equal((await response(path)).status, 400);
    for (const path of [
      "/api/nodes/unknown",
      "/evidence/unknown",
      "/people/unknown",
    ])
      assert.equal((await response(path)).status, 404);
  },
);
await check(
  "local editor pages and forged editor POSTs are inaccessible",
  async () => {
    for (const path of ["/editor", "/editor/login", "/editor/new"])
      assert.equal((await response(path)).status, 404, path);
    for (const path of ["/editor/auth", "/editor/action"])
      assert.equal(
        (
          await response(path, {
            method: "POST",
            headers: {
              Origin: origin,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: "account=owner&action=publish&human=checked",
          })
        ).status,
        403,
      );
  },
);
await check(
  "public responses allow indexing and editor responses disallow it",
  async () => {
    const publicResponse = await response("/");
    assert.doesNotMatch(
      publicResponse.headers.get("x-robots-tag") ?? "",
      /noindex/,
    );
    const editorResponse = await response("/editor/login");
    assert.match(editorResponse.headers.get("x-robots-tag") ?? "", /noindex/);
  },
);
await mkdir(".local", { recursive: true });
await writeFile(
  ".local/latest-public-web-results.json",
  JSON.stringify(
    {
      checked_at: new Date().toISOString(),
      origin,
      release_id: release.release_id,
      checks,
      nodes: nodes.length,
      status: "passed",
    },
    null,
    2,
  ) + "\n",
);
console.log(`${checks.length} public HTTP checks passed`);
