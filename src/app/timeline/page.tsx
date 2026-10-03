import { connection } from "next/server";
import { timelineNodes } from "../../server/exploration";
import {
  queryOffset,
  nodeTypeNames,
  temporalRoleNames,
  type PageQuery,
} from "../../domain/nodes";
import { Pagination } from "../../components/exploration/Pagination";
export default async function Timeline({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  await connection();
  const query = await searchParams;
  const page = await timelineNodes(queryOffset(query.offset));
  return (
    <>
      <div className="exploration-heading">
        <h1>年代から探す</h1>
        <p>
          人物の活動や著作の刊行を、年代順に見比べる。年代に幅がある場合は、その表記を残しています。
        </p>
      </div>
      {page.items.length ? (
        <ol className="exploration-timeline">
          {page.items.map((item) => (
            <li key={item.id}>
              <div className="timeline-date">
                <strong>{item.date_label}</strong>
                <span>{temporalRoleNames[item.role] ?? "年代"}</span>
              </div>
              <div className="timeline-node">
                <span className="type-label">
                  {nodeTypeNames[item.node.type]}
                </span>
                <h2>
                  <a href={item.node.href}>{item.node.title}</a>
                </h2>
                {item.node.summary ? <p>{item.node.summary}</p> : null}
                <a className="relation-evidence" href={`/evidence/${item.id}`}>
                  年代の根拠を読む
                </a>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-state">
          {page.offset
            ? "このページに表示できる年代はありません。"
            : "根拠を確認した年代は、ここに表示されます。"}
        </p>
      )}
      <Pagination
        pathname="/timeline"
        offset={page.offset}
        hasMore={page.has_more}
      />
    </>
  );
}
