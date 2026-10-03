import { connection } from "next/server";
import { editor, search, errorMessages } from "../../server/editor";
import { kindNames, variantNames } from "../../domain/types";
export default async function Editor({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    done?: string;
    q?: string;
    kind?: string;
    page?: string;
  }>;
}) {
  await connection();
  const actor = await editor(),
    query = await searchParams,
    q = (query.q ?? "").slice(0, 200),
    kind =
      query.kind && Object.hasOwn(kindNames, query.kind) ? query.kind : null,
    page = /^\d{1,4}$/.test(query.page ?? "")
      ? Math.max(1, Number(query.page))
      : 1,
    result = await search(actor.id, q, kind, null, (page - 1) * 100);
  const pageUrl = (n: number) =>
    `/editor?${new URLSearchParams({ q, kind: kind ?? "", page: String(n) })}`;
  return (
    <>
      <div className="editor-head">
        <h1>記事と根拠を整理する</h1>
        <form method="post" action="/editor/auth">
          <input type="hidden" name="action" value="logout" />
          <button className="secondary">{actor.label} · 退出</button>
        </form>
      </div>
      <p className="muted">
        資料 → 記述 → 本文の順に作成し、内容を確認してから公開します。
      </p>
      {query.error && (
        <p className="notice warning">
          {errorMessages[query.error] ?? errorMessages.failed}
        </p>
      )}
      {query.done && <p className="notice">保存しました。</p>}
      {actor.roles.includes("editor") && (
        <div className="actions">
          {Object.entries(kindNames).map(([k, name]) => (
            <a
              className="button secondary"
              key={k}
              href={`/editor/new?kind=${k}`}
            >
              {name}を追加
            </a>
          ))}
        </div>
      )}
      <div className="panel">
        <h2>項目と版</h2>
        <form method="get" action="/editor" className="search-fields">
          <label>
            名称・本文を検索
            <input name="q" defaultValue={q} maxLength={200} />
          </label>
          <label>
            種類
            <select name="kind" defaultValue={kind ?? ""}>
              <option value="">全て</option>
              {Object.entries(kindNames).map(([k, name]) => (
                <option value={k} key={k}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button>検索</button>
        </form>
        <p className="field-note">
          {result.total}版 · 新しい順に100版ずつ表示します。
        </p>
        {result.items.map((item) => (
          <div className="list-row" key={item.id}>
            <div>
              <a href={`/editor/revisions/${item.id}`}>
                {item.title || "名称・本文が未入力"}
              </a>
              <div className="editor-meta">
                {kindNames[item.kind]} ·{" "}
                {variantNames[item.variant] ?? item.variant} · 第
                {item.revision_no}版
              </div>
            </div>
            <div>
              <span className="status">
                {item.state === "draft"
                  ? "下書き"
                  : item.published
                    ? "公開中"
                    : "確認・公開待ち"}
              </span>
              {item.object_state === "suspended" && (
                <span className="status stopped">停止中</span>
              )}
            </div>
          </div>
        ))}
        {!result.items.length && <p>該当する項目がありません。</p>}
        <div className="actions">
          {page > 1 && (
            <a className="button secondary" href={pageUrl(page - 1)}>
              前の100版
            </a>
          )}
          {page * 100 < result.total && (
            <a className="button secondary" href={pageUrl(page + 1)}>
              次の100版
            </a>
          )}
        </div>
      </div>
    </>
  );
}
