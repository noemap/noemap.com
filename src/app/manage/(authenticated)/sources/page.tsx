import { readEditor, workingDocument } from "../../../../server/manage";
import { batchTitle, SourceWithdrawalForm } from "../../../../components/manage/DatasetForms";
export default async function Sources({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const state = await readEditor();
  const document = workingDocument(state);
  const query = await searchParams;
  return <>
    <h1>資料の情報と撤回</h1>
    <p>資料を撤回すると、その資料に依存する項目・記述・関連・年代は公開から外れます。まず下書きとして保存し、公開への反映を別に行います。</p>
    {query.saved ? <p className="notice" role="status">下書きへ保存しました。公開へ反映する前に、依存する内容を確認してください。</p> : null}
    {document.batches.map((batch) => <section className="panel" key={batch.batch_id}>
      <h2>{batchTitle(batch)}の参照資料</h2>
      {batch.sources.map((source) => {
        const withdrawn = document.withdrawn.sources.includes(source.id);
        return <div className="source-card" key={source.id}>
          <p><a href={`/manage/sources/${encodeURIComponent(source.id)}`}>{source.title}</a> {withdrawn ? <span className="status stopped">撤回中</span> : null}</p>
          <p className="small">{source.edition}</p>
          {withdrawn ? <p className="field-note">この資料の撤回は、過去の版を復元しても維持します。</p> : <details><summary>この資料の撤回を準備する</summary>
            <SourceWithdrawalForm key={state.generation} batch={batch} generation={state.generation} source={source} />
          </details>}
        </div>;
      })}
    </section>)}
  </>;
}
