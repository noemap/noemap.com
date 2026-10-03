import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function runChronologyTests(ctx) {
  const {
    admin,
    editor,
    reviewer,
    publisher,
    reader,
    create,
    text,
    freeze,
    publish,
    revoke,
    entity,
    source,
    assertion,
    block,
    object,
    scalar,
    test,
    rejects,
  } = ctx;

  const person = await entity("年代の架空人物");
  await publish(person);
  const nodeId = await object(person);
  const pageSource = await source("年代ページの独立した架空資料");
  await publish(pageSource);

  async function releasePage(subject) {
    const anchor = await assertion(subject, pageSource);
    await freeze(anchor.rev);
    await publish(anchor.rev);
    const summary = await block(
      subject,
      anchor.rev,
      "年代表示を試す架空の本文。",
    );
    await publish(summary);
    const reviewId = await scalar(
      reviewer,
      "SELECT api.review_page($1,'ja',$2,'年代ページの架空試験')",
      [subject, [summary]],
    );
    const generation = await scalar(
      admin,
      "SELECT coalesce((SELECT generation FROM publication.pages WHERE entity_id=$1 AND language='ja'),0)",
      [await object(subject)],
    );
    await publisher.query("SELECT api.publish_page($1,$2,$3)", [
      reviewId,
      generation,
      randomUUID(),
    ]);
    return anchor;
  }
  const anchor = await releasePage(person);
  const dateSource = await source("紀年に関する架空資料");
  await publish(dateSource);

  async function claim(
    subject = person,
    src = dateSource,
    nature = "fact_report",
  ) {
    const rev = await create("assertion", "claim");
    await editor.query(
      "SELECT api.put_assertion($1,$2,$3,'原資料の紀年表記を保持')",
      [rev, subject, nature],
    );
    await text(
      rev,
      "body",
      "架空資料が示す年代。実在人物の史実ではありません。",
    );
    let evidence;
    if (src) {
      evidence = await scalar(
        editor,
        "SELECT api.add_evidence($1,$2,'supports','紀年欄','架空の年代の根拠')",
        [rev, src],
      );
    }
    return { rev, evidence };
  }
  const put = (
    rev,
    role = "birth",
    earliest = 0,
    latest = earliest,
    endEarliest = null,
    endLatest = endEarliest,
    label = "紀元前1年ごろ（試験）",
  ) =>
    editor.query("SELECT api.put_temporal($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [
      rev,
      role,
      "架空原資料の紀年表記",
      label,
      "原資料の暦は未特定",
      "astronomical_year",
      earliest,
      latest,
      endEarliest,
      endLatest,
    ]);
  const dates = (id = nodeId, lang = "ja") =>
    scalar(reader, "SELECT api.public_dates($1,$2)", [id, lang]);
  const timeline = (limit = 20, offset = 0, lang = "ja") =>
    scalar(reader, "SELECT api.public_timeline($1,$2,$3)", [
      lang,
      limit,
      offset,
    ]);

  let zero, uncertain, unknown, oneSided;
  await test("T01 chronology preserves BCE zero, independent uncertainty and original labels", async () => {
    zero = (await claim()).rev;
    await put(zero);
    uncertain = (await claim(person, dateSource, "interpretation")).rev;
    await put(
      uncertain,
      "active",
      -500,
      -450,
      -430,
      -400,
      "活動年代には幅がある（試験）",
    );
    unknown = (await claim()).rev;
    await put(unknown, "death", null, null, null, null, "没年不明（試験）");
    oneSided = (await claim()).rev;
    await put(
      oneSided,
      "birth",
      null,
      -400,
      null,
      null,
      "紀元前401年以前（試験）",
    );
    for (const rev of [zero, uncertain, unknown, oneSided]) {
      await freeze(rev);
      await publish(rev);
    }
    const result = await dates();
    assert.equal(result.find((x) => x.id === zero).start_earliest, 0);
    assert.equal(
      result.find((x) => x.id === zero).date_label,
      "紀元前1年ごろ（試験）",
    );
    const range = result.find((x) => x.id === uncertain);
    assert.equal(range.start_latest, -450);
    assert.equal(range.end_earliest, -430);
    assert.equal(range.end_latest, -400);
    assert.equal(range.original_label, "架空原資料の紀年表記");
    assert.equal(range.calendar, "原資料の暦は未特定");
    assert.equal(range.precision, "year");
    assert.equal(result.find((x) => x.id === unknown).start_earliest, null);
    assert.equal(result.find((x) => x.id === oneSided).start_earliest, null);
    assert.equal(result.find((x) => x.id === oneSided).start_latest, -400);
  });

  await test("T02 finite year bounds and impossible temporal intervals are rejected", async () => {
    const rev = (await claim()).rev;
    for (const args of [
      ["birth", 20, 10],
      ["active", 10, 20, 8, 7],
      ["active", 10, 20, 1, 9],
      ["birth", 10, 10, 20, 20],
      ["unknown_role", 10, 10],
    ]) {
      await rejects(() => put(rev, ...args), /check constraint/);
    }
    for (const year of [-2147483649, 2147483648, Infinity, -Infinity, NaN]) {
      await rejects(
        () => put(rev, "birth", year, year),
        /out of range|invalid input syntax/,
      );
    }
    await put(
      rev,
      "birth",
      -300000,
      -250000,
      null,
      null,
      "先史年代にも幅がある（架空試験）",
    );
    await rejects(
      () =>
        editor.query(
          "SELECT api.put_temporal($1,'birth','','年代','暦','astronomical_year',0,0)",
          [rev],
        ),
      /check constraint/,
    );
    await rejects(
      () =>
        editor.query(
          "SELECT api.put_temporal($1,'birth','原文','年代','暦','civil_year',0,0)",
          [rev],
        ),
      /check constraint/,
    );
    // The uncertainty intervals may overlap; they do not assert a definite order.
    await put(rev, "active", 10, 20, 15, 25);
  });

  await test("T03 temporal roles require sourced fact or interpretation claims and matching subjects", async () => {
    const position = await assertion(person, dateSource);
    await rejects(
      () => put(position.rev),
      /fact-report or interpretation claim/,
    );
    const editorial = (await claim(person, dateSource, "editorial")).rev;
    await rejects(() => put(editorial), /fact-report or interpretation claim/);
    const concept = await entity("年代の架空概念", "concept");
    await publish(concept);
    const wrongSubject = (await claim(concept)).rev;
    await rejects(() => put(wrongSubject), /role and subject type mismatch/);
    const wrongPublication = (await claim()).rev;
    await rejects(
      () => put(wrongPublication, "publication"),
      /role and subject type mismatch/,
    );
    const work = await entity("年代の架空著作", "work");
    await publish(work);
    const publication = (await claim(work)).rev;
    await put(
      publication,
      "publication",
      50,
      50,
      null,
      null,
      "紀元50年刊行（試験）",
    );
    await freeze(publication);
    await publish(publication);
    const founding = (await claim(concept)).rev;
    await put(
      founding,
      "founding",
      60,
      70,
      null,
      null,
      "紀元60～70年成立（試験）",
    );
    await freeze(founding);
    await publish(founding);
    const question = await entity("年代の架空の問い", "question");
    await publish(question);
    const relationship = await create("assertion", "relationship");
    await editor.query(
      "SELECT api.put_assertion($1,$2,'editorial','架空の関連',$3,'related_to_question',1)",
      [relationship, person, question],
    );
    await rejects(
      () => put(relationship),
      /fact-report or interpretation claim/,
    );
    const unsourced = (await claim(person, null)).rev;
    await put(unsourced);
    await rejects(() => freeze(unsourced), /supporting evidence required/);
    const changed = (await claim()).rev;
    await put(changed);
    await editor.query(
      "SELECT api.put_assertion($1,$2,'editorial','下書きの性質を変更')",
      [changed, person],
    );
    await editor.query(
      "SELECT api.add_editorial_basis($1,$2,'確認済みの試験上の関連')",
      [changed, anchor.rev],
    );
    await rejects(() => freeze(changed), /fact-report or interpretation claim/);
  });

  let correction;
  await test("T04 frozen chronology is immutable and cloning preserves dates before correction", async () => {
    const original = await scalar(
      admin,
      "SELECT to_jsonb(t) FROM knowledge.temporal_statements t WHERE revision_id=$1",
      [zero],
    );
    const inspected = await scalar(reviewer, "SELECT api.editor_revision($1)", [
      zero,
    ]);
    assert.deepEqual(inspected.temporal, original);
    await rejects(() => put(zero, "birth", 1), /frozen revision/);
    await rejects(
      () =>
        admin.query(
          "DELETE FROM knowledge.temporal_statements WHERE revision_id=$1",
          [zero],
        ),
      /unauthorized actor|frozen revision/,
    );
    correction = await scalar(
      editor,
      "SELECT api.clone_revision($1,'年代の架空訂正')",
      [zero],
    );
    const cloned = await scalar(
      admin,
      "SELECT to_jsonb(t) FROM knowledge.temporal_statements t WHERE revision_id=$1",
      [correction],
    );
    assert.deepEqual(
      (await scalar(editor, "SELECT api.editor_revision($1)", [correction]))
        .temporal,
      cloned,
    );
    assert.deepEqual({ ...cloned, revision_id: zero }, original);
    await put(correction, "birth", 1, 1, null, null, "紀元1年（訂正試験）");
    assert.deepEqual(
      await scalar(
        admin,
        "SELECT to_jsonb(t) FROM knowledge.temporal_statements t WHERE revision_id=$1",
        [zero],
      ),
      original,
    );
    await freeze(correction);
    await publish(correction);
    const result = await dates();
    assert.ok(
      result.some((x) => x.id === correction && x.start_earliest === 1),
    );
    assert.ok(!result.some((x) => x.id === zero));
    await rejects(
      () =>
        editor.query("SELECT publication.clone_base_revision($1,'直接実行')", [
          zero,
        ]),
      /permission denied/,
    );
    await rejects(
      () => scalar(reader, "SELECT api.editor_revision($1)", [correction]),
      /permission denied/,
    );
    await rejects(
      () =>
        scalar(editor, "SELECT publication.editor_revision($1)", [correction]),
      /permission denied/,
    );
  });

  let nextPerson;
  await test("T05 chronology never silently transfers to a corrected subject revision", async () => {
    nextPerson = await entity("年代の架空人物・識別訂正", "person", nodeId);
    await publish(nextPerson);
    assert.deepEqual(await dates(), []);
    await releasePage(nextPerson);
    assert.deepEqual(await dates(), []);
    const nextDate = await scalar(
      editor,
      "SELECT api.clone_revision($1,'訂正した人物版を再確認')",
      [correction],
    );
    await editor.query(
      "SELECT api.put_assertion($1,$2,'fact_report','同じ資料を訂正した人物に再確認')",
      [nextDate, nextPerson],
    );
    await freeze(nextDate);
    await publish(nextDate);
    assert.deepEqual(
      (await dates()).map((x) => x.id),
      [nextDate],
    );
    assert.equal((await dates())[0].node.revision_id, nextPerson);
  });

  let alternativeA, alternativeB, sourceA;
  await test("T06 differing dates remain separate sourced assertions and revocation removes only its dependents", async () => {
    sourceA = await source("年代の異説Aの架空資料");
    const sourceB = await source("年代の異説Bの架空資料");
    await publish(sourceA);
    await publish(sourceB);
    alternativeA = (await claim(nextPerson, sourceA)).rev;
    alternativeB = (await claim(nextPerson, sourceB, "interpretation")).rev;
    await put(alternativeA, "birth", -500, -480, null, null, "異説A（試験）");
    await put(alternativeB, "birth", -470, -460, null, null, "異説B（試験）");
    for (const rev of [alternativeA, alternativeB]) {
      await freeze(rev);
      await publish(rev);
    }
    assert.ok((await dates()).some((x) => x.id === alternativeA));
    assert.ok((await dates()).some((x) => x.id === alternativeB));
    const evidence = await scalar(reader, "SELECT api.read_evidence($1,'ja')", [
      alternativeA,
    ]);
    assert.equal(evidence.sources[0].source_revision_id, sourceA);
    await revoke(sourceA);
    const result = await dates();
    assert.ok(!result.some((x) => x.id === alternativeA));
    assert.ok(result.some((x) => x.id === alternativeB));
    assert.ok(!(await timeline()).items.some((x) => x.id === alternativeA));
  });

  await test("T07 chronology pagination is bounded, stable and language scoped", async () => {
    // A visible Japanese node and claim cannot expose a date whose source lacks
    // Japanese publication approval, even when its original language is public.
    const foreignSource = await create("source", "edition");
    await editor.query(
      "SELECT api.put_source($1,'Fictional English-only source','en')",
      [foreignSource],
    );
    await text(foreignSource, "title", "Fictional chronology source", "en");
    await freeze(foreignSource);
    const foreignReview = await scalar(
      reviewer,
      "SELECT api.review($1,ARRAY['en'],'approved','架空の英語資料だけを確認')",
      [foreignSource],
    );
    const foreignGeneration = await scalar(
      admin,
      "SELECT o.generation FROM knowledge.objects o JOIN knowledge.revisions r ON r.object_id=o.id WHERE r.id=$1",
      [foreignSource],
    );
    await publisher.query("SELECT api.publish($1,$2,$3,$4)", [
      foreignSource,
      foreignReview,
      foreignGeneration,
      randomUUID(),
    ]);
    const foreignDate = (await claim(nextPerson, foreignSource)).rev;
    await put(
      foreignDate,
      "birth",
      200,
      200,
      null,
      null,
      "日本語で出典未確認の年代（試験）",
    );
    await freeze(foreignDate);
    await publish(foreignDate);
    assert.ok(!(await dates()).some((x) => x.id === foreignDate));
    assert.ok(!(await timeline()).items.some((x) => x.id === foreignDate));
    const first = await timeline(1, 0);
    const next = await timeline(1, 1);
    assert.equal(first.items.length, 1);
    assert.equal(first.has_more, true);
    assert.equal(first.offset, 0);
    assert.equal(next.offset, 1);
    assert.notEqual(first.items[0].id, next.items[0].id);
    assert.deepEqual(await dates(nodeId, "en"), []);
    assert.deepEqual((await timeline(20, 0, "en")).items, []);
    for (const args of [
      [0, 0],
      [51, 0],
      [1, -1],
      [1, 10001],
      [null, 0],
      [1, null],
    ]) {
      await rejects(() => timeline(...args), /invalid timeline bounds/);
    }
    await rejects(() => timeline(20, 0, "invalid"), /invalid timeline bounds/);
    const volatility = await scalar(
      admin,
      "SELECT bool_and(p.provolatile='s') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='api' AND p.proname IN ('public_timeline','public_dates')) OR (n.nspname='publication' AND p.proname='timeline_rows')",
    );
    assert.equal(volatility, true);
    await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      await rejects(() => timeline(), /fresh READ COMMITTED/);
    } finally {
      await reader.query("ROLLBACK");
    }
  });

  await test("T08 runtime users cannot bypass chronology projections or actor checks", async () => {
    for (const client of [reader, editor, reviewer, publisher]) {
      await rejects(
        () => client.query("SELECT * FROM knowledge.temporal_statements"),
        /permission denied/,
      );
    }
    await rejects(
      () =>
        reader.query(
          "SELECT api.put_temporal($1,'birth','原文','年代','暦','astronomical_year',0,0)",
          [correction],
        ),
      /permission denied/,
    );
    const draft = (await claim(nextPerson)).rev;
    await admin.query(
      "UPDATE publication.principals SET active=false WHERE db_role='test_editor'",
    );
    try {
      await rejects(() => put(draft), /unauthorized actor/);
      await rejects(
        () => scalar(editor, "SELECT api.editor_revision($1)", [correction]),
        /unauthorized actor/,
      );
    } finally {
      await admin.query(
        "UPDATE publication.principals SET active=true WHERE db_role='test_editor'",
      );
    }
  });
}
