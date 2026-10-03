"use client";
import { useEffect, useState } from "react";
import type { NodeSummary } from "../../domain/nodes";
import { EntranceArticleLink } from "./EntranceArticleLink";

export function QuestionDiscovery({
  questions,
  initialQuestionId,
}: {
  questions: NodeSummary[];
  initialQuestionId?: string;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      questions.findIndex((q) => q.id === initialQuestionId),
    ),
  );
  useEffect(() => {
    const sync = () => {
      const id = new URL(window.location.href).searchParams.get("discovery");
      setIndex(
        Math.max(
          0,
          questions.findIndex((q) => q.id === id),
        ),
      );
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [questions]);
  function discover() {
    const next =
      (index + 1 + Math.floor(Math.random() * (questions.length - 1))) %
      questions.length;
    setIndex(next);
    const url = new URL(window.location.href);
    url.searchParams.set("discovery", questions[next].id);
    window.history.replaceState(
      window.history.state,
      "",
      url.pathname + url.search + url.hash,
    );
  }
  const question = questions[index];
  if (!question) return null;
  return (
    <section className="question-discovery" aria-labelledby="discovery-heading">
      <div className="discovery-copy">
        <p className="section-eyebrow">A LITTLE DETOUR</p>
        <h2 id="discovery-heading">次は、どんな問いに出会う？</h2>
        <p>
          答えを急がず、少しだけ寄り道。
          <br />
          いつもと違う問いが、見方を変えるかもしれません。
        </p>
        {questions.length > 1 ? (
          <button
            type="button"
            className="discovery-shuffle"
            onClick={discover}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M3 6h3c5 0 7 12 12 12h3M3 18h3c5 0 7-12 12-12h3M18 3l3 3-3 3m0 6 3 3-3 3" />
            </svg>
            別の問いに出会う
          </button>
        ) : null}
      </div>
      <div className="discovery-result" aria-live="polite" aria-atomic="true">
        <EntranceArticleLink
          nodeId={question.id}
          href={question.href}
          className="discovery-card"
        >
          <span className="discovery-kicker">こんな問いは、どうだろう。</span>
          <h3>{question.title}</h3>
          <p>{question.summary}</p>
          <span className="discovery-read">
            この問いから考える <span aria-hidden="true">↗</span>
          </span>
        </EntranceArticleLink>
      </div>
    </section>
  );
}
