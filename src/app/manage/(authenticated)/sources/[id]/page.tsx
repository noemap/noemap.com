import { notFound } from "next/navigation";
import { readEditor, workingDocument } from "../../../../../server/manage";
import { SourceForm } from "../../../../../components/manage/DatasetForms";
export default async function SourceEditor({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const state = await readEditor();
  const document = workingDocument(state);
  const { id } = await params;
  const query = await searchParams;
  const batch = document.batches.find((b) => b.sources.some((s) => s.id === id));
  const source = batch?.sources.find((s) => s.id === id);
  if (!batch || !source) notFound();
  return <>
    <a href="/manage/sources">← 資料一覧</a><h1>資料の表示情報を編集</h1>
    {query.saved ? <p className="notice" role="status">下書きへ保存しました。</p> : null}
    <p className="muted">ここでは名称・参照版・掲載元を編集します。元の刊行情報、利用条件、確認待ちの状態も版に残します。</p>
    <section className="panel"><SourceForm key={state.generation} batch={batch} generation={state.generation} source={source} /></section>
  </>;
}
