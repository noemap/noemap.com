import {
  createProvisionalRelease,
  type ProvisionalReleaseInput,
} from "./provisional.ts";
import { projectPublicDocument } from "./public-projection.ts";

const forbiddenText =
  /^(fulltext|rawtext|sourcetext|originaltext|documenttext|documentbody|rawhtml|rawmarkdown|pdftext)|^(transcript|quotedtext|excerpts?)$/;

// Validation applies to editor saves, imports and restores. A database update
// cannot turn a source check into a fabricated human approval.
export function validateEditableDocument(
  document: unknown,
): asserts document is ProvisionalReleaseInput {
  if (!document || typeof document !== "object" || Array.isArray(document))
    throw new Error("保存する内容の形式が正しくありません。");
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized, "utf8") > 2_000_000)
    throw new Error(
      "保存できる容量を超えています。資料は短い要約と出典で登録してください。",
    );
  function inspect(value: unknown, depth = 0) {
    if (depth > 24) throw new Error("内容の構造が深すぎます。");
    if (typeof value === "string" && value.length > 6000)
      throw new Error(
        "長い本文は保存できません。短い要約と出典を登録してください。",
      );
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value) && value.length > 10000)
      throw new Error("一度に保存できる項目数を超えています。");
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replaceAll(/[-_]/g, "").toLowerCase();
      if (
        normalized !== "fulltextpublication" &&
        forbiddenText.test(normalized)
      )
        throw new Error(
          "資料の全文や抜粋の保存はできません。要約と出典を登録してください。",
        );
      if (normalized === "storedfulltext" && child !== false)
        throw new Error("資料の全文は保存できません。");
      inspect(child, depth + 1);
    }
  }
  inspect(document);
  const candidate = document as ProvisionalReleaseInput;
  if (
    typeof candidate.release_id !== "string" ||
    candidate.release_id.length > 120
  )
    throw new Error("版の識別子が正しくありません。");
  const ids: Record<string, Set<string>> = {
    sources: new Set(),
    nodes: new Set(),
    assertions: new Set(),
    relationships: new Set(),
  };
  if (!Array.isArray(candidate.batches))
    throw new Error("項目の一覧が必要です。");
  const batchIds = new Set<string>();
  const edges = new Set<string>();
  for (const batch of candidate.batches) {
    if (
      !batch ||
      !Array.isArray(batch.sources) ||
      !Array.isArray(batch.node_candidates) ||
      !Array.isArray(batch.assertion_candidates) ||
      !Array.isArray(batch.relationship_candidates)
    )
      throw new Error("項目の一覧の形式が正しくありません。");
    if (
      typeof batch.batch_id !== "string" ||
      !batch.batch_id.trim() ||
      batchIds.has(batch.batch_id)
    )
      throw new Error("項目グループの識別子が重複しています。");
    batchIds.add(batch.batch_id);
    for (const source of batch.sources) ids.sources.add(source.id);
    for (const node of batch.node_candidates) ids.nodes.add(node.id);
    for (const assertion of batch.assertion_candidates)
      ids.assertions.add(assertion.id);
    for (const [index, relation] of batch.relationship_candidates.entries()) {
      const pair = `${relation.from}->${relation.to}`;
      if (edges.has(pair))
        throw new Error("同じ項目の組み合わせに関係が重複しています。");
      edges.add(pair);
      ids.relationships.add(
        relation.id ?? `${batch.batch_id}:relation:${index}`,
      );
      ids.relationships.add(`${relation.from}->${relation.to}`);
    }
  }
  for (const temporal of candidate.temporal_records ?? [])
    ids.assertions.add(temporal.id);
  const objectIds = new Set([...ids.sources, ...ids.nodes, ...ids.assertions]);
  for (const batch of candidate.batches)
    for (const [index, relation] of batch.relationship_candidates.entries()) {
      const key = relation.id ?? `${batch.batch_id}:relation:${index}`;
      if (objectIds.has(key))
        throw new Error("関係の識別子が別の項目と重複しています。");
      objectIds.add(key);
    }
  for (const [category, known] of Object.entries(ids)) {
    const withdrawn =
      candidate.withdrawn?.[
        category as keyof ProvisionalReleaseInput["withdrawn"]
      ];
    if (
      !Array.isArray(withdrawn) ||
      withdrawn.some(
        (id) => typeof id !== "string" || !id.trim() || id.length > 160,
      )
    )
      throw new Error("撤回する項目の識別子が正しくありません。");
    if (new Set(withdrawn).size !== withdrawn.length)
      throw new Error("撤回する項目が重複しています。");
  }
  try {
    projectPublicDocument(candidate);
  } catch {
    throw new Error(
      "出典・根拠・項目の参照、または未審査の表示が正しくありません。",
    );
  }
}

export function preserveWithdrawals(
  target: ProvisionalReleaseInput,
  current: ProvisionalReleaseInput,
): ProvisionalReleaseInput {
  const restored = structuredClone(target);
  const targetWithdrawals =
    createProvisionalRelease(target).normalizedWithdrawals();
  const currentWithdrawals =
    createProvisionalRelease(current).normalizedWithdrawals();
  for (const category of [
    "sources",
    "nodes",
    "assertions",
    "relationships",
  ] as const)
    restored.withdrawn[category] = [
      ...new Set([
        ...targetWithdrawals[category],
        ...currentWithdrawals[category],
      ]),
    ];
  // Unknown IDs remain as tombstones when restoring a version predating an
  // object. They take effect if that stable ID is reintroduced later.
  return restored;
}
