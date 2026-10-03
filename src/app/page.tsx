import { connection } from "next/server";
import { publicEntryData, entryCatalog } from "../server/entry";
import { entrySelection } from "../domain/entry";
import { queryText, type PageQuery } from "../domain/nodes";
import { EntryExplorer } from "../components/entry/EntryExplorer";
import { NodeCards } from "../components/exploration/NodeCards";
import { SearchForm } from "../components/exploration/SearchForm";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  await connection();
  const [data, query] = await Promise.all([publicEntryData(), searchParams]);
  const questions = data.nodes.filter((n) => n.type === "question");
  return (
    <div className="entry-home">
      <section className="entry-hero">
        <p className="entry-eyebrow">NOEMAP</p>
        <h1>人間とは何か。</h1>
        <p>気になる問いから、知識のつながりを辿る。</p>
      </section>
      <section aria-labelledby="entry-heading" className="entry-section">
        <h2 id="entry-heading">どこから考えてみる？</h2>
        <EntryExplorer
          themes={data.themes}
          initialSelection={entrySelection(
            data.themes,
            queryText(query.theme),
            queryText(query.group),
          )}
        />
      </section>
      <section className="entry-search" aria-label="問い・人物・概念の検索">
        <SearchForm compact />
      </section>
      <section className="entry-section" aria-labelledby="question-heading">
        <div className="exploration-section-heading">
          <h2 id="question-heading">気になる問いを、そのまま読む</h2>
          <a href="/questions">すべての問い →</a>
        </div>
        <NodeCards nodes={questions.slice(0, 3)} headingLevel={3} />
      </section>
      {data.routes.length ? (
        <section className="entry-section">
          <h2>知識のつながりを歩く</h2>
          {data.routes.map((route) => (
            <article className="entry-route" key={route.id}>
              <h3>{route.title}</h3>
              <p>{route.description}</p>
              <ol>
                {route.nodes.map((n) => (
                  <li key={n.id}>
                    <a href={n.href}>
                      {n.title} <span aria-hidden="true">→</span>
                    </a>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </section>
      ) : null}
      <section className="entry-section">
        <div className="exploration-section-heading">
          <h2>最近整えたページ</h2>
          <a href="/explore">人物・概念を探す →</a>
        </div>
        <NodeCards
          nodes={data.nodes.filter((n) => n.type === "person").slice(0, 3)}
          headingLevel={3}
        />
        <p className="small muted">
          資料に基づくページを、問いと一緒に読み進められます。
        </p>
      </section>
      <section className="entry-policy">
        <h2>ひとつの答えで、終わらせない。</h2>
        <p>
          異なる見方を読み比べ、その記述がどの資料に基づくかを確かめる。NOEMAPは、そのための知識の地図です。
        </p>
        <a href="/about">このサイトと編集方針について →</a>
        <div className="entry-secondary-links">
          <a href="/timeline">出典付きの年表</a>
          <a href={`/explore?discipline=${entryCatalog.disciplines[0].id}`}>
            学問の視点から探す
          </a>
        </div>
      </section>
    </div>
  );
}
