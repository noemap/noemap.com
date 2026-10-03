import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runExplorationWebTests } from "./exploration.mjs";
const runtimePath = ".local/app-runtime.json",
  config = JSON.parse(await readFile(runtimePath, "utf8")),
  origin = config.origin;
assert.equal(config.mode, "local-fictional");
assert.equal(origin, "http://127.0.0.1:4320");
const passwords = await readFile(".local/editor-login.txt", "utf8");
const password = (id) => {
  const lines = passwords.split("\n"),
    n = lines.findIndex((line) => line.endsWith(`：${id}`));
  assert.ok(n >= 0);
  return lines[n + 1].split("：")[1];
};
const results = [];
async function test(name, fn) {
  const start = Date.now();
  await fn();
  results.push({ name, status: "passed", duration_ms: Date.now() - start });
  console.log(`PASS ${name}`);
}
async function post(
  fields,
  cookie = "",
  requestOrigin = origin,
  path = "/editor/action",
) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields))
    for (const item of Array.isArray(v) ? v : [v]) body.append(k, String(item));
  return fetch(origin + path, {
    method: "POST",
    headers: { origin: requestOrigin, cookie },
    body,
    redirect: "manual",
  });
}
async function login(id) {
  const r = await post(
    { account: id, password: password(id) },
    "",
    origin,
    "/editor/auth",
  );
  assert.equal(r.status, 303);
  assert.equal(new URL(r.headers.get("location")).pathname, "/editor");
  assert.equal(new URL(r.headers.get("location")).origin, origin);
  const cookie = r.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=strict/i);
  return cookie.split(";")[0];
}
async function html(path, cookie) {
  const r = await fetch(origin + path, {
    headers: { cookie },
    redirect: "manual",
  });
  assert.equal(r.status, 200);
  return r.text();
}
async function action(fields, cookie) {
  const r = await post(fields, cookie);
  assert.equal(r.status, 303);
  const location = new URL(r.headers.get("location"));
  assert.equal(location.origin, origin);
  assert.ok(
    !location.searchParams.has("error"),
    `action ${fields.action} failed: ${location.searchParams.get("error")}`,
  );
  return location.pathname;
}
const owner = await login("owner"),
  writer = await login("writer"),
  checker = await login("checker");
const db = new pg.Client({
  host: config.host,
  port: config.port,
  database: config.database,
  user: config.accounts.owner.user,
  password: config.accounts.owner.dbPassword,
});
await db.connect();
const inspect = async (id) =>
  Object.values(
    (await db.query("SELECT api.editor_revision($1)", [id])).rows[0],
  )[0];
