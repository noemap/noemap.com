import { notFound } from "next/navigation";
import { readEditor, workingDocument } from "../../../../../server/manage";
import {
  NodeForm,
  batchTitle,
} from "../../../../../components/manage/DatasetForms";
export default async function NodeEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ batch?: string; saved?: string }>;
}) {
  const state = await readEditor();
  const document = workingDocument(state);
  const { id } = await params;
  const query = await searchParams;
  const batch =
    id === "new"
      ? (document.batches.find((b) => b.batch_id === query.batch) ??
        document.batches[0])
      : document.batches.find((b) =>
          b.node_candidates.some((n) => n.id === id),
        );
  if (!batch) notFound();
  const node =
    id === "new" ? undefined : batch.node_candidates.find((n) => n.id === id);
  if (id !== "new" && !node) notFound();
  const claims = batch.assertion_candidates.filter((a) => a.subject === id);
  return (
    <>
      <a href="/manage">← 項目一覧</a>
      <h1>{node ? `${node.label}を編集` : "項目を追加"}</h1>
      <p className="muted">
        {batchTitle(batch)}
        の資料を扱います。保存後に公開へ反映するまでは公開ページに出ません。
      </p>
      {query.saved ? (
        <p className="notice" role="status">
          下書きへ保存しました。
        </p>
      ) : null}
      <section className="panel">
        <NodeForm
          key={state.generation}
          batch={batch}
          generation={state.generation}
          node={node}
          withdrawn={document.withdrawn.sources}
        />
      </section>
      {node ? (
        <section className="panel">
          <div className="exploration-section-heading">
            <h2>この項目の記述と根拠</h2>
            <a href={`/manage/claims/new?subject=${encodeURIComponent(id)}`}>
              記述を追加 →
            </a>
          </div>
          {claims.map((claim) => (
            <div className="list-row" key={claim.id}>
              <div>
                <a href={`/manage/claims/${encodeURIComponent(claim.id)}`}>
                  {claim.text_ja}
                </a>
                <p className="editor-meta">
                  帰属：{claim.attribution}
                  <br />
                  留保：{claim.limit}
                </p>
              </div>
            </div>
          ))}
          {!claims.length ? (
            <p>この項目に属する記述はまだありません。</p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
