import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function runExplorationWebTests({
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
}) {
  const ids = config.fixture.nodeIds;
  const json = async (path) => {
    const response = await fetch(origin + path, { redirect: "manual" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    return response.json();
  };
  await test("X01 human question home and typed canonical routes share reviewed node data", async () => {
    assert.match(await html("/"), /人間とは何か/);
    const old = await fetch(`${origin}/questions/${ids["what-is-self"]}`, {
      redirect: "manual",
    });
    assert.equal(old.status, 308);
    assert.equal(
      new URL(old.headers.get("location"), origin).pathname,
      "/questions/what-is-self",
    );
    assert.match(await html("/questions/what-is-self"), /記憶を手がかり/);
    assert.equal(
      (await fetch(`${origin}/people/${ids["what-is-self"]}`)).status,
      404,
    );
    assert.equal((await fetch(`${origin}/questions/not-a-node`)).status, 404);
    for (const slug of [
      "what-is-human",
      "awareness",
      "fictional-author-a",
      "fictional-comparison-notebook",
    ]) {
      const page = await json(`/api/nodes/${ids[slug]}`);
      assert.equal(page.document.id, ids[slug]);
      assert.ok(page.document.article.sections.length);
      assert.match(
        await html(page.document.href),
        new RegExp(page.document.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      for (const secret of [
        config.sessionSecret,
        config.reader.password,
        config.accounts.owner.dbPassword,
      ])
        assert.ok(!JSON.stringify(page).includes(secret));
    }
  });
  await test("X02 question to person to a different question is navigable in both directions", async () => {
    const question = await json(`/api/nodes/${ids["what-is-consciousness"]}`);
    const person = question.neighbors.items.find(
      (item) => item.node.id === ids["fictional-author-a"],
    );
    assert.ok(person);
    assert.equal(person.direction, "incoming");
    assert.ok(person.reason.length);
    assert.ok(
      (await html(question.document.href)).includes(
        `href="${person.node.href}"`,
      ),
    );
    const next = await json(`/api/nodes/${person.node.id}`);
    const alternate = next.neighbors.items.find(
      (item) => item.node.id === ids["can-we-choose"],
    );
    assert.ok(alternate);
    assert.equal(alternate.direction, "outgoing");
    assert.ok(
      (await html(person.node.href)).includes(`href="${alternate.node.href}"`),
    );
    assert.match(await html(alternate.node.href), /自由に選べる/);
    assert.equal((await fetch(`${origin}/evidence/${person.id}`)).status, 200);
    assert.equal(question.neighbors.has_more, false);
  });
  await test("X03 alias and normalized search find published nodes with literal wildcard handling", async () => {
    const alias = await json(
      "/api/search?q=" + encodeURIComponent("心のはたらき"),
    );
    assert.equal(alias.items[0].id, ids.awareness);
    const letters = await json(
      "/api/search?q=" + encodeURIComponent("Ｃｏｎｓｃｉｏｕｓｎｅｓｓ"),
    );
    assert.equal(letters.items[0].id, ids.awareness);
    assert.ok(
      (await html("/search?q=" + encodeURIComponent("心のはたらき"))).includes(
        alias.items[0].href,
      ),
    );
    assert.equal((await json("/api/search?q=%25")).items.length, 0);
    assert.equal((await json("/api/search?q=_")).items.length, 0);
    assert.ok(
      (await json("/api/search?type=person")).items.every(
        (item) => item.type === "person",
      ),
    );
    for (const path of [
      "/api/search?offset=-1",
      "/api/search?type=unknown",
      "/api/timeline?offset=NaN",
    ])
      assert.equal((await fetch(origin + path)).status, 400);
  });
  await test("X04 chronology preserves uncertain bounds and BCE to CE labels with source links", async () => {
    const timeline = await json("/api/timeline");
    assert.equal(timeline.items.length, 4);
    const boundary = timeline.items.find((item) => item.start_earliest === 0);
    assert.ok(boundary);
    assert.equal(boundary.end_earliest, 10);
    assert.match(boundary.date_label, /紀元前1年/);
    const uncertain = timeline.items.find(
      (item) => item.start_earliest !== item.start_latest,
    );
    assert.ok(uncertain);
    assert.ok(uncertain.original_label);
    assert.match(await html("/timeline"), /紀元前/);
    const person = await json(`/api/nodes/${ids["fictional-author-a"]}`);
    assert.equal(person.document.dates.length, 2);
    assert.ok(
      (await html(person.document.href)).includes(`/evidence/${boundary.id}`),
    );
    assert.equal(
      (await fetch(`${origin}/evidence/${boundary.id}`)).status,
      200,
    );
  });
  await test("X05 changing a slug preserves the old URL without changing knowledge identity", async () => {
    await db.query(
      "SELECT api.set_node_route($1,'ja','awareness-renamed','架空のURL変更試験')",
      [ids.awareness],
    );
    const old = await fetch(origin + "/concepts/awareness", {
      redirect: "manual",
    });
    assert.equal(old.status, 308);
    const destination = new URL(old.headers.get("location"), origin);
    assert.equal(destination.origin, origin);
    assert.equal(destination.pathname, "/concepts/awareness-renamed");
    const result = await json(`/api/nodes/${ids.awareness}`);
    assert.equal(result.document.id, ids.awareness);
    assert.equal(result.document.href, destination.pathname);
    assert.match(await html(destination.pathname), /意識/);
  });
  await test("X06 source revocation removes typed page, search, links, dates and timeline together", async () => {
    const source = config.fixture.explorationSources[1];
    const data = Object.values(
      (await db.query("SELECT api.editor_revision($1)", [source])).rows[0],
    )[0];
    await db.query(
      "SELECT api.revoke($1,$2,$3,'架空の資料Dを撤回する探索試験')",
      [source, data.generation, randomUUID()],
    );
    const personId = ids["fictional-editor-b"];
    assert.equal((await fetch(`${origin}/api/nodes/${personId}`)).status, 404);
    assert.equal(
      (await fetch(origin + "/people/fictional-editor-b")).status,
      404,
    );
    assert.equal(
      (await json("/api/search?q=" + encodeURIComponent("資料Dの編者"))).items
        .length,
      0,
    );
    assert.ok(
      !(await json("/api/timeline")).items.some(
        (item) => item.node.id === personId,
      ),
    );
    assert.ok(
      !(await json(`/api/nodes/${ids["what-is-self"]}`)).neighbors.items.some(
        (item) => item.node.id === personId,
      ),
    );
    assert.ok(
      !(await html("/questions/what-is-self")).includes(
        "/people/fictional-editor-b",
      ),
    );
    assert.equal(
      (await fetch(`${origin}/api/nodes/${config.fixture.rootId}`)).status,
      200,
    );
  });
  await test("X07 chronology draft editing uses human BCE years and requires separate review before publication", async () => {
    const person = await json(`/api/nodes/${ids["fictional-author-a"]}`);
    const revision = (
      await action(
        {
          action: "create",
          kind: "assertion",
          nature: "fact_report",
          subject: person.document.revision_id,
          source: config.fixture.explorationSources[0],
          text: "紀元前1年の出生という架空のHTTP試験用記述。",
          locator: "架空の年代表",
          summary: "紀元前1年の表示確認",
          speaker: "資料Cの筆者（架空）",
          speaker_role: "hypothesis",
          context: "架空の試験だけに使う年代",
          rationale: "Webで紀元前年を保存・確認する",
          reason: "架空の年代入力試験",
        },
        writer,
      )
    )
      .split("/")
      .at(-1);
    const fields = {
      action: "temporal",
      revision,
      role: "birth",
      date_label: "紀元前1年（HTTP架空例）",
      original_label: "検証用資料の紀元前1年",
      calendar: "紀元前・西暦の架空表記",
      start_earliest_year: "1",
      start_earliest_era: "bce",
      start_latest_year: "1",
      start_latest_era: "bce",
      end_earliest_year: "",
      end_earliest_era: "ce",
      end_latest_year: "",
      end_latest_era: "ce",
    };
    assert.equal((await post(fields, checker)).status, 403);
    await action(fields, writer);
    const draft = await inspect(revision);
    assert.equal(draft.revision.state, "draft");
    assert.equal(draft.temporal.start_earliest, 0);
    assert.equal(draft.temporal.start_latest, 0);
    assert.equal(draft.temporal.end_earliest, null);
    assert.match(
      await html(`/editor/revisions/${revision}`, owner),
      /紀元前1年/,
    );
    const invalid = await post({ ...fields, start_earliest_year: "0" }, writer);
    assert.match(invalid.headers.get("location"), /error=invalid/);
    assert.deepEqual((await inspect(revision)).temporal, draft.temporal);
    assert.ok(
      !(
        await json(`/api/nodes/${ids["fictional-author-a"]}`)
      ).document.dates.some((date) => date.id === revision),
    );
    await publish(revision);
    const approved = await json(`/api/nodes/${ids["fictional-author-a"]}`);
    assert.ok(approved.document.dates.some((date) => date.id === revision));
    const frozenEdit = await post(fields, writer);
    assert.match(frozenEdit.headers.get("location"), /error=invalid/);
    assert.deepEqual((await inspect(revision)).temporal, draft.temporal);
  });
  await test("X08 publishing person, concept and work pages returns their typed reader routes", async () => {
    for (const [slug, collection] of [
      ["fictional-author-a", "people"],
      ["awareness", "concepts"],
      ["fictional-comparison-notebook", "books"],
    ]) {
      const { document } = await json(`/api/nodes/${ids[slug]}`);
      const expected = `/${collection}/${document.id}`;
      const form = await html(`/editor/compose/${document.revision_id}`, owner);
      assert.ok(form.includes(`href="${expected}"`));
      const page = Object.values(
        (await db.query("SELECT api.editor_page($1,'ja')", [document.id]))
          .rows[0],
      )[0];
      const path = await action(
        {
          action: "compose",
          revision: document.revision_id,
          blocks: document.article.sections.map((block) => block.revision_id),
          generation: page.generation,
          operation: randomUUID(),
          human: "checked",
          reason: "架空の型別ページの公開経路を確認",
        },
        owner,
      );
      assert.equal(path, expected);
      const canonical = await fetch(origin + path, { redirect: "manual" });
      assert.equal(canonical.status, 308);
      assert.equal(
        new URL(canonical.headers.get("location"), origin).pathname,
        document.href,
      );
      assert.equal((await fetch(origin + document.href)).status, 200);
    }
  });
}
