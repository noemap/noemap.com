import { connection } from "next/server";
import { editor, search } from "../../../server/editor";
import { kindNames, type Kind, type Listing } from "../../../domain/types";
import { Reason } from "../../../components/EditorForms";
function Choices({
  name,
  label,
  items,
  optional = false,
}: {
  name: string;
  label: string;
  items: Listing[];
  optional?: boolean;
}) {
  return (
    <label>
      {label}
      <select name={name} required={!optional}>
        <option value="">選択してください</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title} · 第{item.revision_no}版
          </option>
        ))}
      </select>
    </label>
  );
}
export default async function New({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    entity_q?: string;
    source_q?: string;
    assertion_q?: string;
  }>;
}) {
  await connection();
  const actor = await editor();
  if (!actor.roles.includes("editor")) return <p>作成する権限がありません。</p>;
  const query = await searchParams,
    kind = (
      query.kind && Object.hasOwn(kindNames, query.kind) ? query.kind : "entity"
    ) as Kind;
  const candidateKinds =
    kind === "assertion"
      ? ["entity", "source", "assertion"]
      : kind === "block"
        ? ["entity", "assertion"]
        : [];
  const candidateQueries: Record<string, string> = {
    entity: (query.entity_q ?? "").slice(0, 200),
    source: (query.source_q ?? "").slice(0, 200),
    assertion: (query.assertion_q ?? "").slice(0, 200),
  };
  const candidateResults = await Promise.all(
    candidateKinds.map((k) =>
      search(actor.id, candidateQueries[k], k, "frozen"),
    ),
  );
  const items = candidateResults
    .flatMap((r) => r.items)
    .filter((x) => x.object_state === "active");
  return (
    <div className="panel evidence-page">
      <a href="/editor">編集一覧へ</a>
      <h1>{kindNames[kind]}を追加</h1>
      {candidateKinds.length > 0 && (
        <details className="candidate-search">
          <summary>根拠・掲載先の候補を検索する</summary>
          <p className="field-note">
            本文を書く前に候補を絞ります。各種類の直近100版から選べます。見つからない場合は、名称・本文の一部で検索してください。
          </p>
          <form method="get" action="/editor/new">
            <input type="hidden" name="kind" value={kind} />
            {candidateKinds.map((k) => (
              <label key={k}>
                {kindNames[k as Kind]}を検索
                <input
                  name={`${k}_q`}
                  maxLength={200}
                  defaultValue={candidateQueries[k]}
                />
              </label>
            ))}
            <button className="secondary">候補を検索</button>
          </form>
        </details>
      )}
      <form method="post" action="/editor/action">
        <input type="hidden" name="action" value="create" />
        <input type="hidden" name="kind" value={kind} />
        {kind === "entity" ? (
          <>
            <label>
              種類
              <select name="variant">
                <option value="question">問い</option>
                <option value="concept">概念</option>
                <option value="person">人物</option>
                <option value="work">著作</option>
              </select>
            </label>
            <label>
              名称
              <input name="text" required maxLength={200} />
            </label>
            <label>
              何を指す項目か
              <textarea name="scope" required maxLength={2000} />
            </label>
          </>
        ) : kind === "source" ? (
          <>
            <label>
              資料名
              <input name="text" required maxLength={300} />
            </label>
            <label>
              書誌情報
              <textarea name="citation" required maxLength={3000} />
            </label>
            <label>
              版<input name="edition" required maxLength={300} />
            </label>
            <label>
              刊行情報
              <input name="publication_info" required maxLength={1000} />
            </label>
            <label>
              資料のURL（任意）
              <input name="url" type="url" maxLength={2000} />
            </label>
            <label>
              著者・編者の表記
              <input name="credit" required maxLength={300} />
            </label>
            <label>
              役割
              <select name="credit_role">
                <option value="author">著者</option>
                <option value="editor">編者</option>
                <option value="translator">訳者</option>
                <option value="publisher">出版社</option>
              </select>
            </label>
          </>
        ) : kind === "assertion" ? (
          <>
            <Choices
              name="subject"
              label="何についての記述か"
              items={items.filter((x) => x.kind === "entity")}
            />
            <label>
              扱い
              <select name="nature">
                <option value="position">資料で述べられた立場</option>
                <option value="fact_report">事実についての記述</option>
                <option value="interpretation">解釈</option>
                <option value="editorial">編集上の判断</option>
              </select>
            </label>
            <label>
              記述
              <textarea name="text" required maxLength={20000} />
            </label>
            <Choices
              name="source"
              label="根拠資料（編集上の判断では省略可）"
              optional
              items={items.filter((x) => x.kind === "source")}
            />
            <label>
              資料の箇所
              <input name="locator" maxLength={1000} />
            </label>
            <label>
              その箇所が支える内容
              <textarea name="summary" maxLength={3000} />
            </label>
            <label>
              発言者の表記
              <input name="speaker" maxLength={300} />
            </label>
            <label>
              発言者の役割
              <select name="speaker_role">
                <option value="original_statement">本人の説明</option>
                <option value="quoted_person">引用された人</option>
                <option value="reported_position">他説の紹介</option>
                <option value="editor_note">編者の注記</option>
                <option value="hypothesis">仮定</option>
              </select>
            </label>
            <label>
              発言の文脈
              <textarea name="context" maxLength={2000} />
            </label>
            <Choices
              name="basis"
              label="編集判断の根拠となる記述（任意）"
              optional
              items={items.filter((x) => x.kind === "assertion")}
            />
            <label>
              根拠の使い方
              <textarea name="rationale" required maxLength={2000} />
            </label>
          </>
        ) : (
          <>
            <label>
              本文の種類
              <select name="variant">
                <option value="summary">説明</option>
                <option value="comparison">比較</option>
              </select>
            </label>
            <Choices
              name="entity"
              label="掲載先の項目"
              items={items.filter((x) => x.kind === "entity")}
            />
            <label>
              本文
              <textarea name="text" required maxLength={20000} />
            </label>
            <p className="field-note">
              1行目を見出し、次の行から説明を書きます。下の記述を本文全体の根拠として指定します。
            </p>
            <label>本文の根拠</label>
            {items
              .filter((x) => x.kind === "assertion")
              .map((item) => (
                <label className="check" key={item.id}>
                  <input type="checkbox" name="references" value={item.id} />
                  <span>{item.title}</span>
                </label>
              ))}
          </>
        )}
        <Reason label="作成理由" />
        <div className="actions">
          <button>下書きを作成</button>
        </div>
      </form>
    </div>
  );
}
