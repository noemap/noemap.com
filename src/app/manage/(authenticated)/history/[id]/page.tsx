import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import {
  readEditor,
  readSnapshot,
  workingDocument,
} from "../../../../../server/manage";
import { MutationForm } from "../../../../../components/manage/MutationForm";
import {
  batchTitle,
  typeNames,
} from "../../../../../components/manage/DatasetForms";
export default async function Snapshot({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [state, revision] = await Promise.all([readEditor(), readSnapshot(id)]);
  if (!revision) notFound();
  const current = workingDocument(state);
  const nodes = revision.document.batches.flatMap(
    (batch) => batch.node_candidates,
  );
  const existing = new Map(
    current.batches.flatMap((batch) =>
      batch.node_candidates.map((node) => [node.id, node] as const),
    ),
  );
  const changed = nodes.filter(
    (node) => JSON.stringify(existing.get(node.id)) !== JSON.stringify(node),
  ).length;
  const absent = [...existing.keys()].filter(
    (key) => !nodes.some((node) => node.id === key),
  ).length;
  return (
    <>
      <a href="/manage/history">← 履歴一覧</a>
      <h1>保存された版を確認する</h1>
      <p>
        {revision.reason} · {revision.actor_label}
      </p>
      <p className="editor-meta">
        <time dateTime={revision.created_at}>
          {new Date(revision.created_at).toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
          })}
        </time>
      </p>
      <section className="panel">
        <h2>この版から復元する</h2>
        <p>
          現在の編集内容と比べて、項目の追加・変更は{changed}
          件、現在の項目でこの版に含まれないものは{absent}
          件です。記述と資料も下の内容へ戻ります。
        </p>
        <p>
          現在撤回している資料の指定を維持して、新しい下書きを作成します。公開への反映は別の操作です。
        </p>
        <MutationForm
          key={state.generation}
          generation={state.generation}
          operationId={randomUUID()}
          operation="restore"
          target={revision.id}
          submitLabel="この版から新しい下書きを作る"
          fields={[
            {
              name: "confirm",
              label: "この版の内容と復元の範囲を確認しました。",
              kind: "checkbox",
              value: "",
              required: true,
            },
          ]}
        />
      </section>
      {revision.document.batches.map((batch) => (
        <section className="panel" key={batch.batch_id}>
          <h2>{batchTitle(batch)}の項目と記述</h2>
          {batch.node_candidates.map((node) => (
            <details className="manage-history-node" key={node.id}>
              <summary>
                {typeNames[node.type]} · {node.label}
              </summary>
              <p>{node.summary_ja}</p>
              {node.definition_scope ? (
                <p className="small">文脈：{node.definition_scope}</p>
              ) : null}
              {node.scope_limit ? (
                <p className="small">留保：{node.scope_limit}</p>
              ) : null}
              {batch.assertion_candidates
                .filter((claim) => claim.subject === node.id)
                .map((claim) => (
                  <div className="source-card" key={claim.id}>
                    <p>{claim.text_ja}</p>
                    <p className="small">
                      帰属：{claim.attribution}
                      <br />
                      留保：{claim.limit}
                    </p>
                    <ul>
                      {claim.evidence.map((reference, index) => (
                        <li key={`${reference.source}:${index}`}>
                          {
                            batch.sources.find(
                              (source) => source.id === reference.source,
                            )?.title
                          }{" "}
                          · {reference.locator}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </details>
          ))}
          <details>
            <summary>この版の資料と関連</summary>
            {batch.sources.map((source) => (
              <div className="source-card" key={source.id}>
                <p>{source.title}</p>
                <p className="small">{source.edition}</p>
                <p className="small">{source.url}</p>
                {revision.document.withdrawn.sources.includes(source.id) ? (
                  <span className="status stopped">この版で撤回中</span>
                ) : null}
              </div>
            ))}
            {batch.relationship_candidates.map((relation, index) => (
              <p key={relation.id ?? index}>
                {
                  batch.node_candidates.find(
                    (node) => node.id === relation.from,
                  )?.label
                }{" "}
                →{" "}
                {
                  batch.node_candidates.find((node) => node.id === relation.to)
                    ?.label
                }
                ：{relation.reason}
              </p>
            ))}
          </details>
        </section>
      ))}
    </>
  );
}
