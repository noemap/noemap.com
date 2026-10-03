import { randomUUID } from "node:crypto";

// Explicitly fictional: approval here is a test fixture, never an editorial workflow.
export async function seedExplorationKnowledge(client, legacy) {
  const one = async (sql, args = []) =>
    Object.values((await client.query(sql, args)).rows[0])[0];
  const text = (id, role, body) =>
    client.query("SELECT api.put_text($1,'ja',$2,$3)", [id, role, body]);
  const make = (kind, variant) =>
    one("SELECT api.create_draft($1,$2,$3)", [
      kind,
      variant,
      "架空の探索動作を確認",
    ]);
  async function publish(id) {
    await client.query("SELECT api.freeze($1)", [id]);
    const review = await one(
      "SELECT api.review($1,ARRAY['ja'],'approved','架空の探索用データ。実資料の内容承認ではない。')",
      [id],
    );
    await client.query("SELECT api.publish($1,$2,0,$3)", [
      id,
      review,
      randomUUID(),
    ]);
  }
  async function entity(title, type, aliases = []) {
    const revision = await make("entity", type);
    await client.query(
      "SELECT api.put_entity($1,'探索動作の検証に限る架空の知識項目')",
      [revision],
    );
    await text(revision, "preferred", title);
    for (const alias of aliases) await text(revision, "alias", alias);
    await publish(revision);
    return revision;
  }
  const root = await entity("人間とは何か？", "question");
  const awarenessQuestion = await entity("意識とは何か？", "question");
  const choiceQuestion = await entity("自由に選べるのか？", "question");
  const happinessQuestion = await entity("幸福とは何か？", "question");
  const awareness = await entity("意識", "concept", [
    "心のはたらき",
    "Consciousness",
  ]);
  const choice = await entity("選択", "concept", ["意思決定"]);
  const personA = await entity("資料Cの筆者（架空）", "person", ["試作の筆者"]);
  const personB = await entity("資料Dの編者（架空）", "person");
  const work = await entity("問いを比べるノート（架空）", "work");
  async function source(title, author, workRevision = null) {
    const revision = await make("source", "edition");
    await client.query("SELECT api.put_source($1,$2,'ja')", [
      revision,
      `${author}『${title}』検証用の架空刊行物。`,
    ]);
    await text(revision, "title", title);
    await client.query(
      "SELECT api.source_metadata($1,'試作版','年代を含む全内容が架空',NULL,$2)",
      [revision, workRevision],
    );
    await client.query("SELECT api.source_credit($1,'author',$2)", [
      revision,
      author,
    ]);
    await publish(revision);
    return revision;
  }
  const sourceC = await source(
    "問いを比べるノート（架空資料C）",
    "資料Cの筆者（架空）",
    work,
  );
  const sourceD = await source(
    "生活についてのノート（架空資料D）",
    "資料Dの編者（架空）",
  );
  async function claim(subject, src, body, speaker = "資料Cの筆者（架空）") {
    const revision = await make("assertion", "claim");
    await client.query(
      "SELECT api.put_assertion($1,$2,'position','架空資料の限定された説明')",
      [revision, subject],
    );
    await text(revision, "body", body);
    const evidence = await one(
      "SELECT api.add_evidence($1,$2,'supports','検証用第1節','探索動作に用いる架空の説明')",
      [revision, src],
    );
    await client.query(
      "SELECT api.attribute($1,$2,$3,$4,'original_statement','検証用の架空資料の説明',NULL)",
      [revision, evidence, src, speaker],
    );
    await publish(revision);
    return revision;
  }
  async function page(subject, basis, heading, body) {
    const revision = await make("block", "summary");
    await client.query("SELECT api.put_block($1,$2,'ja')", [revision, subject]);
    const content = `${heading}\n${body}\n本文・人物・資料は探索の動作を確認するための架空例です。`;
    await text(revision, "body", content);
    await client.query("SELECT api.add_block_reference($1,$2,0,$3)", [
      revision,
      basis,
      [...content].length,
    ]);
    await publish(revision);
    await client.query(
      "SELECT api.release_page($1,'ja',$2,0,$3,'架空の概要と根拠を組み合わせる')",
      [subject, [revision], randomUUID()],
    );
  }
  const specs = [
    [
      root,
      "人間を考える入口",
      "記憶、身体、意識、選択という切り口から、人間についての問いをたどる。問いを選び、考え方や人物の説明を比べられる。",
    ],
    [
      awarenessQuestion,
      "意識を考える",
      "何かを感じる経験と、その経験を自分で説明することを区別して考える。ここでは、意識という概念から自己や選択の問いへ進める。",
    ],
    [
      choiceQuestion,
      "選択を考える",
      "選択肢があることと、自分で選んだと感じることを分けて考える。判断の理由を尋ねることで、意識についての問いにもつながる。",
    ],
    [
      happinessQuestion,
      "幸福を考える",
      "その瞬間の心地よさと、生活全体への満足を比べる。どちらを重視するかによって、幸福という問いの読み方が変わる。",
    ],
    [
      awareness,
      "意識の切り口",
      "感じている経験を言葉にしてみる。架空資料Cでは、経験そのものと、経験を振り返る説明を比べる考え方が示されている。",
    ],
    [
      choice,
      "選択の切り口",
      "いくつかの行動から一つを選ぶ場面を考える。架空資料Cでは、選択肢、判断の理由、結果の受け止め方を順に確かめる。",
    ],
    [
      personA,
      "架空の筆者の説明",
      "意識と選択について、身近な場面を比べながら問いを立てる筆者として設定した。実在の思想家や学説を紹介するページではない。",
    ],
    [
      personB,
      "架空の編者の説明",
      "幸福と自己について、異なる説明を並べて読む編者として設定した。資料を比較して別の問いへ進むための動作例である。",
    ],
    [
      work,
      "架空の著作を読む",
      "意識と幸福の問いを読み比べる試作のノート。著作の知識項目と、根拠に使った刊行版を別に保存する例である。",
    ],
  ];
  const claims = new Map();
  for (const [subject, heading, body] of specs) {
    const src =
      subject === personB || subject === happinessQuestion ? sourceD : sourceC;
    const basis = await claim(
      subject,
      src,
      body,
      src === sourceD ? "資料Dの編者（架空）" : undefined,
    );
    claims.set(subject, basis);
    await page(subject, basis, heading, body);
  }
  const legacyMemory = (
    await one("SELECT api.editor_revision($1)", [legacy.assertionIds[0]])
  ).assertion.subject_revision_id;
  const legacyBody = (
    await one("SELECT api.editor_revision($1)", [legacy.assertionIds[1]])
  ).assertion.subject_revision_id;
  await page(
    legacyMemory,
    legacy.assertionIds[0],
    "記憶から自己を考える",
    "覚えている経験のつながりを、同じ人であると考える手がかりにする。自己の問いから、身体を重視する別の説明とも比べられる。",
  );
  await page(
    legacyBody,
    legacy.assertionIds[1],
    "身体から自己を考える",
    "同じ身体が生き続けていることを、同じ人であると考える手がかりにする。記憶を失った場合にも、身体の継続という切り口を検討する。",
  );
  async function relation(subject, target, basis, reason) {
    const revision = await make("assertion", "relationship");
    await client.query(
      "SELECT api.put_assertion($1,$2,'editorial',$3,$4,'related_to_question',1)",
      [revision, subject, reason, target],
    );
    await text(revision, "body", reason);
    await client.query("SELECT api.add_editorial_basis($1,$2,$3)", [
      revision,
      basis,
      reason,
    ]);
    await publish(revision);
  }
  const edges = [
    [
      root,
      legacy.questionRevision,
      root,
      "記憶と身体の説明を通じて、人間の中の自己という問いを比べる。",
    ],
    [
      awarenessQuestion,
      root,
      awarenessQuestion,
      "経験を感じるという切り口から、人間について考える。",
    ],
    [
      choiceQuestion,
      root,
      choiceQuestion,
      "選ぶことと判断の理由を、人間という問いの入口にする。",
    ],
    [
      happinessQuestion,
      root,
      happinessQuestion,
      "生活をどう受け止めるかを、人間について考える切り口にする。",
    ],
    [
      awareness,
      root,
      awareness,
      "意識という概念の説明から、人間についての問いへ進む。",
    ],
    [
      choice,
      root,
      choice,
      "選択という概念の説明から、人間についての問いへ進む。",
    ],
    [
      awareness,
      awarenessQuestion,
      awareness,
      "感じる経験と言葉による説明を比べるために関連付ける。",
    ],
    [
      awareness,
      legacy.questionRevision,
      awareness,
      "経験を自分のものと感じることを、自己という問いと比べる。",
    ],
    [
      choice,
      choiceQuestion,
      choice,
      "判断の理由を確かめるため、この問いに関連付ける。",
    ],
    [
      personA,
      awarenessQuestion,
      personA,
      "架空の筆者の説明を、意識を考える例として読む。",
    ],
    [
      personA,
      choiceQuestion,
      personA,
      "同じ筆者の説明から、選択についての別の問いへ進む。",
    ],
    [
      personB,
      happinessQuestion,
      personB,
      "架空の編者の比較を、幸福という問いの例として読む。",
    ],
    [
      personB,
      legacy.questionRevision,
      personB,
      "架空の編者の比較を、自己という別の問いから読む。",
    ],
    [
      work,
      awarenessQuestion,
      work,
      "架空の著作の比較例から、意識という問いを考える。",
    ],
    [
      work,
      happinessQuestion,
      work,
      "同じ架空の著作を、幸福という問いから読み比べる。",
    ],
  ];
  for (const [subject, target, basisSubject, reason] of edges)
    await relation(subject, target, claims.get(basisSubject), reason);
  async function date(subject, src, role, label, start, end = null) {
    const revision = await make("assertion", "claim");
    await client.query(
      "SELECT api.put_assertion($1,$2,'fact_report','年代の境界と幅を確認する架空例')",
      [revision, subject],
    );
    await text(
      revision,
      "body",
      `動作確認用の架空年代：${label}。実在の人物や著作の年代ではない。`,
    );
    await client.query(
      "SELECT api.add_evidence($1,$2,'supports','年代の検証用表','この年代は表示の検証用の架空値')",
      [revision, src],
    );
    await client.query(
      "SELECT api.put_temporal($1,$2,$3,$3,'架空資料の紀元前・西暦表記','astronomical_year',$4,$5,$6,$7)",
      [
        revision,
        role,
        label,
        start[0],
        start[1],
        end?.[0] ?? null,
        end?.[1] ?? null,
      ],
    );
    await publish(revision);
    return revision;
  }
  const dateIds = [
    await date(
      personA,
      sourceC,
      "birth",
      "紀元前125〜115年頃（架空）",
      [-124, -114],
    ),
    await date(
      personA,
      sourceC,
      "active",
      "紀元前1年〜西暦10年（架空）",
      [0, 0],
      [10, 10],
    ),
    await date(
      personB,
      sourceD,
      "active",
      "西暦80〜100年（架空）",
      [80, 80],
      [100, 100],
    ),
    await date(work, sourceC, "publication", "西暦110年頃（架空）", [105, 115]),
  ];
  const routes = [
    [root, "what-is-human"],
    [legacy.questionRevision, "what-is-self"],
    [awarenessQuestion, "what-is-consciousness"],
    [choiceQuestion, "can-we-choose"],
    [happinessQuestion, "what-is-happiness"],
    [legacyMemory, "memory-continuity"],
    [legacyBody, "body-continuity"],
    [awareness, "awareness"],
    [choice, "choice"],
    [personA, "fictional-author-a"],
    [personB, "fictional-editor-b"],
    [work, "fictional-comparison-notebook"],
  ];
  const nodeIds = {};
  for (const [revision, slug] of routes) {
    const id = (await one("SELECT api.editor_revision($1)", [revision]))
      .revision.object_id;
    await client.query(
      "SELECT api.set_node_route($1,'ja',$2,'架空の探索用URLを設定')",
      [id, slug],
    );
    nodeIds[slug] = id;
  }
  await client.query(
    "SELECT api.set_home($1,$2,'人間という問いから始める架空の探索例','ja')",
    [
      nodeIds["what-is-human"],
      [
        "what-is-self",
        "what-is-consciousness",
        "can-we-choose",
        "what-is-happiness",
      ].map((slug) => nodeIds[slug]),
    ],
  );
  return {
    ...legacy,
    nodeIds,
    rootId: nodeIds["what-is-human"],
    explorationSources: [sourceC, sourceD],
    dateIds,
  };
}
