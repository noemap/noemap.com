import { connection } from "next/server";
import { notFound } from "next/navigation";
import {
  editor,
  detail,
  listings,
  search,
  errorMessages,
} from "../../../../server/editor";
import {
  kindNames,
  variantNames,
  roleNames,
  type Listing,
} from "../../../../domain/types";
import {
  Operation,
  Reason,
  HumanCheck,
} from "../../../../components/EditorForms";
import { isUuid } from "../../../../server/public";
import {
  TemporalDetails,
  TemporalForm,
} from "../../../../components/editorial/TemporalForm";
export default async function RevisionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    error?: string;
    done?: string;
    references_q?: string;
  }>;
}) {
  await connection();
  const actor = await editor(),
    { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await detail(actor.id, id);
  if (!data) notFound();
  const query = await searchParams,
    r = data.revision,
    primary = data.texts.find(
      (t) =>
        t.language === "ja" && ["preferred", "title", "body"].includes(t.role),
    ),
    items: Listing[] =
      data.revision.kind === "block"
        ? (
            await search(
              actor.id,
              (query.references_q ?? "").slice(0, 200),
              "assertion",
              "frozen",
            )
          ).items
        : await listings(actor.id),
    canEdit = actor.roles.includes("editor"),
    canReview = actor.roles.includes("reviewer"),
    canPublish = actor.roles.includes("publisher");
  const missing = data.references.filter(
    (ref) => !items.some((item) => item.id === ref.assertion_revision_id),
  );
  const pinned = await Promise.all(
    missing.map((ref) => detail(actor.id, ref.assertion_revision_id)),
  );
  for (const item of pinned) {
    if (item)
      items.push({
        ...item.revision,
        generation: item.generation,
        object_state: item.object_state as Listing["object_state"],
        published: false,
        title:
          item.texts
            .find((t) => t.language === "ja" && t.role === "body")
            ?.content.split("\n")[0]
            .slice(0, 100) ?? "既存の根拠",
      });
  }
  return (
    <>
      <a href="/editor">編集一覧へ</a>
      <h1>{primary?.content.split("\n")[0] || "未入力の版"}</h1>
      <p className="editor-meta">
        {kindNames[r.kind]} · {variantNames[r.variant] ?? r.variant} · 第
        {r.revision_no}版 · {r.state === "draft" ? "下書き" : "内容確定済み"}
        {data.object_state === "suspended" ? " · 停止中" : ""}
      </p>
      {query.error && (
        <p className="notice warning">
          {errorMessages[query.error] ?? errorMessages.failed}
        </p>
      )}
      {query.done && <p className="notice">保存しました。</p>}
      <div className="editor-grid">
        <div>
          <section className="panel">
            <h2>内容</h2>
            {r.state === "draft" && r.kind === "block" && canEdit && (
              <details>
                <summary>選べる根拠を検索する</summary>
                <p className="field-note">
                  本文の編集前に検索します。既に選んだ根拠は検索後も表示します。
                </p>
                <form method="get">
                  <label>
                    記述の本文
                    <input
                      name="references_q"
                      defaultValue={query.references_q}
                      maxLength={200}
                    />
                  </label>
                  <button className="secondary">根拠を検索</button>
                </form>
              </details>
            )}
            {r.state === "draft" && canEdit ? (
              <form method="post" action="/editor/action">
                <Operation
                  action="save"
                  revision={id}
                  generation={data.generation}
                />
                <label>
                  名称・本文
                  <textarea
                    name="text"
                    defaultValue={primary?.content}
                    required
                    maxLength={20000}
                    rows={10}
                  />
                </label>
                {data.entity && (
                  <label>
                    何を指す項目か
                    <textarea
                      name="scope"
                      defaultValue={data.entity.identity_scope}
                      required
                      maxLength={2000}
                    />
                  </label>
                )}
                {data.source && (
                  <>
                    <label>
                      書誌情報
                      <textarea
                        name="citation"
                        defaultValue={data.source.citation}
                        required
                        maxLength={3000}
                      />
                    </label>
                    <label>
                      版
                      <input
                        name="edition"
                        defaultValue={data.source_metadata?.edition ?? ""}
                        required
                        maxLength={300}
                      />
                    </label>
                    <label>
                      刊行情報
                      <input
                        name="publication_info"
                        defaultValue={
                          data.source_metadata?.publication_info ?? ""
                        }
                        required
                        maxLength={1000}
                      />
                    </label>
                    <label>
                      資料のURL（任意）
                      <input
                        name="url"
                        defaultValue={data.source_metadata?.url ?? ""}
                        type="url"
                        maxLength={2000}
                      />
                    </label>
                  </>
                )}
                {r.kind === "block" && (
                  <>
                    <p className="field-note">
                      本文全体の根拠を選びます。文章を変えたときは、この一覧も確認してください。
                    </p>
                    {items
                      .filter(
                        (x) => x.kind === "assertion" && x.state === "frozen",
                      )
                      .map((item) => (
                        <label className="check" key={item.id}>
                          <input
                            name="references"
                            type="checkbox"
                            value={item.id}
                            defaultChecked={data.references.some(
                              (ref) => ref.assertion_revision_id === item.id,
                            )}
                          />
                          <span>{item.title}</span>
                        </label>
                      ))}
                  </>
                )}
                <div className="actions">
                  <button>下書きを保存</button>
                </div>
              </form>
            ) : (
              data.texts.map((t) => (
                <div key={t.id}>
                  <p className="field-note">
                    {t.language === "ja" ? "日本語" : t.language}
                  </p>
                  <p className="revision-text">{t.content}</p>
                </div>
              ))
            )}
            {data.entity && (
              <p className="muted">対象：{data.entity.identity_scope}</p>
            )}
            {data.source && (
              <>
                <p>{data.source.citation}</p>
                <p className="muted">
                  {data.source_metadata?.edition} ·{" "}
                  {data.source_metadata?.publication_info}
                </p>
                {data.source_credits.map((c, i) => (
                  <p key={i}>
                    {c.label} ·{" "}
                    {
                      (
                        {
                          author: "著者",
                          editor: "編者",
                          translator: "訳者",
                          publisher: "出版社",
                        } as Record<string, string>
                      )[c.role]
                    }
                  </p>
                ))}
              </>
            )}
          </section>
          {(data.temporal ||
            (canEdit &&
              r.state === "draft" &&
              r.kind === "assertion" &&
              r.variant === "claim" &&
              data.assertion &&
              ["fact_report", "interpretation"].includes(
                data.assertion.nature,
              ))) && (
            <section className="panel">
              <h2>年代</h2>
              {data.temporal ? (
                <TemporalDetails temporal={data.temporal} />
              ) : null}
              {canEdit &&
              r.state === "draft" &&
              r.kind === "assertion" &&
              r.variant === "claim" &&
              data.assertion &&
              ["fact_report", "interpretation"].includes(
                data.assertion.nature,
              ) ? (
                <TemporalForm
                  revision={id}
                  generation={data.generation}
                  temporal={data.temporal}
                />
              ) : null}
            </section>
          )}
          {data.assertion && (
            <section className="panel">
              <h2>根拠と発言者</h2>
              <p>{data.assertion.rationale}</p>
              {data.evidence.map((e) => (
                <div key={e.id}>
                  <a href={`/editor/revisions/${e.source_revision_id}`}>
                    根拠資料 · {e.locator}
                  </a>
                  <p>{e.summary}</p>
                </div>
              ))}
              {data.attributions.map((a, i) => (
                <p key={i}>
                  {a.speaker_label} · {roleNames[a.speaker_role]}
                  <br />
                  {a.context}
                </p>
              ))}
              {data.basis.map((b) => (
                <p key={b.assertion_revision_id}>
                  <a href={`/editor/revisions/${b.assertion_revision_id}`}>
                    編集判断の根拠
                  </a>
                  ：{b.reason}
                </p>
              ))}
            </section>
          )}
          {data.block && (
            <section className="panel">
              <h2>本文が使う記述</h2>
              {data.references.map((ref) => (
                <p key={ref.assertion_revision_id}>
                  <a href={`/editor/revisions/${ref.assertion_revision_id}`}>
                    {items.find((x) => x.id === ref.assertion_revision_id)
                      ?.title ?? "根拠の版を開く"}
                  </a>
                </p>
              ))}
            </section>
          )}
        </div>
        <aside>
          <section className="panel">
            <h2>確定と訂正</h2>
            {r.state === "draft" && canEdit ? (
              <>
                <p className="field-note">
                  根拠が揃った段階で内容を確定します。公開には、その後の確認記録が必要です。
                </p>
                <form method="post" action="/editor/action">
                  <Operation
                    action="freeze"
                    revision={id}
                    generation={data.generation}
                  />
                  <button>この版を確定</button>
                </form>
              </>
            ) : canEdit ? (
              <form method="post" action="/editor/action">
                <Operation
                  action="clone"
                  revision={id}
                  generation={data.generation}
                />
                <Reason label="訂正する理由" />
                <button className="secondary">訂正版の下書きを作る</button>
              </form>
            ) : (
              <p className="field-note">内容の変更は執筆者が行います。</p>
            )}
          </section>
          {r.state === "frozen" && canReview && (
            <section className="panel">
              <h2>内容の確認</h2>
              <form method="post" action="/editor/action">
                <Operation
                  action="review"
                  revision={id}
                  generation={data.generation}
                />
                <label>
                  判断
                  <select name="decision">
                    <option value="approved">確認済み・公開してよい</option>
                    <option value="rejected">修正が必要</option>
                  </select>
                </label>
                <HumanCheck />
                <Reason label="確認した内容・指摘" />
                <button>確認記録を保存</button>
              </form>
            </section>
          )}
          {r.state === "frozen" &&
            canPublish &&
            data.object_state === "active" && (
              <section className="panel">
                <h2>公開</h2>
                <form method="post" action="/editor/action">
                  <Operation
                    action="publish"
                    revision={id}
                    generation={data.generation}
                  />
                  <label>
                    使う確認記録
                    <select name="review" required>
                      <option value="">選択してください</option>
                      {data.reviews
                        .filter(
                          (v) =>
                            v.decision === "approved" &&
                            !v.withdrawn_at &&
                            !v.used,
                        )
                        .map((v) => (
                          <option value={v.id} key={v.id}>
                            {v.reason}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button>この版を公開</button>
                </form>
                {r.kind === "entity" && (
                  <a
                    className="button secondary"
                    href={`/editor/compose/${id}`}
                  >
                    本文を組み合わせる
                  </a>
                )}
              </section>
            )}
          {data.reviews.length > 0 && (
            <section className="panel">
              <h2>確認記録</h2>
              {data.reviews.map((v) => (
                <div className="review-item" key={v.id}>
                  <p>
                    {v.decision === "approved" ? "確認済み" : "修正が必要"} ·{" "}
                    {v.withdrawn_at
                      ? "撤回済み"
                      : v.used
                        ? "公開操作で使用済み"
                        : "未使用"}
                  </p>
                  <p className="field-note">{v.reason}</p>
                  {canReview && !v.withdrawn_at && (
                    <details>
                      <summary>この確認を撤回する</summary>
                      <form method="post" action="/editor/action">
                        <Operation
                          action="withdraw"
                          revision={id}
                          generation={data.generation}
                        />
                        <input type="hidden" name="review" value={v.id} />
                        <Reason />
                        <button className="danger">確認を撤回</button>
                      </form>
                    </details>
                  )}
                </div>
              ))}
            </section>
          )}
          {canPublish && (
            <section className="panel">
              <h2>公開の取り消し・停止</h2>
              <p className="field-note">
                根拠の公開を取り消すと、それに依存する記事も読者向け画面から外れます。
              </p>
              {data.object_state === "active" ? (
                <>
                  <details>
                    <summary>この版の公開を取り消す</summary>
                    <form method="post" action="/editor/action">
                      <Operation
                        action="revoke"
                        revision={id}
                        generation={data.generation}
                      />
                      <Reason />
                      <button className="danger">この版を取り消す</button>
                    </form>
                  </details>
                  <details>
                    <summary>この項目の全ての版を停止する</summary>
                    <form method="post" action="/editor/action">
                      <Operation
                        action="suspend"
                        revision={id}
                        generation={data.generation}
                      />
                      <Reason />
                      <button className="danger">項目を停止</button>
                    </form>
                  </details>
                </>
              ) : (
                <form method="post" action="/editor/action">
                  <Operation
                    action="resume"
                    revision={id}
                    generation={data.generation}
                  />
                  <p className="field-note">
                    停止後に改めて確認した版だけを再開できます。過去の公開許可は復活しません。
                  </p>
                  {data.reviews
                    .filter(
                      (v) =>
                        v.decision === "approved" && !v.withdrawn_at && !v.used,
                    )
                    .map((v) => (
                      <label className="check" key={v.id}>
                        <input type="checkbox" name="reviews" value={v.id} />
                        <span>{v.reason}</span>
                      </label>
                    ))}
                  <Reason />
                  <button>確認した版を再開</button>
                </form>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
