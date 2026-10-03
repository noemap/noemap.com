import { readEditor, workingDocument } from "../../../../server/manage";
import { batchTitle } from "../../../../components/manage/DatasetForms";
export default async function Relationships() {
  const state = await readEditor();
  const document = workingDocument(state);
  return (
    <>
      <h1>探索の関連付けを編集する</h1>
      <p>
        全てNOEMAPの編集上の関連です。資料に基づく記述を根拠として指定します。
      </p>
      {document.batches.map((batch) => (
        <section className="panel" key={batch.batch_id}>
          <div className="exploration-section-heading">
            <h2>{batchTitle(batch)}の資料を扱う関連</h2>
            <a
              href={`/manage/relationships/new?batch=${encodeURIComponent(batch.batch_id)}`}
            >
              関連を追加 →
            </a>
          </div>
          {batch.relationship_candidates.map((relation, index) => {
            const id = relation.id ?? `${batch.batch_id}:relation:${index}`;
            const from = batch.node_candidates.find(
              (node) => node.id === relation.from,
            );
            const to = batch.node_candidates.find(
              (node) => node.id === relation.to,
            );
            return (
              <div className="list-row" key={id}>
                <div>
                  <a href={`/manage/relationships/${encodeURIComponent(id)}`}>
                    {from?.label} → {to?.label}
                  </a>
                  <p className="editor-meta">{relation.reason}</p>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}
