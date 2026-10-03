import { connection } from "next/server";
import { notFound } from "next/navigation";
import { editor, detail, errorMessages } from "../../../../server/editor";
import { value } from "../../../../server/database";
import { isUuid } from "../../../../server/public";
import { nodeCollections, type NodeType } from "../../../../domain/nodes";
import {
  Operation,
  HumanCheck,
  Reason,
} from "../../../../components/EditorForms";
export default async function Compose({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  await connection();
  const actor = await editor(),
    { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await detail(actor.id, id);
  if (
    !data ||
    data.revision.kind !== "entity" ||
    data.revision.state !== "frozen"
  )
    notFound();
  const collection = nodeCollections[data.revision.variant as NodeType];
  if (!collection) notFound();
  if (!actor.roles.includes("reviewer") || !actor.roles.includes("publisher"))
    return (
      <p>記事の組み合わせの公開には、確認と公開の両方の権限が必要です。</p>
    );
  const query = await searchParams,
    page = await value<{
      generation: number;
      blocks: { id: string; text: string; published: boolean }[];
    }>("SELECT api.editor_page($1,'ja')", [data.revision.object_id], actor.id);
  return (
    <div className="panel evidence-page">
      <a href={`/editor/revisions/${id}`}>項目の版へ</a>
      <h1>記事の本文を組み合わせる</h1>
      <p>
        公開済みの本文を選び、表示順を確認します。ここでは一覧の順に掲載します。
      </p>
      {query.error && (
        <p className="notice warning">
          {errorMessages[query.error] ?? errorMessages.failed}
        </p>
      )}
      <form method="post" action="/editor/action">
        <Operation
          action="compose"
          revision={id}
          generation={page.generation}
        />
        {page.blocks.map((b) => (
          <label className="check" key={b.id}>
            <input
              type="checkbox"
              name="blocks"
              value={b.id}
              disabled={!b.published}
            />
            <span>
              <strong>{b.text.split("\n")[0]}</strong>
              <br />
              {b.text.split("\n").slice(1).join(" ")}
              {!b.published && (
                <span className="status stopped">
                  公開・根拠を確認してください
                </span>
              )}
            </span>
          </label>
        ))}
        {!page.blocks.length && <p>この項目の本文がまだありません。</p>}
        <HumanCheck />
        <Reason label="この組み合わせを確認した理由" />
        <div className="actions">
          <button>組み合わせを確認して公開</button>
          <a
            className="button secondary"
            href={`/${collection}/${data.revision.object_id}`}
          >
            読者向け画面を見る
          </a>
        </div>
      </form>
    </div>
  );
}
