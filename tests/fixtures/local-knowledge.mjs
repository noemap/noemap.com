import { randomUUID } from "node:crypto";

// Only fictional fixtures are reviewed here. This never approves real source material.
export async function seedLocalKnowledge(client) {
  const one = async (sql, args = []) =>
    Object.values((await client.query(sql, args)).rows[0])[0];
  const make = (kind, variant) =>
    one("SELECT api.create_draft($1,$2,$3)", [
      kind,
      variant,
      "架空の動作確認用データ",
    ]);
  const text = (id, role, body) =>
    client.query("SELECT api.put_text($1,'ja',$2,$3)", [id, role, body]);
  const publish = async (id) => {
    await client.query("SELECT api.freeze($1)", [id]);
    const review = await one(
      "SELECT api.review($1,ARRAY['ja'],'approved','架空データによる動作確認。実資料の内容承認ではない。')",
      [id],
    );
    await client.query("SELECT api.publish($1,$2,0,$3)", [
      id,
      review,
      randomUUID(),
    ]);
  };
  const entity = async (label, variant) => {
    const id = await make("entity", variant);
    await client.query("SELECT api.put_entity($1,$2)", [
      id,
      "架空の動作確認用の識別範囲",
    ]);
    await text(id, "preferred", label);
    await publish(id);
    return id;
  };
  const question = await entity("私は誰なのか？", "question");
  const memory = await entity("記憶の連続性", "concept");
  const body = await entity("身体の連続性", "concept");
  async function source(title, author) {
    const id = await make("source", "edition");
    await client.query("SELECT api.put_source($1,$2,'ja')", [
      id,
      `${author}『${title}』第1版。動作確認用の架空資料。`,
    ]);
    await text(id, "title", title);
    await client.query(
      "SELECT api.source_metadata($1,'第1版・動作確認用','架空の刊行情報',NULL,NULL)",
      [id],
    );
    await client.query("SELECT api.source_credit($1,'author',$2)", [
      id,
      author,
    ]);
    await publish(id);
    return id;
  }
  const aSource = await source("記憶と自分", "資料Aの筆者（架空）");
  const bSource = await source("身体と自分", "資料Bの筆者（架空）");
  async function claim(subject, src, speaker, body) {
    const id = await make("assertion", "claim");
    await client.query(
      "SELECT api.put_assertion($1,$2,'position','資料の限定された箇所の立場')",
      [id, subject],
    );
    await text(id, "body", body);
    const ev = await one(
      "SELECT api.add_evidence($1,$2,'supports','第2節','この立場を説明する箇所')",
      [id, src],
    );
    await client.query(
      "SELECT api.attribute($1,$2,$3,$4,'original_statement','架空資料の筆者の説明',NULL)",
      [id, ev, src, speaker],
    );
    await publish(id);
    return id;
  }
  const aClaim = await claim(
    memory,
    aSource,
    "資料Aの筆者（架空）",
    "過去の経験を覚えていることを、同じ人であると考える理由にする。記憶を失った場合をどう扱うかが課題になる。",
  );
  const bClaim = await claim(
    body,
    bSource,
    "資料Bの筆者（架空）",
    "同じ身体が生き続けていることを、同じ人であると考える理由にする。身体の変化をどこまで同一と考えるかが課題になる。",
  );
  async function relation(subject, basis) {
    const id = await make("assertion", "relationship");
    await client.query(
      "SELECT api.put_assertion($1,$2,'editorial','同じ人と判断する基準を比較するため',$3,'related_to_question',1)",
      [id, subject, question],
    );
    await text(
      id,
      "body",
      "この考え方を、自己の同一性を考える問いへ関連付ける。",
    );
    await client.query(
      "SELECT api.add_editorial_basis($1,$2,'同一性の判断基準として比較する')",
      [id, basis],
    );
    await publish(id);
    return id;
  }
  await relation(memory, aClaim);
  await relation(body, bClaim);
  async function block(body, refs, variant = "summary") {
    const id = await make("block", variant);
    await client.query("SELECT api.put_block($1,$2,'ja')", [id, question]);
    await text(id, "body", body);
    for (const ref of refs)
      await client.query("SELECT api.add_block_reference($1,$2,0,$3)", [
        id,
        ref,
        [...body].length,
      ]);
    await publish(id);
    return id;
  }
  const blocks = [
    await block(
      "記憶を手がかりに考える\n子どもの頃の経験を覚えていることが、今の自分と過去の自分を結ぶ。この見方では、覚えている経験のつながりを重視する。\nただし、忘れた経験や、記憶を失った場合をどう扱うかが残る。",
      [aClaim],
    ),
    await block(
      "身体を手がかりに考える\n見た目や性格が変わっても、同じ身体が生き続けていることを重視する。記憶の有無だけでは同一性を決めない。\nただし、身体の変化をどこまで同一と考えるかを検討する必要がある。",
      [bClaim],
    ),
    await block(
      "比べるときの注意\n二つの見方は、同じ人と判断する際に何を重視するかが違う。記憶のつながりと、身体の継続を区別して読む。\nここでの説明は動作確認用の架空例で、特定の思想家の学説を紹介したものではない。",
      [aClaim, bClaim],
      "comparison",
    ),
  ];
  await client.query(
    "SELECT api.release_page($1,'ja',$2,0,$3,'架空例の組合せを確認')",
    [question, blocks, randomUUID()],
  );
  const info = await one("SELECT api.editor_revision($1)", [question]);
  return {
    questionId: info.revision.object_id,
    questionRevision: question,
    sourceIds: [aSource, bSource],
    assertionIds: [aClaim, bClaim],
    blockIds: blocks,
  };
}
