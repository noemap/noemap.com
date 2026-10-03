import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.NOEMAP_TEST_ORIGIN ?? "http://127.0.0.1:4330";
const checks = [];
async function get(path) {
  return fetch(origin + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
}
async function html(path) {
  const r = await get(path);
  assert.equal(r.status, 200, path);
  assert.match(r.headers.get("cache-control"), /no-store/);
  return r.text();
}
async function check(name, fn) {
  await fn();
  checks.push({ name, status: "passed" });
  console.log("PASS " + name);
}
await check(
  "eight cards precede search and use real published article links",
  async () => {
    const h = await html("/?theme=mind&group=identity");
    assert.equal((h.match(/data-theme-id=/g) || []).length, 8);
    assert.ok(h.indexOf("data-theme-id=") < h.indexOf('role="search"'));
    assert.match(h, /href="\/questions\/hume-q-personal-identity"/);
    assert.match(h, /href="\/questions\/locke-question-identity"/);
    assert.doesNotMatch(
      h,
      /ai-consciousness|公開試行版|人による内容確認は準備中/,
    );
  },
);
await check(
  "theme list and detail pages resolve without dummy article content",
  async () => {
    assert.match(await html("/themes"), /テーマから考える/);
    assert.match(
      await html("/themes/self?group=identity"),
      /変わっても、同じ自分/,
    );
    assert.match(await html("/themes/body"), /準備しています/);
    assert.equal((await get("/themes/unknown-theme")).status, 404);
  },
);
await check(
  "direct question URL has sources, metadata, update date and valid return link",
  async () => {
    const h = await html("/questions/hume-q-personal-identity");
    assert.match(h, /参照資料/);
    assert.match(h, /更新日/);
    assert.match(h, /問いの一覧に戻る/);
    assert.match(
      h,
      /rel="canonical" href="https:\/\/noemap.com\/questions\/hume-q-personal-identity"/,
    );
    assert.match(h, /デイヴィッド・ヒューム|ヒューム/);
    assert.ok(
      h.indexOf('id="reading-perspectives"') < h.indexOf('id="section-0"'),
      "a question offers perspectives before editorial source notes",
    );
    for (const locator of [
      "T 1.4.6.5, SBN 253",
      "T 1.4.6.4, SBN 252–253",
      "T App.20, SBN 635–636",
    ])
      assert.ok(h.includes(locator), locator);
    assert.match(h, /ヒューム自身の日本語の発言として表示しない/);
  },
);
await check("theme, discipline, type and alias search compose", async () => {
  const r = await get(
    "/api/search?theme=self&discipline=philosophy&type=person&q=David%20Hume",
  );
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.items.length, 1);
  assert.match(p.items[0].title, /ヒューム/);
  const k = await (
    await get("/api/search?theme=knowledge&type=question")
  ).json();
  assert.equal(k.items.length, 1);
  assert.match(k.items[0].title, /確かな知/);
});
await check(
  "unknown classification query returns 400, not an unfiltered result",
  async () => {
    assert.equal((await get("/api/search?theme=unknown")).status, 400);
    assert.equal((await get("/api/search?discipline=unknown")).status, 400);
  },
);
await check(
  "search disclosures and clear links preserve the keyword",
  async () => {
    const h = await html(
      "/search?q=David%20Hume&type=person&theme=self&discipline=philosophy",
    );
    assert.match(h, /<form[^>]+method="get"/);
    assert.match(h, /<details[^>]+open=""/);
    assert.match(h, /3<!-- -->条件/);
    assert.match(h, /href="\/search\?q=David\+Hume"/);
    for (const name of ["type", "theme", "discipline"])
      assert.ok(h.includes(`name="${name}"`));
  },
);
await check(
  "a discovered public question is restored on a direct return URL",
  async () => {
    const h = await html("/?discovery=4f43d8f5-7bcf-44b1-a763-32765ca427a3");
    const discovery = h.slice(h.indexOf('class="discovery-card"'));
    assert.match(
      discovery.slice(0, discovery.indexOf("</a>")),
      /href="\/questions\/descartes-q-self"/,
    );
  },
);
await check(
  "explore and empty search provide continuing navigation",
  async () => {
    assert.match(
      await html("/explore?theme=self&type=person"),
      /ジョン・ロック/,
    );
    const h = await html("/search?discipline=psychology");
    assert.match(h, /まだ見つかりませんでした/);
    assert.match(h, /href="\/questions"/);
    assert.match(h, /href="\/themes"/);
    assert.match(h, /name="theme"/);
    assert.match(h, /name="discipline"/);
  },
);
await check(
  "fresh sitemap contains public canonical routes and excludes management and placeholder topics",
  async () => {
    const r = await get("/sitemap.xml");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control"), /no-store/);
    const s = await r.text();
    assert.match(s, /noemap.com\/questions\/hume-q-personal-identity/);
    assert.match(s, /noemap.com\/themes\/self/);
    assert.doesNotMatch(
      s,
      /\/manage|\/editor|\/notes|ai-consciousness|\/themes\/society/,
    );
  },
);
await mkdir("docs/validation", { recursive: true });
await writeFile(
  "docs/validation/entry-http.json",
  JSON.stringify(
    { origin, checked_at: new Date().toISOString(), checks },
    null,
    2,
  ) + "\n",
);
console.log(checks.length + " entry HTTP checks passed");
