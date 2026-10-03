import { notFound } from "next/navigation";
import { readEditor, workingDocument } from "../../../../../server/manage";
import { ClaimForm } from "../../../../../components/manage/DatasetForms";
export default async function ClaimEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ subject?: string; saved?: string }>;
}) {
  const state = await readEditor();
  const document = workingDocument(state);
  const { id } = await params;
  const query = await searchParams;
  const batch =
    id === "new"
      ? document.batches.find((b) =>
          b.node_candidates.some((n) => n.id === query.subject),
        )
      : document.batches.find((b) =>
          b.assertion_candidates.some((a) => a.id === id),
        );
  if (!batch) notFound();
  const claim =
    id === "new"
      ? undefined
      : batch.assertion_candidates.find((a) => a.id === id);
  const subject = claim?.subject ?? query.subject;
  return (
    <>
      <a
        href={
          subject ? `/manage/nodes/${encodeURIComponent(subject)}` : "/manage"
        }
      >
        ← 項目へ戻る
      </a>
      <h1>{claim ? "記述と根拠を編集" : "出典付きの記述を追加"}</h1>
      {query.saved ? (
        <p className="notice" role="status">
          下書きへ保存しました。
        </p>
      ) : null}
      <section className="panel">
        <ClaimForm
          key={state.generation}
          batch={batch}
          generation={state.generation}
          claim={claim}
          subject={subject}
          withdrawn={document.withdrawn.sources}
        />
      </section>
    </>
  );
}
