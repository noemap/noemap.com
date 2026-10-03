import type { Metadata } from "next";
import { connection } from "next/server";
import { publicEntryData, entryCatalog } from "../server/entry";
import { entrySelection } from "../domain/entry";
import { queryText, nodeTypeNames, type PageQuery } from "../domain/nodes";
import { EntryExplorer } from "../components/entry/EntryExplorer";
import { EntranceArticleLink } from "../components/entry/EntranceArticleLink";
import { QuestionDiscovery } from "../components/entry/QuestionDiscovery";
import { KnowledgeMotif } from "../components/entry/KnowledgeMotif";
import { NodeCards } from "../components/exploration/NodeCards";
import { SearchForm } from "../components/exploration/SearchForm";

export const metadata: Metadata = {
  openGraph: {
    title: "NOEMAP — 人間とは何か。",
    type: "website",
    url: "/",
    images: [
      {
        url: "/brand/noemap-home-og.png",
        width: 1200,
        height: 630,
        alt: "NOEMAP — 人間とは何か。",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NOEMAP — 人間とは何か。",
    images: [
      {
        url: "/brand/noemap-home-og.png",
        width: 1200,
        height: 630,
        alt: "NOEMAP — 人間とは何か。",
      },
    ],
  },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  await connection();
  const [data, query] = await Promise.all([publicEntryData(), searchParams]);
  const questions = data.nodes.filter((n) => n.type === "question");
  const firstQuestion =
    data.routes[0]?.nodes.find((n) => n.type === "question") ?? questions[0];
  return (
    <div className="entry-home">
      <section className="entry-hero">
        <div className="entry-hero-copy">
          <p className="entry-eyebrow">
            <span aria-hidden="true" /> A MAP OF HUMAN THOUGHT
          </p>
          <h1>人間とは何か。</h1>
          <p className="entry-hero-subtitle">
            気になる問いから、知識のつながりを辿る。
          </p>
          {firstQuestion ? (
            <div className="entry-first-question">
              <span>迷ったら、この問いから。</span>
              <EntranceArticleLink
                nodeId={firstQuestion.id}
                href={firstQuestion.href}
                className="entry-first-link"
              >
                {firstQuestion.title}
                <span aria-hidden="true">↗</span>
              </EntranceArticleLink>
            </div>
          ) : null}
        </div>
        <KnowledgeMotif />
      </section>
      <section
        aria-labelledby="entry-heading"
        className="entry-section entry-themes-section"
      >
        <div className="entry-section-intro">
          <p className="section-eyebrow">FOLLOW YOUR CURIOSITY</p>
          <h2 id="entry-heading">どこから考えてみる？</h2>
          <p>いま気になるテーマを、ひとつ。</p>
        </div>
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
      {data.routes.length ? (
        <section
          className="entry-section"
          aria-labelledby="reading-route-heading"
        >
          <div className="entry-section-intro">
            <p className="section-eyebrow">ONE QUESTION, DIFFERENT VIEWS</p>
            <h2 id="reading-route-heading">知識のつながりを歩く</h2>
            <p>ひとつの問いを、違う見方から。</p>
          </div>
          {data.routes.map((route) => (
            <article className="curiosity-route" key={route.id}>
              <div className="curiosity-route-intro">
                <span className="curiosity-route-label">小さな読書ルート</span>
                <h3>{route.title}</h3>
                <p>{route.description}</p>
              </div>
              <ol className="curiosity-route-steps">
                {route.nodes.map((n, i) => (
                  <li key={n.id}>
                    <EntranceArticleLink
                      nodeId={n.id}
                      href={n.href}
                      className="curiosity-route-step"
                    >
                      <span className="route-step-number">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="route-step-type">
                        {nodeTypeNames[n.type]}
                      </span>
                      <strong>{n.title}</strong>
                      <span className="route-step-prompt">
                        {n.type === "question"
                          ? i === 0
                            ? "ここから考える"
                            : "問いをひろげる"
                          : "この見方を知る"}
                        <span aria-hidden="true">↗</span>
                      </span>
                    </EntranceArticleLink>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </section>
      ) : null}
      <QuestionDiscovery
        questions={questions}
        initialQuestionId={queryText(query.discovery)}
      />
      <section className="entry-section" aria-labelledby="question-heading">
        <div className="exploration-section-heading">
          <div>
            <p className="section-eyebrow">QUESTIONS TO KEEP WITH YOU</p>
            <h2 id="question-heading">気になる問いを、そのまま読む</h2>
          </div>
          <a href="/questions">
            すべての問い <span aria-hidden="true">↗</span>
          </a>
        </div>
        <NodeCards
          nodes={questions.slice(0, 3)}
          headingLevel={3}
          rememberEntrance
        />
      </section>
      <section className="entry-section">
        <div className="exploration-section-heading">
          <div>
            <p className="section-eyebrow">MEET THE THINKERS</p>
            <h2>考え方に、出会う。</h2>
          </div>
          <a href="/explore">
            人物・概念を探す <span aria-hidden="true">↗</span>
          </a>
        </div>
        <NodeCards
          nodes={data.nodes.filter((n) => n.type === "person").slice(0, 3)}
          headingLevel={3}
          rememberEntrance
        />
      </section>
      <section className="entry-policy">
        <p className="section-eyebrow">THE QUESTION CONTINUES</p>
        <h2>ひとつの答えで、終わらせない。</h2>
        <p>
          異なる見方を読み比べ、その記述がどの資料に基づくかを確かめる。NOEMAPは、そのための知識の地図です。
        </p>
        <a href="/about">
          このサイトと編集方針について <span aria-hidden="true">↗</span>
        </a>
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
