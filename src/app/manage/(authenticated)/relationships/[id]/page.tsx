import { notFound } from "next/navigation";
import { readEditor, workingDocument } from "../../../../../server/manage";
import { RelationshipForm } from "../../../../../components/manage/DatasetForms";
export default async function RelationshipEditor({
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
      ? document.batches.find((b) => b.batch_id === query.batch)
      : document.batches.find((b) =>
          b.relationship_candidates.some(
            (r, i) => (r.id ?? `${b.batch_id}:relation:${i}`) === id,
          ),
        );
  if (!batch) notFound();
  const relation =
    id === "new"
      ? undefined
      : batch.relationship_candidates.find(
          (r, i) => (r.id ?? `${batch.batch_id}:relation:${i}`) === id,
        );
  return (
    <>
      <a href="/manage/relationships">← 関連一覧</a>
      <h1>{relation ? "関連付けを編集" : "編集上の関連を追加"}</h1>
      {query.saved ? (
        <p className="notice" role="status">
          下書きへ保存しました。
        </p>
      ) : null}
      <section className="panel">
        <RelationshipForm
          key={state.generation}
          batch={batch}
          generation={state.generation}
          relation={relation}
          target={relation ? id : undefined}
        />
      </section>
    </>
  );
}
