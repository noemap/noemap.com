import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Integration fixtures are invented and are never evidence for real knowledge.
export async function runExplorationTests({
  admin,
  operator,
  editor,
  reader,
  scalar,
  test,
  rejects,
}) {
  const one = (sql, args = []) => scalar(operator, sql, args);
  const generation = (revision) =>
    scalar(
      admin,
      "SELECT o.generation FROM knowledge.objects o JOIN knowledge.revisions r ON r.object_id=o.id WHERE r.id=$1",
      [revision],
    );
  const draft = (kind, variant) =>
    one("SELECT api.create_draft($1,$2,'探索試験の架空例')", [kind, variant]);
  const text = (revision, role, value) =>
    operator.query("SELECT api.put_text($1,'ja',$2,$3)", [
      revision,
      role,
      value,
    ]);
  const publish = async (revision) => {
    await operator.query("SELECT api.freeze($1)", [revision]);
    const review = await one(
      "SELECT api.review($1,ARRAY['ja'],'approved','架空の探索データを確認')",
      [revision],
    );
    await operator.query("SELECT api.publish($1,$2,$3,$4)", [
      revision,
      review,
      await generation(revision),
      randomUUID(),
    ]);
  };
  async function node(title, type, aliases = [], withPage = true) {
    const revision = await draft("entity", type);
    await operator.query("SELECT api.put_entity($1,'架空の探索試験ノード')", [
      revision,
    ]);
    await text(revision, "preferred", title);
    for (const alias of aliases) await text(revision, "alias", alias);
    await publish(revision);
    const id = await scalar(
      admin,
      "SELECT object_id FROM knowledge.revisions WHERE id=$1",
      [revision],
    );
    const source = await draft("source", "edition");
    await operator.query(
      "SELECT api.put_source($1,'架空の探索資料・第1版','ja')",
      [source],
    );
    await text(source, "title", "探索試験の架空資料");
    await publish(source);
    const claim = await draft("assertion", "claim");
    await operator.query(
      "SELECT api.put_assertion($1,$2,'fact_report','架空の説明の範囲')",
      [claim, revision],
    );
    await text(claim, "body", `${title}についての架空の説明。`);
    await operator.query(
      "SELECT api.add_evidence($1,$2,'supports','第1節','探索動作の確認用')",
      [claim, source],
    );
    await publish(claim);
    const block = await draft("block", "summary");
    await operator.query("SELECT api.put_block($1,$2,'ja')", [block, revision]);
    const body = "短い説明\n探索動作を確かめるための架空の本文です。";
    await text(block, "body", body);
    await operator.query("SELECT api.add_block_reference($1,$2,0,$3)", [
      block,
      claim,
      [...body].length,
    ]);
    await publish(block);
    if (withPage)
      await operator.query(
        "SELECT api.release_page($1,'ja',$2,0,$3,'探索ページの組合せを確認')",
        [revision, [block], randomUUID()],
      );
    return { id, revision, source, claim, block };
  }
  async function relation(subject, target) {
    const revision = await draft("assertion", "relationship");
    await operator.query(
      "SELECT api.put_assertion($1,$2,'editorial','架空の本文から問いを考えるため',$3,'related_to_question',1)",
      [revision, subject.revision, target.revision],
    );
    await text(revision, "body", "この知識から問いを考える。架空の関連です。");
    await operator.query(
      "SELECT api.add_editorial_basis($1,$2,'説明と問いの比較')",
      [revision, subject.claim],
    );
    await publish(revision);
    return revision;
  }
  const readNode = (id, lang = "ja") =>
    scalar(reader, "SELECT api.public_node($1,$2)", [id, lang]);
  const search = (query, type = null, limit = 20, offset = 0) =>
    scalar(reader, "SELECT api.public_search($1,'ja',$2,$3,$4)", [
      query,
      type,
      limit,
      offset,
    ]);
  const neighbors = (id, limit = 20, offset = 0) =>
    scalar(reader, "SELECT api.public_neighbors($1,'ja',$2,$3)", [
      id,
      limit,
      offset,
    ]);
  let root, next, concept, person, work, hidden, edges;

  await test("G01 exploration reuses approved bundles across every supported node type and hides unpublished pages", async () => {
    root = await node("人間とは何か？", "question", ["探索の中心"]);
    next = await node("自由とは何か？", "question");
    concept = await node("探索用概念", "concept", ["Literal%_", "探索Exact"]);
    person = await node("探索Exact", "person", ["探索用人物"]);
    work = await node("探索Exactの著作", "work", ["探索用著作"]);
    hidden = await node("公開束がない知識", "concept", ["秘密Alias"], false);
    edges = [
      await relation(concept, root),
      await relation(person, root),
      await relation(concept, next),
    ];
    for (const [fixture, type, collection] of [
      [root, "question", "questions"],
      [concept, "concept", "concepts"],
      [person, "person", "people"],
      [work, "work", "books"],
    ]) {
      const result = await readNode(fixture.id);
      assert.equal(result.id, fixture.id);
      assert.equal(result.type, type);
      assert.equal(result.revision_id, fixture.revision);
      assert.equal(result.href, `/${collection}/${fixture.id}`);
      assert.ok(result.summary.includes("架空の本文"));
      assert.equal(result.article.sections.length, 1);
      assert.deepEqual(result.article.connections, []);
    }
    assert.equal(await readNode(hidden.id), null);
    assert.equal(await readNode(root.id, "en"), null);
    assert.deepEqual((await search("秘密Alias")).items, []);
  });

  await test("G02 one-hop edges traverse both directions with reasons, published endpoints and bounded pages", async () => {
    const inward = await neighbors(root.id, 1);
    assert.equal(inward.items.length, 1);
    assert.equal(inward.has_more, true);
    assert.equal(inward.items[0].direction, "incoming");
    assert.equal(inward.items[0].label, "この問いに関連する知識");
    assert.ok(inward.items[0].reason.includes("問い"));
    const second = await neighbors(root.id, 1, 1);
    assert.equal(second.items.length, 1);
    assert.equal(second.has_more, false);
    assert.notEqual(inward.items[0].id, second.items[0].id);
    const outward = await neighbors(concept.id);
    assert.equal(outward.items.length, 2);
    assert.ok(outward.items.every((x) => x.direction === "outgoing"));
    assert.ok(outward.items.some((x) => x.node.id === next.id));
    await relation(hidden, root);
    assert.equal((await neighbors(root.id)).items.length, 2);
    assert.deepEqual((await neighbors(hidden.id)).items, []);
    await rejects(() => neighbors(root.id, 41), /invalid neighbor page/);
    await rejects(() => neighbors(root.id, 20, -1), /invalid neighbor page/);
  });

  await test("G03 public title and alias search ranks exact titles before aliases and treats wildcard characters literally", async () => {
    const exact = await search("探索Exact");
    assert.deepEqual(
      exact.items.map((x) => x.id),
      [person.id, concept.id, work.id],
    );
    assert.deepEqual(
      (await search("%_")).items.map((x) => x.id),
      [concept.id],
    );
    assert.deepEqual(
      (await search("Literal%_")).items.map((x) => x.id),
      [concept.id],
    );
    assert.deepEqual(
      (await search("探索Exact", "work")).items.map((x) => x.id),
      [work.id],
    );
    const first = await search("探索Exact", null, 2);
    const second = await search("探索Exact", null, 2, 2);
    assert.equal(first.has_more, true);
    assert.equal(second.has_more, false);
    assert.equal(second.items.length, 1);
    const unpublished = await scalar(
      editor,
      "SELECT api.clone_revision($1,'非公開の別名')",
      [person.revision],
    );
    await operator.query(
      "SELECT api.put_text($1,'ja','alias','秘密DraftAlias')",
      [unpublished],
    );
    assert.deepEqual((await search("秘密DraftAlias")).items, []);
    await rejects(() => search("x".repeat(201)), /invalid public search/);
    await rejects(() => search("", "unsupported"), /invalid public search/);
  });

  await test("G04 publisher routes reserve history, validate ownership and redirect UUIDs without changing review generations", async () => {
    const before = await generation(root.revision);
    await operator.query(
      "SELECT api.set_node_route($1,'ja','human','中心のURL')",
      [root.id],
    );
    assert.equal((await readNode(root.id)).href, "/questions/human");
    assert.equal(await generation(root.revision), before);
    assert.deepEqual(
      await scalar(reader, "SELECT api.resolve_node('questions',$1,'ja')", [
        root.id,
      ]),
      { id: root.id, href: "/questions/human", redirect: true },
    );
    assert.equal(
      (
        await scalar(
          reader,
          "SELECT api.resolve_node('questions','human','ja')",
        )
      ).redirect,
      false,
    );
    await operator.query(
      "SELECT api.set_node_route($1,'ja','what-is-human','URLを整理')",
      [root.id],
    );
    assert.equal(
      (
        await scalar(
          reader,
          "SELECT api.resolve_node('questions','human','ja')",
        )
      ).href,
      "/questions/what-is-human",
    );
    await rejects(
      () =>
        operator.query("SELECT api.set_node_route($1,'ja','human','再利用')", [
          next.id,
        ]),
      /reserved/,
    );
    for (const invalid of ["../human", "https://example.com", root.id, "Human"])
      await rejects(
        () =>
          operator.query("SELECT api.set_node_route($1,'ja',$2,'不正なURL')", [
            root.id,
            invalid,
          ]),
        /invalid node slug/,
      );
    await rejects(
      () =>
        operator.query("SELECT api.set_node_route($1,'ja','hidden','不可')", [
          hidden.id,
        ]),
      /published navigable/,
    );
    assert.equal(
      await scalar(reader, "SELECT api.resolve_node('people','human','ja')"),
      null,
    );
    assert.equal(
      await scalar(reader, "SELECT api.resolve_node('questions','human','en')"),
      null,
    );
    assert.equal(
      await scalar(reader, "SELECT api.resolve_node('people',$1,'ja')", [
        root.id,
      ]),
      null,
    );
  });

  await test("G05 explicit home selection is audited and editor, inactive publishers and readers cannot mutate configuration", async () => {
    await operator.query("SELECT api.set_home($1,$2,'中心と入口を選択')", [
      root.id,
      [next.id],
    ]);
    const home = await scalar(reader, "SELECT api.public_home('ja')");
    assert.equal(home.root.id, root.id);
    assert.deepEqual(
      home.questions.map((x) => x.id),
      [next.id],
    );
    const audited = await scalar(
      admin,
      "SELECT count(*)::integer FROM publication.audit WHERE action IN('set_node_route','set_home') AND object_id=$1",
      [root.id],
    );
    assert.ok(audited >= 3);
    await rejects(
      () => editor.query("SELECT api.set_home($1,$2,'偽装')", [root.id, []]),
      /permission denied/,
    );
    await rejects(
      () =>
        reader.query("SELECT api.set_node_route($1,'ja','forged','偽装')", [
          root.id,
        ]),
      /permission denied/,
    );
    await rejects(
      () => reader.query("SELECT * FROM publication.node_routes"),
      /permission denied/,
    );
    await admin.query(
      "UPDATE publication.principals SET active=false WHERE db_role='test_operator'",
    );
    try {
      await rejects(
        () =>
          operator.query("SELECT api.set_home($1,$2,'無効な発行者')", [
            root.id,
            [],
          ]),
        /unauthorized/,
      );
    } finally {
      await admin.query(
        "UPDATE publication.principals SET active=true WHERE db_role='test_operator'",
      );
    }
    for (const entries of [
      [root.id],
      [next.id, next.id],
      [concept.id],
      [hidden.id],
    ])
      await rejects(
        () =>
          operator.query("SELECT api.set_home($1,$2,'不正な入口')", [
            root.id,
            entries,
          ]),
        /invalid home entries|published navigable questions/,
      );
    assert.deepEqual(await scalar(reader, "SELECT api.public_home('en')"), {
      root: null,
      questions: [],
    });
  });

  await test("G06 a newly selected entity revision hides the stale page and old edges until exact page ownership is published", async () => {
    const revision = await one(
      "SELECT api.clone_revision($1,'概念の版を更新')",
      [concept.revision],
    );
    await text(revision, "preferred", "更新済みの探索用概念");
    await publish(revision);
    assert.equal(await readNode(concept.id), null);
    assert.deepEqual((await search("Literal%_")).items, []);
    assert.ok(
      !(await neighbors(root.id)).items.some((x) => x.node.id === concept.id),
    );
    const block = await one("SELECT api.clone_revision($1,'新しい版の本文')", [
      concept.block,
    ]);
    await operator.query("SELECT api.put_block($1,$2,'ja')", [block, revision]);
    await publish(block);
    await operator.query(
      "SELECT api.release_page($1,'ja',$2,1,$3,'最新版の組合せを確認')",
      [revision, [block], randomUUID()],
    );
    assert.equal((await readNode(concept.id)).revision_id, revision);
    assert.deepEqual((await neighbors(concept.id)).items, []);
    assert.ok(
      !(await neighbors(root.id)).items.some((x) => x.node.id === concept.id),
    );
  });

  await test("G07 stopping a source removes node, route, search, home and both graph directions without choosing an older revision", async () => {
    await operator.query("SELECT api.revoke($1,$2,$3,'根拠を停止')", [
      root.source,
      await generation(root.source),
      randomUUID(),
    ]);
    assert.equal(await readNode(root.id), null);
    assert.deepEqual((await search("人間とは何か")).items, []);
    assert.equal(
      await scalar(reader, "SELECT api.resolve_node('questions','human','ja')"),
      null,
    );
    assert.equal(
      await scalar(reader, "SELECT api.resolve_node('questions',$1,'ja')", [
        root.id,
      ]),
      null,
    );
    assert.deepEqual((await neighbors(root.id)).items, []);
    assert.ok(
      !(await neighbors(person.id)).items.some((x) => x.node.id === root.id),
    );
    const home = await scalar(reader, "SELECT api.public_home('ja')");
    assert.equal(home.root, null);
    assert.deepEqual(
      home.questions.map((x) => x.id),
      [next.id],
    );
    assert.ok(await readNode(next.id));
  });

  await test("G08 graph projections select the relationship version and never revive a revoked latest relation", async () => {
    const question = await node("関係の版を確かめる問い", "question");
    const original = await relation(work, question);
    const updated = await one(
      "SELECT api.clone_revision($1,'関連理由を訂正')",
      [original],
    );
    await operator.query(
      "SELECT api.put_assertion($1,$2,'editorial','訂正した関連理由',$3,'related_to_question',1)",
      [updated, work.revision, question.revision],
    );
    await publish(updated);
    assert.ok(
      await scalar(reader, "SELECT api.read_evidence($1,'ja')", [original]),
    );
    assert.deepEqual(
      (await neighbors(question.id)).items.map((x) => x.id),
      [updated],
    );
    assert.equal(
      (await neighbors(question.id)).items[0].reason,
      "訂正した関連理由",
    );
    await operator.query("SELECT api.revoke($1,$2,$3,'最新版の理由を再確認')", [
      updated,
      await generation(updated),
      randomUUID(),
    ]);
    assert.deepEqual((await neighbors(question.id)).items, []);
    assert.ok(
      !(await neighbors(work.id)).items.some((x) => x.node.id === question.id),
    );
    assert.ok(await readNode(question.id));
  });

  await test("G09 graph endpoints must match the currently selected target page revision as well as the subject", async () => {
    const question = await node("対象の版を確かめる問い", "question");
    await relation(work, question);
    assert.ok(
      (await neighbors(work.id)).items.some((x) => x.node.id === question.id),
    );
    const revision = await one(
      "SELECT api.clone_revision($1,'問いの版を更新')",
      [question.revision],
    );
    await text(revision, "preferred", "更新済みの対象の問い");
    await publish(revision);
    assert.equal(await readNode(question.id), null);
    assert.ok(
      !(await neighbors(work.id)).items.some((x) => x.node.id === question.id),
    );
    const block = await one(
      "SELECT api.clone_revision($1,'対象の新しい本文')",
      [question.block],
    );
    await operator.query("SELECT api.put_block($1,$2,'ja')", [block, revision]);
    await publish(block);
    await operator.query(
      "SELECT api.release_page($1,'ja',$2,1,$3,'対象の最新版の組合せ')",
      [revision, [block], randomUUID()],
    );
    assert.equal((await readNode(question.id)).revision_id, revision);
    assert.deepEqual((await neighbors(question.id)).items, []);
    assert.ok(
      !(await neighbors(work.id)).items.some((x) => x.node.id === question.id),
    );
  });

  await test("G10 search normalizes fullwidth stored titles, aliases and queries together while preserving exact-title priority", async () => {
    const preferred = await node("ＮＦＫＣ探索", "person", ["全角Ａlias％＿"]);
    const alias = await node("表記比較用の概念", "concept", ["NFKC探索"]);
    for (const query of ["NFKC探索", "ＮＦＫＣ探索", "nfkc探索"])
      assert.deepEqual(
        (await search(query)).items.map((x) => x.id),
        [preferred.id, alias.id],
      );
    assert.deepEqual(
      (await search("全角Alias%_")).items.map((x) => x.id),
      [preferred.id],
    );
    assert.equal((await readNode(preferred.id)).title, "ＮＦＫＣ探索");
  });
}
