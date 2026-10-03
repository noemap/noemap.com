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
import styles from "./SearchPage.module.css";
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
        <p>ひとつの言葉から、まだ知らない問いへ。</p>
      </div>
      <SearchForm query={q} type={type} theme={theme} discipline={discipline} />
      <h2 className={`search-result-heading ${styles.resultHeading}`}>
        {q ? `「${q}」の検索結果` : "読み進められるページ"}
      </h2>
      {page.items.length ? (
        <NodeCards nodes={page.items} />
      ) : (
        <section className={styles.emptyState} aria-label="ほかの探索方法">
          <p className={styles.emptyTitle}>
            {page.offset
              ? "このページには結果がありません。"
              : "この条件のページは、まだ見つかりませんでした。"}
          </p>
          <p className={styles.emptyDescription}>
            {page.offset
              ? "前のページへ戻るか、別の入口から探索を続けられます。"
              : "言葉を短くしたり、絞り込みを減らしてみてください。問いやテーマからも探せます。"}
          </p>
          <div className={styles.emptyEntrances}>
            <a href="/questions">
              <span>
                <strong>別の問いから探す</strong>
                <span>問いの一覧から、気になるひとつを。</span>
              </span>
              <span className={styles.entranceArrow} aria-hidden="true">
                →
              </span>
            </a>
            <a href="/themes">
              <span>
                <strong>テーマを選ぶ</strong>
                <span>こころ、自分、知識。興味のある入口へ。</span>
              </span>
              <span className={styles.entranceArrow} aria-hidden="true">
                →
              </span>
            </a>
          </div>
        </section>
      )}
      <Pagination
        pathname="/search"
        offset={page.offset}
        hasMore={page.has_more}
        query={{ q, type, theme, discipline }}
      />
    </>
  );
}