let question, source, claim, block, pageId;
const publish = async (revision) => {
  await action({ action: "freeze", revision }, owner);
  await action(
    {
      action: "review",
      revision,
      decision: "approved",
      reason: "HTTP経由の架空試験。内容を確認。",
      human: "checked",
    },
    owner,
  );
  const text = await html(`/editor/revisions/${revision}`, owner);
  const section = text.match(/<select name="review"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(section);
  const review = section[1].match(/value="([0-9a-f-]{36})"/)[1];
  await action(
    {
      action: "publish",
      revision,
      review,
      generation: (await inspect(revision)).generation,
      operation: randomUUID(),
    },
    owner,
  );
};
try {
  await test("W01 live reader returns reviewed data, no-store headers, and no private credentials", async () => {
    const r = await fetch(
      `${origin}/api/articles/${config.fixture.questionId}`,
    );
    assert.equal(r.status, 200);
    assert.match(r.headers.get("cache-control"), /no-store/);
    const content = await r.text();
    assert.equal(JSON.parse(content).sections.length, 3);
    for (const secret of [
      config.sessionSecret,
      config.accounts.owner.dbPassword,
      config.reader.password,
    ])
      assert.ok(!content.includes(secret));
    const home = await html("/", owner);
    assert.match(home, /私は誰なのか/);
    assert.match(home, /<svg/);
  });
  await test("W02 anonymous and forged sessions cannot write; cross-origin requests are rejected", async () => {
    assert.equal((await post({ action: "create" })).status, 401);
    assert.equal(
      (await post({ action: "create" }, "noemap_editor=forged.publisher"))
        .status,
      401,
    );
    assert.equal(
      (await post({ action: "create" }, owner, "https://example.test")).status,
      403,
    );
    const r = await fetch(`${origin}/editor`, { redirect: "manual" });
    assert.equal(r.status, 307);
    assert.match(r.headers.get("location"), /login/);
  });
  await test("W03 writer cannot confirm or publish and checker cannot edit or release a bundle", async () => {
    for (const action of ["review", "publish", "compose"])
      assert.equal((await post({ action }, writer)).status, 403);
    for (const action of ["create", "save", "compose"])
      assert.equal((await post({ action }, checker)).status, 403);
  });
  await test("W04 draft creation is atomic, remains private, and requires explicit human review", async () => {
    question = (
      await action(
        {
          action: "create",
          kind: "entity",
          variant: "question",
          text: "HTTP公開確認用の問い（架空）",
          scope: "HTTP経由の試験だけに使う識別範囲",
          reason: "架空の試験",
        },
        writer,
      )
    )
      .split("/")
      .at(-1);
    pageId = (await inspect(question)).revision.object_id;
    assert.equal((await fetch(`${origin}/api/articles/${pageId}`)).status, 404);
    await action({ action: "freeze", revision: question }, writer);
    const result = await post(
      {
        action: "review",
        revision: question,
        decision: "approved",
        reason: "確認欄がない",
      },
      owner,
    );
    assert.match(result.headers.get("location"), /error=invalid/);
    assert.equal((await inspect(question)).reviews.length, 0);
    await action(
      {
        action: "review",
        revision: question,
        decision: "approved",
        reason: "架空の試験を確認",
        human: "checked",
      },
      owner,
    );
    const data = await inspect(question);
    await action(
      {
        action: "publish",
        revision: question,
        review: data.reviews[0].id,
        generation: data.generation,
        operation: randomUUID(),
      },
      owner,
    );
  });
  await test("W05 source and attribution travel through real form submission, DB review, and publication", async () => {
    source = (
      await action(
        {
          action: "create",
          kind: "source",
          text: "HTTP根拠資料（架空）",
          citation: "架空筆者『HTTP試験』第1版",
          edition: "第1版",
          publication_info: "架空の刊行情報",
          url: "",
          credit: "架空筆者",
          credit_role: "author",
          reason: "HTTPの動作確認",
        },
        writer,
      )
    )
      .split("/")
      .at(-1);
    await publish(source);
    claim = (
      await action(
        {
          action: "create",
          kind: "assertion",
          subject: question,
          nature: "position",
          text: "HTTPの試験で用いる架空の立場。",
          source,
          locator: "第3節",
          summary: "説明の対象範囲",
          speaker: "架空筆者",
          speaker_role: "original_statement",
          context: "架空資料の筆者による説明",
          rationale: "本文の立場を検証する",
          reason: "HTTPの動作確認",
        },
        writer,
      )
    )
      .split("/")
      .at(-1);
    await publish(claim);
    const r = await fetch(`${origin}/evidence/${claim}`);
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.match(text, /第3節/);
    assert.match(text, /本人の説明/);
  });
  await test("W06 block references and reviewed composition render an actual reader article", async () => {
    block = (
      await action(
        {
          action: "create",
          kind: "block",
          variant: "summary",
          entity: question,
          text: "HTTPで確認する\n本文は架空の動作確認です。",
          references: [claim],
          reason: "HTTP試験の本文",
        },
        writer,
      )
    )
      .split("/")
      .at(-1);
    await publish(block);
    const compose = await html(`/editor/compose/${question}`, owner);
    assert.match(compose, /HTTPで確認する/);
    await action(
      {
        action: "compose",
        revision: question,
        blocks: [block],
        generation: 0,
        operation: randomUUID(),
        reason: "架空本文の組合せを確認",
        human: "checked",
      },
      owner,
    );
    const r = await fetch(`${origin}/api/articles/${pageId}`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(
      data.sections[0].text,
      "HTTPで確認する\n本文は架空の動作確認です。",
    );
    assert.equal(data.sections[0].assertions[0].sources[0].locator, "第3節");
    assert.match(await html(`/questions/${pageId}`, owner), /HTTPで確認する/);
  });
  await test("W07 old generation cannot cancel a current grant; exact retry cannot duplicate release", async () => {
    const data = await inspect(source);
    const r = await post(
      {
        action: "revoke",
        revision: source,
        generation: 0,
        operation: randomUUID(),
        reason: "古い画面からの操作",
      },
      owner,
    );
    assert.match(r.headers.get("location"), /error=conflict/);
    assert.equal((await inspect(source)).generation, data.generation);
    const fields = {
      action: "compose",
      revision: question,
      blocks: [block],
      generation: 1,
      operation: randomUUID(),
      reason: "同じHTTP操作を再送",
      human: "checked",
    };
    await action(fields, owner);
    await action(fields, owner);
    assert.equal((await fetch(`${origin}/api/articles/${pageId}`)).status, 200);
  });
  await test("W08 withdrawing a source removes dependent article and evidence from every public route", async () => {
    const data = await inspect(source);
    await action(
      {
        action: "revoke",
        revision: source,
        generation: data.generation,
        operation: randomUUID(),
        reason: "架空の根拠を再確認",
      },
      owner,
    );
    assert.equal((await fetch(`${origin}/api/articles/${pageId}`)).status, 404);
    const page = await fetch(`${origin}/questions/${pageId}`);
    assert.equal(page.status, 404);
    assert.ok(!(await page.text()).includes("HTTPで確認する"));
    assert.equal((await fetch(`${origin}/evidence/${claim}`)).status, 404);
    assert.ok(!(await html("/", owner)).includes("HTTP公開確認用の問い"));
    assert.equal(
      (await fetch(`${origin}/api/articles/${config.fixture.questionId}`))
        .status,
      200,
    );
  });
  await test("W09 DB outage returns 503 without replaying old article content", async () => {
    const original = await readFile(runtimePath, "utf8");
    try {
      await writeFile(runtimePath, JSON.stringify({ ...config, port: 1 }));
      const r = await fetch(
        `${origin}/api/articles/${config.fixture.questionId}`,
      );
      assert.equal(r.status, 503);
      const text = await r.text();
      assert.ok(!text.includes("記憶を手がかり"));
      assert.match(r.headers.get("cache-control"), /no-store/);
    } finally {
      await writeFile(runtimePath, original);
    }
    assert.equal(
      (await fetch(`${origin}/api/articles/${config.fixture.questionId}`))
        .status,
      200,
    );
  });
  await test("W10 search filters older revisions and source corrections leave the original unchanged", async () => {
    const found = await html(
      "/editor?q=" + encodeURIComponent("記憶と自分") + "&kind=source",
      owner,
    );
    assert.match(found, /記憶と自分/);
    assert.ok(!found.includes("HTTPで確認する"));
    const candidates = await html(
      "/editor/new?kind=assertion&source_q=" + encodeURIComponent("記憶と自分"),
      owner,
    );
    assert.match(candidates, /記憶と自分/);
    assert.ok(!candidates.includes("HTTP根拠資料（架空）"));
    const before = await inspect(source);
    const clone = (
      await action(
        {
          action: "clone",
          revision: source,
          reason: "刊行情報を訂正する架空試験",
        },
        writer,
      )
    )
      .split("/")
      .at(-1);
    await action(
      {
        action: "save",
        revision: clone,
        text: "HTTP根拠資料の訂正版（架空）",
        citation: "架空筆者『HTTP試験』訂正版",
        edition: "訂正版",
        publication_info: "架空の刊行情報の訂正",
        url: "https://example.com/fictional",
      },
      writer,
    );
    assert.deepEqual(await inspect(source), before);
    const revised = await inspect(clone);
    assert.equal(revised.source_metadata.edition, "訂正版");
    assert.equal(revised.revision.state, "draft");
    assert.equal(revised.source_credits[0].label, "架空筆者");
  });
  await test("W11 logout expires the editor cookie", async () => {
    const r = await post({ action: "logout" }, owner, origin, "/editor/auth");
    assert.equal(r.status, 303);
    assert.match(r.headers.get("set-cookie"), /Max-Age=0/);
  });
  await runExplorationWebTests({
    origin,
    config,
    db,
    html,
    test,
    action,
    post,
    owner,
    writer,
    checker,
    inspect,
    publish,
  });
  await writeFile(
    ".local/latest-web-results.json",
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        scope:
          "Live local HTTP → Next.js handlers → PostgreSQL → reader rendering, fictional data only. Browser layout reviewed separately.",
        passed: results.length,
        tests: results,
      },
      null,
      2,
    ),
  );
  console.log(`${results.length} web integration checks passed.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await writeFile(
    ".local/latest-web-results.json",
    JSON.stringify(
      {
        status: "failed",
        passed: results.length,
        error: error.message,
        tests: results,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
}
