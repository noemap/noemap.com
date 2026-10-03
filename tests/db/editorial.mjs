import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function runEditorialTests(ctx) {
  const {
    admin,
    editor,
    reviewer,
    publisher,
    reader,
    create,
    text,
    freeze,
    review,
    publish,
    read,
    revoke,
    entity,
    source,
    assertion,
    block,
    object,
    generation,
    scalar,
    test,
    rejects,
  } = ctx;
  const person = await entity("追試用の人物");
  await publish(person);
  const question = await entity("追試用の問い", "question");
  await publish(question);
  const src = await source("追試用の資料");
  await publish(src);
  const base = await assertion(person, src);
  await freeze(base.rev);
  await publish(base.rev);
  let relation;
  await test("E01 editorial relation requires an explicit reviewed assertion basis", async () => {
    relation = await create("assertion", "relationship");
    await editor.query(
      "SELECT api.put_assertion($1,$2,'editorial','問いとの関係を説明',$3,'related_to_question',1)",
      [relation, person, question],
    );
    await text(relation, "body", "この立場を問いの比較に使う。");
    await rejects(() => freeze(relation), /editorial basis required/);
    await editor.query(
      "SELECT api.add_editorial_basis($1,$2,'根拠のある立場を比較する')",
      [relation, base.rev],
    );
    await freeze(relation);
    await publish(relation);
    assert.ok(await read(relation));
  });
  await test("E02 editorial dependency cycles are rejected", async () => {
    const a = await create("assertion", "claim"),
      b = await create("assertion", "claim");
    for (const r of [a, b]) {
      await editor.query(
        "SELECT api.put_assertion($1,$2,'editorial','循環の試験')",
        [r, person],
      );
      await text(r, "body", "循環例");
    }
    await editor.query("SELECT api.add_editorial_basis($1,$2,'相互参照')", [
      a,
      b,
    ]);
    await editor.query("SELECT api.add_editorial_basis($1,$2,'相互参照')", [
      b,
      a,
    ]);
    await rejects(() => freeze(a), /dependency cycle/);
  });
  await test("E03 attribution preserves speaker role and reporting context", async () => {
    const c = await assertion(person, src);
    await editor.query(
      "SELECT api.attribute($1,$2,$3,'架空の編者','editor_note','原著者の本文と区別した注記',$4)",
      [c.rev, c.eid, src, person],
    );
    await rejects(
      () =>
        editor.query(
          "SELECT api.attribute($1,$2,$3,'誤役割','unknown','',NULL)",
          [c.rev, c.eid, src],
        ),
      /check constraint/,
    );
    await freeze(c.rev);
    await publish(c.rev);
    const result = await scalar(reader, "SELECT api.read_evidence($1,'ja')", [
      c.rev,
    ]);
    assert.ok(
      result.attributions.some(
        (a) => a.role === "editor_note" && a.context.includes("注記"),
      ),
    );
  });
  let translated, sourceText, destinationText;
  await test("E04 translation links enforce the same knowledge object", async () => {
    sourceText = await scalar(
      admin,
      "SELECT id FROM knowledge.texts WHERE revision_id=$1 AND role='body'",
      [base.rev],
    );
    const other = await assertion(person, src);
    await text(other.rev, "body", "Another claim", "en");
    const otherText = await scalar(
      admin,
      "SELECT id FROM knowledge.texts WHERE revision_id=$1 AND language='en'",
      [other.rev],
    );
    await rejects(
      () =>
        editor.query("SELECT api.add_translation($1,$2,'誤った翻訳元')", [
          otherText,
          sourceText,
        ]),
      /foreign key/,
    );
    translated = await assertion(person, src, await object(base.rev));
    await text(
      translated.rev,
      "body",
      "A fictional position for a translation test.",
      "en",
    );
    destinationText = await scalar(
      admin,
      "SELECT id FROM knowledge.texts WHERE revision_id=$1 AND language='en'",
      [translated.rev],
    );
    await editor.query(
      "SELECT api.add_translation($1,$2,'意味を確認する翻訳')",
      [destinationText, sourceText],
    );
    await freeze(translated.rev);
    assert.equal(await read(translated.rev, "en"), null);
    await publish(translated.rev, await review(translated.rev, ["ja", "en"]));
    assert.ok(await read(translated.rev, "en"));
  });
  await test("E05 circular translation within one revision is rejected", async () => {
    const c = await assertion(person, src, await object(base.rev));
    await text(c.rev, "body", "Circular translation", "en");
    const ja = await scalar(
      admin,
      "SELECT id FROM knowledge.texts WHERE revision_id=$1 AND language='ja'",
      [c.rev],
    );
    const en = await scalar(
      admin,
      "SELECT id FROM knowledge.texts WHERE revision_id=$1 AND language='en'",
      [c.rev],
    );
    await editor.query("SELECT api.add_translation($1,$2,'循環')", [ja, en]);
    await editor.query("SELECT api.add_translation($1,$2,'循環')", [en, ja]);
    await rejects(() => freeze(c.rev), /translation cycle/);
  });
  await test("E06 new attribution, translation and editorial children are frozen too", async () => {
    await rejects(
      () =>
        editor.query("SELECT api.add_editorial_basis($1,$2,'後入り')", [
          relation,
          translated.rev,
        ]),
      /frozen/,
    );
    await rejects(
      () =>
        editor.query("SELECT api.add_translation($1,$2,'後入り')", [
          destinationText,
          sourceText,
        ]),
      /frozen/,
    );
    await rejects(
      () =>
        editor.query("SELECT api.source_credit($1,'translator','後から追加')", [
          src,
        ]),
      /frozen/,
    );
  });
  await test("E07 resume requires new reviews and revokes every old permission", async () => {
    const a = await source("再開試験・旧版"),
      oldReview = await review(a);
    await publish(a, oldReview);
    const b = await source("再開試験・新版", await object(a));
    await publish(b);
    const id = await object(a);
    await publisher.query("SELECT api.suspend($1,$2,$3,$4)", [
      id,
      await generation(a),
      randomUUID(),
      "再確認",
    ]);
    const gen = await generation(a);
    await rejects(
      () =>
        publisher.query("SELECT api.resume($1,$2,$3,$4,$5)", [
          id,
          [oldReview],
          gen,
          randomUUID(),
          "再開",
        ]),
      /new reviewed version/,
    );
    const fresh = await review(b);
    const op = randomUUID();
    const first = await scalar(publisher, "SELECT api.resume($1,$2,$3,$4,$5)", [
      id,
      [fresh],
      gen,
      op,
      "新版を確認して再開",
    ]);
    assert.ok(await read(b));
    assert.equal(await read(a), null);
    assert.deepEqual(
      await scalar(publisher, "SELECT api.resume($1,$2,$3,$4,$5)", [
        id,
        [fresh],
        gen,
        op,
        "新版を確認して再開",
      ]),
      first,
    );
  });
  await test("E08 failed resume rolls back old grants and suspended state", async () => {
    const s = await source("再開依存");
    await publish(s);
    const c = await assertion(person, s);
    await freeze(c.rev);
    await publish(c.rev);
    const id = await object(c.rev);
    await publisher.query("SELECT api.suspend($1,$2,$3,$4)", [
      id,
      await generation(c.rev),
      randomUUID(),
      "停止",
    ]);
    await revoke(s);
    const fresh = await review(c.rev);
    const gen = await generation(c.rev);
    const before = await scalar(
      admin,
      "SELECT count(*)::int FROM publication.grants WHERE revision_id=$1 AND revoked_at IS NULL",
      [c.rev],
    );
    await rejects(
      () =>
        publisher.query("SELECT api.resume($1,$2,$3,$4,$5)", [
          id,
          [fresh],
          gen,
          randomUUID(),
          "依存停止のまま再開",
        ]),
      /dependency unavailable/,
    );
    assert.equal(await generation(c.rev), gen);
    assert.equal(
      await scalar(admin, "SELECT state FROM knowledge.objects WHERE id=$1", [
        id,
      ]),
      "suspended",
    );
    assert.equal(
      await scalar(
        admin,
        "SELECT count(*)::int FROM publication.grants WHERE revision_id=$1 AND revoked_at IS NULL",
        [c.rev],
      ),
      before,
    );
  });
  await test("E09 withdrawing a review immediately stops its public grant", async () => {
    const r = await entity("審査撤回");
    const v = await review(r);
    await publish(r, v);
    await reviewer.query("SELECT api.withdraw_review($1,$2,$3,$4)", [
      v,
      await generation(r),
      randomUUID(),
      "確認を取り消す",
    ]);
    assert.equal(await read(r), null);
    await rejects(() => publish(r, v), /approved current review/);
    await publish(r);
    assert.ok(await read(r));
  });
  await test("E10 revoking a translation source stops the translated revision", async () => {
    assert.ok(await read(translated.rev, "en"));
    await revoke(base.rev);
    assert.equal(await read(translated.rev, "en"), null);
    assert.equal(await read(relation), null);
  });
  await test("E11 suspended editors cannot mutate through child functions", async () => {
    const draft = await create("entity", "concept");
    await admin.query(
      "UPDATE publication.principals SET active=false WHERE db_role='test_editor'",
    );
    try {
      await rejects(
        () => text(draft, "preferred", "無断更新"),
        /unauthorized actor/,
      );
      await rejects(() => create("entity", "concept"), /unauthorized actor/);
    } finally {
      await admin.query(
        "UPDATE publication.principals SET active=true WHERE db_role='test_editor'",
      );
    }
  });
  await test("E12 source metadata and credits preserve edition and contributor roles", async () => {
    const r = await create("source", "edition");
    await editor.query("SELECT api.put_source($1,'架空書誌','ja')", [r]);
    await text(r, "title", "書誌例");
    await editor.query(
      "SELECT api.source_metadata($1,'第2版','試験出版社、試験年','https://example.com/source',NULL)",
      [r],
    );
    await editor.query("SELECT api.source_credit($1,'author','架空著者')", [r]);
    await editor.query("SELECT api.source_credit($1,'translator','架空訳者')", [
      r,
    ]);
    await freeze(r);
    const result = await scalar(editor, "SELECT api.editor_revision($1)", [r]);
    assert.equal(result.source_metadata.edition, "第2版");
    assert.equal(result.source_credits.length, 2);
    await rejects(
      () => reader.query("SELECT api.editor_revision($1)", [r]),
      /permission denied/,
    );
  });
}
