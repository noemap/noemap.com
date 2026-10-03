import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { seedLocalKnowledge } from "../fixtures/local-knowledge.mjs";
export async function runEditorApiTests({
  admin,
  operator,
  editor,
  reader,
  scalar,
  test,
  rejects,
}) {
  let fixture;
  await test("F01 real read model returns reviewed sections, bibliography and evidence-based SVG connections", async () => {
    fixture = await seedLocalKnowledge(operator);
    const a = await scalar(reader, "SELECT api.read_article($1,'ja')", [
      fixture.questionId,
    ]);
    assert.equal(a.sections.length, 3);
    assert.equal(a.connections.length, 2);
    assert.ok(
      a.sections.every((s) => s.assertions.every((a) => a.sources.length)),
    );
    assert.ok(
      (await scalar(reader, "SELECT api.public_catalog('ja')")).some(
        (x) => x.id === fixture.questionId,
      ),
    );
  });
  await test("F02 cloned corrections preserve the frozen original and bind copied attribution to new evidence", async () => {
    const original = await scalar(operator, "SELECT api.editor_revision($1)", [
      fixture.assertionIds[0],
    ]);
    const clone = await scalar(
      editor,
      "SELECT api.clone_revision($1,'説明を訂正')",
      [fixture.assertionIds[0]],
    );
    const data = await scalar(editor, "SELECT api.editor_revision($1)", [
      clone,
    ]);
    assert.equal(data.revision.object_id, original.revision.object_id);
    assert.equal(data.revision.state, "draft");
    assert.notEqual(data.evidence[0].id, original.evidence[0].id);
    assert.equal(data.attributions[0].evidence_id, data.evidence[0].id);
    await editor.query("SELECT api.put_text($1,'ja','body','訂正後の説明')", [
      clone,
    ]);
    assert.deepEqual(
      await scalar(operator, "SELECT api.editor_revision($1)", [
        fixture.assertionIds[0],
      ]),
      original,
    );
    await editor.query("SELECT api.freeze($1)", [clone]);
    const block = await scalar(
      editor,
      "SELECT api.clone_revision($1,'本文を訂正')",
      [fixture.blockIds[0]],
    );
    await editor.query("SELECT api.put_text($1,'ja','body','短い😀')", [block]);
    await editor.query("SELECT api.replace_block_references($1,$2,3)", [
      block,
      [fixture.assertionIds[0]],
    ]);
    await editor.query("SELECT api.freeze($1)", [block]);
    await rejects(
      () =>
        editor.query("SELECT api.replace_block_references($1,$2,3)", [
          block,
          [fixture.assertionIds[0]],
        ]),
      /draft block/,
    );
  });
  await test("F03 inactive principals cannot inspect drafts; readers have no editor projection or write entry point", async () => {
    await admin.query(
      "UPDATE publication.principals SET active=false WHERE db_role='test_editor'",
    );
    try {
      await rejects(
        () => scalar(editor, "SELECT api.editor_list()"),
        /unauthorized/,
      );
      await rejects(
        () =>
          scalar(editor, "SELECT api.editor_revision($1)", [
            fixture.questionRevision,
          ]),
        /unauthorized/,
      );
    } finally {
      await admin.query(
        "UPDATE publication.principals SET active=true WHERE db_role='test_editor'",
      );
    }
    await rejects(
      () => scalar(reader, "SELECT api.editor_list()"),
      /permission denied/,
    );
    await rejects(
      () =>
        scalar(reader, "SELECT api.clone_revision($1,'forged')", [
          fixture.questionRevision,
        ]),
      /permission denied/,
    );
  });
  await test("F04 page release is atomic and idempotent; stale generation rolls back the new review", async () => {
    const op = randomUUID();
    const args = [
      fixture.questionRevision,
      fixture.blockIds,
      1,
      op,
      "組合せを再確認",
    ];
    const first = await scalar(
      operator,
      "SELECT api.release_page($1,'ja',$2,$3,$4,$5)",
      args,
    );
    assert.deepEqual(
      await scalar(
        operator,
        "SELECT api.release_page($1,'ja',$2,$3,$4,$5)",
        args,
      ),
      first,
    );
    await rejects(
      () =>
        scalar(operator, "SELECT api.release_page($1,'ja',$2,$3,$4,$5)", [
          ...args.slice(0, 4),
          "違う理由",
        ]),
      /operation id reused/,
    );
    const before = await scalar(
      admin,
      "SELECT count(*)::int FROM publication.page_reviews",
    );
    await rejects(
      () =>
        scalar(
          operator,
          "SELECT api.release_page($1,'ja',$2,0,$3,'古い世代')",
          [fixture.questionRevision, fixture.blockIds, randomUUID()],
        ),
      /generation conflict/,
    );
    assert.equal(
      await scalar(admin, "SELECT count(*)::int FROM publication.page_reviews"),
      before,
    );
    await rejects(
      () =>
        scalar(editor, "SELECT api.release_page($1,'ja',$2,2,$3,'権限偽装')", [
          fixture.questionRevision,
          fixture.blockIds,
          randomUUID(),
        ]),
      /permission denied/,
    );
  });
  await test("F05 wrong page ownership cannot create a bundle or expose content", async () => {
    const concept = await scalar(
      admin,
      "SELECT subject_revision_id FROM knowledge.assertions WHERE revision_id=$1",
      [fixture.assertionIds[0]],
    );
    const before = await scalar(
      admin,
      "SELECT count(*)::int FROM publication.page_reviews",
    );
    await rejects(
      () =>
        scalar(
          operator,
          "SELECT api.release_page($1,'ja',$2,0,$3,'別の主題')",
          [concept, fixture.blockIds, randomUUID()],
        ),
      /wrong ownership/,
    );
    assert.equal(
      await scalar(admin, "SELECT count(*)::int FROM publication.page_reviews"),
      before,
    );
  });
  await test("F06 stopping a source hides dependent article, catalogue, evidence and connections without republishing", async () => {
    const source = await scalar(operator, "SELECT api.editor_revision($1)", [
      fixture.sourceIds[0],
    ]);
    await operator.query("SELECT api.revoke($1,$2,$3,'根拠を再確認')", [
      fixture.sourceIds[0],
      source.generation,
      randomUUID(),
    ]);
    assert.equal(
      await scalar(reader, "SELECT api.read_article($1,'ja')", [
        fixture.questionId,
      ]),
      null,
    );
    assert.equal(
      await scalar(reader, "SELECT api.read_evidence($1,'ja')", [
        fixture.assertionIds[0],
      ]),
      null,
    );
    assert.ok(
      !(await scalar(reader, "SELECT api.public_catalog('ja')")).some(
        (x) => x.id === fixture.questionId,
      ),
    );
    assert.ok(
      await scalar(reader, "SELECT api.read_evidence($1,'ja')", [
        fixture.assertionIds[1],
      ]),
    );
  });
}
