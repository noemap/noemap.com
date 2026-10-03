import type { Metadata } from "next";
import { connection } from "next/server";
import { publicEntryData, entryCatalog } from "../../server/entry";
import { filterEntryNodes } from "../../domain/entry";
import {
  queryNodeType,
  queryOffset,
  queryText,
  type PageQuery,
} from "../../domain/nodes";
import { NodeCards } from "../../components/exploration/NodeCards";
import { SearchForm } from "../../components/exploration/SearchForm";
import { Pagination } from "../../components/exploration/Pagination";
export const metadata: Metadata = {
  title: "人物・概念から探す — NOEMAP",
  description: "人物・概念・著作を、種類・テーマ・学問分野から探す。",
  alternates: { canonical: "https://noemap.com/explore" },
};
export default async function Explore({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  await connection();
  const [query, data] = await Promise.all([searchParams, publicEntryData()]);
  const q = queryText(query.q).slice(0, 120);
  const type = queryNodeType(query.type);
  const theme = queryText(query.theme),
    discipline = queryText(query.discipline);
  const page = filterEntryNodes(
    data.nodes.filter((n) => type === "question" || n.type !== "question"),
    entryCatalog,
    { q, type, theme, discipline, offset: queryOffset(query.offset) },
  );
  return (
    <>
      <div className="exploration-heading">
        <h1>人物・概念から探す</h1>
        <p>問いにつながる人物、概念、著作を読み進める。</p>
      </div>
      <SearchForm
        action="/explore"
        query={q}
        type={type}
        theme={theme}
        discipline={discipline}
      />
      {page.items.length ? (
        <NodeCards nodes={page.items} />
      ) : (
        <p className="empty-state">
          この条件の公開ページはまだありません。
          <a href="/themes">ほかのテーマを探す →</a>
        </p>
      )}
      <Pagination
        pathname="/explore"
        offset={page.offset}
        hasMore={page.has_more}
        query={{ q, type, theme, discipline }}
      />
    </>
  );
}
