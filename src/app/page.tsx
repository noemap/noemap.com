import type { Metadata } from "next";
import { connection } from "next/server";
import { explorationHome } from "../server/exploration";
import { NodeCards } from "../components/exploration/NodeCards";
import { SearchForm } from "../components/exploration/SearchForm";
import { Neighborhood } from "../components/nodes/Neighborhood";
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
export default async function Home() {
  await connection();
  const home = await explorationHome();
  const questions = home.questions.filter(
    (question) => question.id !== home.root?.id,
  );
  return (
    <>
      <section className="exploration-hero">
        <h1>人間とは何か。</h1>
        <p>気になる問いから、知識のつながりを辿る。</p>
        {home.root ? (
          <a className="button" href={home.root.href}>
            この問いから始める →
          </a>
        ) : null}
      </section>
      <SearchForm />
      <section
        className="exploration-section"
        aria-labelledby="question-heading"
      >
        <div className="exploration-section-heading">
          <h2 id="question-heading">どこから考えてみる？</h2>
          <a href="/questions">すべての問い →</a>
        </div>
        {questions.length ? (
          <NodeCards nodes={questions} headingLevel={3} />
        ) : (
          <p>問いの公開準備を進めています。</p>
        )}
      </section>
      <div className="home-lower-grid">
        <section className="panel exploration-entrances">
          <h2>ほかの入口</h2>
          <ul>
            <li>
              <a href="/people">
                人物から探す <span aria-hidden="true">→</span>
              </a>
            </li>
            <li>
              <a href="/concepts">
                概念から探す <span aria-hidden="true">→</span>
              </a>
            </li>
            <li>
              <a href="/books">
                著作から探す <span aria-hidden="true">→</span>
              </a>
            </li>
            <li>
              <a href="/timeline">
                年代から探す <span aria-hidden="true">→</span>
              </a>
            </li>
          </ul>
        </section>
        {home.root ? (
          <Neighborhood
            node={home.root}
            page={home.neighbors}
            pagination={false}
          />
        ) : null}
      </div>
    </>
  );
}
