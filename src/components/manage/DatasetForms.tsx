import { randomUUID } from "node:crypto";
import {
  MutationForm,
  type ManageField,
  type FormOption,
} from "./MutationForm";
import type { ProvisionalReleaseInput } from "../../domain/provisional";

export type EditableBatch = ProvisionalReleaseInput["batches"][number];
type Node = EditableBatch["node_candidates"][number];
type Claim = EditableBatch["assertion_candidates"][number];
type Source = EditableBatch["sources"][number];
type Relation = EditableBatch["relationship_candidates"][number];
export const typeNames: Record<string, string> = {
  question: "問い",
  person: "人物",
  concept: "概念",
  work: "著作",
};
export function batchTitle(batch: EditableBatch) {
  return (
    batch.node_candidates.find((n) => n.type === "person")?.label ??
    "資料のまとまり"
  );
}
function claimOptions(batch: EditableBatch): FormOption[] {
  return batch.assertion_candidates.map((claim) => ({
    value: claim.id,
    label: claim.text_ja,
  }));
}
function nodeOptions(batch: EditableBatch): FormOption[] {
  return batch.node_candidates.map((node) => ({
    value: node.id,
    label: `${typeNames[node.type] ?? "項目"} · ${node.label}`,
  }));
}
function sourceOptions(
  batch: EditableBatch,
  withdrawn: string[],
): FormOption[] {
  return batch.sources.map((source) => ({
    value: source.id,
    label: `${withdrawn.includes(source.id) ? "撤回中 · " : ""}${source.title}`,
  }));
}
export function NodeForm({
  batch,
  generation,
  node,
  withdrawn,
}: {
  batch: EditableBatch;
  generation: number;
  node?: Node;
  withdrawn: string[];
}) {
  const fields: ManageField[] = [
    {
      name: "type",
      label: "項目の種類",
      kind: node ? "hidden" : "select",
      value: node?.type ?? "concept",
      required: true,
      options: Object.entries(typeNames).map(([value, label]) => ({
        value,
        label,
      })),
    },
    {
      name: "label",
      label: "名称・問い",
      value: node?.label ?? "",
      required: true,
      maxLength: 200,
    },
    {
      name: "summary_ja",
      label: "短い日本語の要約",
      kind: "textarea",
      value: node?.summary_ja ?? "",
      required: true,
      note: "原文や既存日本語訳の転載ではなく、資料に基づく短い言い換えを入力します。",
    },
    {
      name: "aliases",
      label: "別名・検索で使う名称",
      kind: "textarea",
      value: (node?.aliases ?? []).join("\n"),
      note: "1行に1つ。別の思想家の概念を同一の項目へ統合しません。",
    },
    {
      name: "definition_scope",
      label: "この概念を扱う文脈",
      kind: "textarea",
      value: node?.definition_scope ?? "",
      required: true,
      when: { field: "type", value: "concept" },
      note: "著者・著作・該当箇所と、ここでの語の意味を記します。",
    },
    {
      name: "scope_limit",
      label: "読み取る範囲・留保",
      kind: "textarea",
      value: node?.scope_limit ?? "",
      note: "この要約から推論できないことや、未照合の点を残します。",
    },
    {
      name: "basis",
      label: "問いの入口を支える記述",
      kind: "choices",
      value: node?.basis ?? [],
      options: claimOptions(batch),
      required: true,
      when: { field: "type", value: "question" },
      note: "問いはNOEMAPの編集上の入口として扱います。本人の発言として表示しません。",
    },
  ];
  return (
    <MutationForm
      generation={generation}
      operationId={randomUUID()}
      operation={node ? "update-node" : "add-node"}
      batch={batch.batch_id}
      target={node?.id}
      fields={fields}
      evidence={{
        values: node?.evidence ?? [],
        options: sourceOptions(batch, withdrawn),
        exceptQuestion: true,
      }}
    />
  );
}
export function ClaimForm({
  batch,
  generation,
  claim,
  subject,
  withdrawn,
}: {
  batch: EditableBatch;
  generation: number;
  claim?: Claim;
  subject?: string;
  withdrawn: string[];
}) {
  const fields: ManageField[] = [
    {
      name: "subject",
      label: "この記述を載せる項目",
      kind: "select",
      value: claim?.subject ?? subject ?? "",
      required: true,
      options: nodeOptions(batch),
    },
    {
      name: "nature",
      label: "記述の種類",
      kind: "select",
      value: claim?.nature ?? "position",
      required: true,
      options: [
        { value: "position", label: "著者の考え方" },
        { value: "fact_report", label: "資料による事実の報告" },
        { value: "interpretation", label: "解釈" },
        { value: "editorial", label: "編集上の説明" },
      ],
    },
    {
      name: "text_ja",
      label: "記述の本文",
      kind: "textarea",
      value: claim?.text_ja ?? "",
      maxLength: 3000,
      required: true,
      note: "1つの確認できる内容に絞った、日本語の短い要約を入力します。",
    },
    {
      name: "attribution",
      label: "誰の説明・考え方か",
      value: claim?.attribution ?? "",
      required: true,
      note: "著者本人、オンライン版の編者、NOEMAPの解釈などを区別します。",
    },
    {
      name: "limit",
      label: "読み取る範囲・留保",
      kind: "textarea",
      value: claim?.limit ?? "",
      required: true,
    },
  ];
  return (
    <MutationForm
      generation={generation}
      operationId={randomUUID()}
      operation="update-claim"
      batch={batch.batch_id}
      target={claim?.id}
      fields={fields}
      evidence={{
        values: claim?.evidence ?? [],
        options: sourceOptions(batch, withdrawn),
      }}
    />
  );
}
export function RelationshipForm({
  batch,
  generation,
  relation,
  target,
}: {
  batch: EditableBatch;
  generation: number;
  relation?: Relation;
  target?: string;
}) {
  const options = nodeOptions(batch);
  return (
    <MutationForm
      generation={generation}
      operationId={randomUUID()}
      operation="update-relationship"
      batch={batch.batch_id}
      target={target}
      fields={[
        {
          name: "from",
          label: "関連元の項目",
          kind: "select",
          value: relation?.from ?? "",
          required: true,
          options,
        },
        {
          name: "to",
          label: "関連先の項目",
          kind: "select",
          value: relation?.to ?? "",
          required: true,
          options,
        },
        {
          name: "relation_reason",
          label: "この2項目を関連付ける理由",
          kind: "textarea",
          value: relation?.reason ?? "",
          required: true,
          note: "探索のための編集上の関連です。歴史的な影響関係や、概念の同一性を意味する表現を避けます。",
        },
        {
          name: "basis",
          label: "関連付けの根拠となる記述",
          kind: "choices",
          value: relation?.basis ?? [],
          required: true,
          options: claimOptions(batch),
        },
      ]}
    />
  );
}
export function SourceForm({
  batch,
  generation,
  source,
}: {
  batch: EditableBatch;
  generation: number;
  source: Source;
}) {
  return (
    <MutationForm
      generation={generation}
      operationId={randomUUID()}
      operation="update-source"
      batch={batch.batch_id}
      target={source.id}
      fields={[
        {
          name: "title",
          label: "資料の名称",
          value: source.title,
          required: true,
        },
        {
          name: "author",
          label: "著者・編者の表示",
          value: source.author ?? "",
        },
        { name: "host", label: "掲載元の名称", value: source.host ?? "" },
        {
          name: "edition",
          label: "今回参照する版・翻訳・オンライン表示",
          kind: "textarea",
          value: source.edition,
          required: true,
          note: "原著の刊行情報と、今回観察したオンライン版・翻訳の情報を区別します。元の書誌情報と利用条件は保存します。",
        },
        {
          name: "url",
          label: "資料の掲載元URL",
          value: source.url,
          required: true,
          maxLength: 2000,
          note: "https:// から始まる、該当資料のURLを入力します。",
        },
      ]}
    />
  );
}
export function SourceWithdrawalForm({
  batch,
  generation,
  source,
}: {
  batch: EditableBatch;
  generation: number;
  source: Source;
}) {
  return (
    <MutationForm
      generation={generation}
      operationId={randomUUID()}
      operation="withdraw-source"
      batch={batch.batch_id}
      target={source.id}
      submitLabel="撤回の下書きを保存"
      fields={[
        {
          name: "confirm",
          label:
            "この資料に依存する項目・記述・関連・年代が公開から外れ、履歴の復元後も撤回を維持することを確認しました。",
          kind: "checkbox",
          value: "",
          required: true,
        },
      ]}
    />
  );
}
