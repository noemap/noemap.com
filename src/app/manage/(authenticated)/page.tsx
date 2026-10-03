import { randomUUID } from "node:crypto";
import { readEditor, workingDocument } from "../../../server/manage";
import { MutationForm } from "../../../components/manage/MutationForm";
import { batchTitle, typeNames } from "../../../components/manage/DatasetForms";
export default async function Manage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; saved?: string }>;
}) {
  const state = await readEditor();
  const document = workingDocument(state);
  const query = await searchParams;
  const q = (query.q ?? "").trim().slice(0, 200);
  return (
    <>
      <h1>公開する内容を編集する</h1>
      {query.saved ? (
        <p className="notice" role="status">
          操作を保存しました。現在の公開版と下書きの状態を確認してください。
        </p>
      ) : null}
      <section className="panel manage-release-state">
        <h2>現在の公開版と下書き</h2>
        <p>
          公開中：{state.current.reason || "初期公開版"}{" "}
          <span className="editor-meta">{state.current.actor_label}</span>
        </p>
        {state.draft ? (
          <>
            <p>
              <span className="status">未公開の下書きあり</span>{" "}
              {state.draft.reason}
            </p>
            <p>
              以下の編集はこの下書きへ保存します。人による確認は準備中のまま公開へ反映します。
            </p>
            <details>
              <summary>下書きを公開へ反映する</summary>
              <MutationForm
                generation={state.generation}
                operationId={randomUUID()}
                operation="publish"
                submitLabel="下書きを公開へ反映"
                fields={[
                  {
                    name: "confirm",
                    label:
                      "下書きの内容と出典・留保を確認しました。人による審査が完了した表示にはしません。",
                    kind: "checkbox",
                    value: "",
                    required: true,
                  },
                ]}
              />
            </details>
          </>
        ) : (
          <p>
            未公開の下書きはありません。最初の編集を保存すると下書きを作成します。
          </p>
        )}
        <a href="/manage/history">保存した版と復元を見る →</a>
      </section>
      <form method="get" className="search-fields">
        <label>
          編集する項目を検索
          <input name="q" defaultValue={q} maxLength={200} />
        </label>
        <button>検索</button>
      </form>
      {document.batches.map((batch) => {
        const nodes = batch.node_candidates.filter(
          (node) =>
            !q ||
            [node.label, ...(node.aliases ?? [])].some((value) =>
              value
                .normalize("NFKC")
                .toLowerCase()
                .includes(q.normalize("NFKC").toLowerCase()),
            ),
        );
        return (
          <section className="panel" key={batch.batch_id}>
            <div className="exploration-section-heading">
              <h2>{batchTitle(batch)}の資料を扱う項目</h2>
              <a
                href={`/manage/nodes/new?batch=${encodeURIComponent(batch.batch_id)}`}
              >
                項目を追加 →
              </a>
            </div>
            {nodes.map((node) => (
              <div className="list-row" key={node.id}>
                <div>
                  <a href={`/manage/nodes/${encodeURIComponent(node.id)}`}>
                    {node.label}
                  </a>
                  <p className="editor-meta">
                    {typeNames[node.type]} · {node.summary_ja}
                  </p>
                </div>
                {document.withdrawn.nodes.includes(node.id) ? (
                  <span className="status stopped">撤回中</span>
                ) : null}
              </div>
            ))}
            {!nodes.length ? <p>該当する項目はありません。</p> : null}
          </section>
        );
      })}
    </>
  );
}
