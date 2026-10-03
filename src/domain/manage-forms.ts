import { randomUUID } from "node:crypto";
import { validateEditableDocument } from "./editable.ts";
import type { ProvisionalReleaseInput } from "./provisional";

export class ManageInputError extends Error {}
function field(form: FormData, key: string, max = 1000, required = true) {
  const value = form.get(key);
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new ManageInputError(
      "必要な項目を入力し、文字数を確認してください。",
    );
  return value.trim();
}
function list(form: FormData, key: string) {
  const values = form.getAll(key);
  if (
    values.length > 200 ||
    values.some((v) => typeof v !== "string" || v.length > 200)
  )
    throw new ManageInputError("選択した項目を確認してください。");
  return [...new Set(values as string[])];
}
function evidence(form: FormData) {
  const raw = field(form, "evidence", 30000);
  let values: unknown;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new ManageInputError("資料と該当箇所を確認してください。");
  }
  if (!Array.isArray(values) || !values.length || values.length > 30)
    throw new ManageInputError("根拠となる資料を1件以上選んでください。");
  return values.map((v) => {
    if (
      !v ||
      typeof v !== "object" ||
      typeof v.source !== "string" ||
      typeof v.locator !== "string" ||
      !v.source.trim() ||
      !v.locator.trim() ||
      v.source.length > 200 ||
      v.locator.length > 1000 ||
      !["support", "qualification", "counter"].includes(v.role)
    )
      throw new ManageInputError(
        "資料、該当箇所、根拠の役割を入力してください。",
      );
    return {
      source: v.source,
      locator: v.locator.trim(),
      role: String(v.role),
    };
  });
}

export function applyManageForm(
  input: ProvisionalReleaseInput,
  form: FormData,
) {
  const document = structuredClone(input);
  const operation = field(form, "operation", 40);
  const target = field(form, "target", 200, false);
  const batchId = field(form, "batch", 200);
  const batch = document.batches.find((item) => item.batch_id === batchId);
  if (!batch)
    throw new ManageInputError("編集する資料のまとまりが見つかりません。");
  const prefix = batch.node_candidates[0]?.id.split("-")[0] ?? "noemap";
  let returnTo = "/manage";
  if (operation === "update-node" || operation === "add-node") {
    const prior =
      operation === "update-node"
        ? batch.node_candidates.find((n) => n.id === target)
        : undefined;
    if (operation === "update-node" && !prior)
      throw new ManageInputError("編集する項目が見つかりません。");
    const type = prior?.type ?? field(form, "type", 20);
    if (!["question", "person", "concept", "work"].includes(type))
      throw new ManageInputError("項目の種類を確認してください。");
    const id = prior?.id ?? `${prefix}-n-${randomUUID()}`;
    const node = {
      ...prior,
      id,
      type,
      nature:
        prior?.nature ??
        (type === "question"
          ? "editorial"
          : type === "concept"
            ? "position"
            : "factual"),
      label: field(form, "label", 200),
      summary_ja: field(form, "summary_ja", 2000),
      aliases: [
        ...new Set(
          field(form, "aliases", 2000, false)
            .split(/\r?\n/)
            .map((v) => v.trim())
            .filter(Boolean),
        ),
      ],
      scope_limit: field(form, "scope_limit", 2000, false),
      ...(type === "concept"
        ? { definition_scope: field(form, "definition_scope", 2000) }
        : {}),
      ...(type === "question"
        ? { basis: list(form, "basis") }
        : { evidence: evidence(form) }),
    };
    if (type === "question" && !node.basis?.length)
      throw new ManageInputError("問いの根拠となる記述を選んでください。");
    if (prior) Object.assign(prior, node);
    else batch.node_candidates.push(node);
    returnTo = `/manage/nodes/${encodeURIComponent(id)}`;
  } else if (operation === "update-claim") {
    const prior = target
      ? batch.assertion_candidates.find((a) => a.id === target)
      : undefined;
    if (target && !prior)
      throw new ManageInputError("編集する記述が見つかりません。");
    const nature = field(form, "nature", 30);
    if (
      !["position", "fact_report", "interpretation", "editorial"].includes(
        nature,
      )
    )
      throw new ManageInputError("記述の種類を確認してください。");
    const claim = {
      ...prior,
      id: prior?.id ?? `${prefix}-a-${randomUUID()}`,
      kind: "claim",
      subject: field(form, "subject", 200),
      nature,
      text_ja: field(form, "text_ja", 3000),
      attribution: field(form, "attribution", 1000),
      limit: field(form, "limit", 2000),
      evidence: evidence(form),
    };
    if (prior) Object.assign(prior, claim);
    else batch.assertion_candidates.push(claim);
    returnTo = `/manage/claims/${encodeURIComponent(claim.id)}`;
  } else if (operation === "update-source") {
    const source = batch.sources.find((s) => s.id === target);
    if (!source) throw new ManageInputError("編集する資料が見つかりません。");
    Object.assign(source, {
      title: field(form, "title", 1000),
      edition: field(form, "edition", 2000),
      url: field(form, "url", 2000),
      author: field(form, "author", 1000, false),
      host: field(form, "host", 1000, false),
    });
    returnTo = `/manage/sources/${encodeURIComponent(source.id)}`;
  } else if (operation === "withdraw-source") {
    if (!batch.sources.some((s) => s.id === target))
      throw new ManageInputError("資料が見つかりません。");
    if (form.get("restore") === "1")
      throw new ManageInputError(
        "撤回した資料は復元できません。訂正した資料は新しい資料として登録します。",
      );
    document.withdrawn.sources = [
      ...new Set([...document.withdrawn.sources, target]),
    ];
    returnTo = "/manage/sources";
  } else if (operation === "update-relationship") {
    const index = target
      ? batch.relationship_candidates.findIndex(
          (r, i) => (r.id ?? `${batch.batch_id}:relation:${i}`) === target,
        )
      : -1;
    if (target && index < 0)
      throw new ManageInputError("編集する関連が見つかりません。");
    const prior = index >= 0 ? batch.relationship_candidates[index] : undefined;
    const relation = {
      ...prior,
      ...(prior ? {} : { id: `${prefix}-r-${randomUUID()}` }),
      from: field(form, "from", 200),
      to: field(form, "to", 200),
      nature: "editorial",
      reason: field(form, "relation_reason", 2000),
      basis: list(form, "basis"),
    };
    if (!relation.basis.length)
      throw new ManageInputError("関連付けの根拠となる記述を選んでください。");
    if (prior) Object.assign(prior, relation);
    else batch.relationship_candidates.push(relation);
    const id = relation.id ?? `${batch.batch_id}:relation:${index}`;
    returnTo = `/manage/relationships/${encodeURIComponent(id)}`;
  } else throw new ManageInputError("この編集操作は利用できません。");
  try {
    validateEditableDocument(document);
  } catch (error) {
    // This validator is the domain boundary and supplies safe Japanese messages.
    throw new ManageInputError(
      error instanceof Error
        ? error.message.slice(0, 1000)
        : "入力した内容を確認してください。",
    );
  }
  return { document, returnTo };
}
