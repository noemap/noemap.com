import { connection } from "next/server";
import { searchEntryNodes } from "../../server/entry";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "知識を探す — NOEMAP",
  robots: { index: false, follow: true },
};
import {
  queryText,
  queryOffset,
  queryNodeType,
  type PageQuery,
} from "../../domain/nodes";
import { SearchForm } from "../../components/exploration/SearchForm";
import { NodeCards } from "../../components/exploration/NodeCards";
import { Pagination } from "../../components/exploration/Pagination";
export default async function Search({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  await connection();
  const query = await searchParams;
  const q = queryText(query.q).slice(0, 120);
  const type = queryNodeType(query.type);
  const theme = queryText(query.theme),
    discipline = queryText(query.discipline);
  const page = await searchEntryNodes({
    q,
    type,
    theme,
    discipline,
    offset: queryOffset(query.offset),
  });
  return (
    <>
      <div className="exploration-heading">
        <h1>知識を探す</h1>
        <p>名前・別名・要約から、問い・人物・概念・著作を検索できます。</p>
      </div>
      <SearchForm query={q} type={type} theme={theme} discipline={discipline} />
      <h2 className="search-result-heading">
        {q ? `「${q}」の検索結果` : "公開済みの知識"}
      </h2>
      {page.items.length ? (
        <NodeCards nodes={page.items} />
      ) : (
        <p className="empty-state">
          {page.offset
            ? "このページに表示できる項目はありません。"
            : "該当する項目はありません。名前を短くするか、別名を試してください。"}
        </p>
      )}
      {!page.items.length ? (
        <a href="/themes">テーマを変えて、探索を続ける →</a>
      ) : null}
      <Pagination
        pathname="/search"
        offset={page.offset}
        hasMore={page.has_more}
        query={{ q, type, theme, discipline }}
      />
    </>
  );
}
