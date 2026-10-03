import { connection } from "next/server";
import { searchNodes } from "../../server/exploration";
import {
  nodeTypeNames,
  nodeCollections,
  queryOffset,
  type NodeType,
  type PageQuery,
} from "../../domain/nodes";
import { NodeCards } from "./NodeCards";
import { Pagination } from "./Pagination";
export async function CollectionView({
  type,
  searchParams,
}: {
  type: NodeType;
  searchParams: Promise<PageQuery>;
}) {
  await connection();
  const query = await searchParams;
  const page = await searchNodes("", type, queryOffset(query.offset));
  return (
    <>
      <div className="exploration-heading">
        <h1>{nodeTypeNames[type]}から探す</h1>
        <a href="/search">名前・別名で検索する</a>
      </div>
      {page.items.length ? (
        <NodeCards nodes={page.items} />
      ) : (
        <p className="empty-state">
          {page.offset
            ? "このページに表示できる項目はありません。"
            : "公開済みの項目はまだありません。"}
        </p>
      )}
      <Pagination
        pathname={`/${nodeCollections[type]}`}
        offset={page.offset}
        hasMore={page.has_more}
      />
    </>
  );
}
