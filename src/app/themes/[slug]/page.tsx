import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { publicEntryData, entryCatalog } from "../../../server/entry";
import { classificationFor, entrySelection } from "../../../domain/entry";
import { queryText, type PageQuery } from "../../../domain/nodes";
import { EntryExplorer } from "../../../components/entry/EntryExplorer";
import { NodeCards } from "../../../components/exploration/NodeCards";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const theme = entryCatalog.themes.find((t) => t.slug === slug);
  return theme
    ? {
        title: `${theme.title} — NOEMAP`,
        description: theme.prompt,
        alternates: { canonical: `https://noemap.com/themes/${theme.slug}` },
      }
    : {};
}
export default async function ThemePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<PageQuery>;
}) {
  await connection();
  const [{ slug }, query, data] = await Promise.all([
    params,
    searchParams,
    publicEntryData(),
  ]);
  const theme = data.themes.find((t) => t.slug === slug);
  if (!theme) notFound();
  const related = data.nodes.filter(
    (n) =>
      n.type !== "question" &&
      classificationFor(entryCatalog, n.id).themes.some(
        (t) => t.id === theme.id,
      ),
  );
  return (
    <>
      <nav className="node-breadcrumb" aria-label="現在位置">
        <a href="/">ホーム</a>
        <span>/</span>
        <a href="/themes">テーマ</a>
      </nav>
      <div className="exploration-heading">
        <h1>{theme.title}</h1>
        <p>{theme.prompt}</p>
      </div>
      {theme.groups.length ? (
        <EntryExplorer
          themes={[theme]}
          initialSelection={entrySelection(
            [theme],
            queryText(query.closed) === "1" ? null : theme.id,
            queryText(query.group),
          )}
          compact
        />
      ) : (
        <p>
          公開できる問いを準備しています。
          <a href="/themes">ほかのテーマから探す →</a>
        </p>
      )}
      {related.length ? (
        <section className="entry-section">
          <h2>このテーマにつながる人物・概念</h2>
          <NodeCards nodes={related} />
          <a href={`/explore?theme=${theme.id}`}>すべての関連ページ →</a>
        </section>
      ) : null}
    </>
  );
}
