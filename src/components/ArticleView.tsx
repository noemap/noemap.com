import type { Article } from "../domain/types";
import { ConnectionMap } from "./ConnectionMap";
export function ArticleView({ article }: { article: Article }) {
  const title =
    article.entity.texts.find((t) => t.role === "preferred")?.content ?? "問い";
  const sources = new Map(
    article.sections.flatMap((s) =>
      s.assertions.flatMap((a) =>
        a.sources.map((source) => [source.source_revision_id, source] as const),
      ),
    ),
  );
  return (
    <>
      <div className="article-heading">
        <span className="type-label">問い</span>
        <h1>{title}</h1>
        <p className="muted">考え方を読み比べ、判断の理由と出典を確かめる。</p>
        <div className="counts">
          <span>{article.sections.length}件の説明</span>
          <span>{sources.size}件の資料</span>
        </div>
      </div>
      <div className="article-grid">
        <article className="reading">
          <nav className="contents" aria-label="目次">
            <strong>このページの内容</strong>
            <ol>
              {article.sections.map((s, i) => (
                <li key={s.revision_id}>
                  <a href={`#section-${i}`}>{s.text.split("\n")[0]}</a>
                </li>
              ))}
            </ol>
          </nav>
          {article.sections.map((section, i) => {
            const [heading, ...paragraphs] = section.text.split("\n");
            return (
              <section
                id={`section-${i}`}
                className="article-section"
                key={section.revision_id}
              >
                <h2>{heading}</h2>
                {paragraphs.filter(Boolean).map((p, n) => (
                  <p key={n}>{p}</p>
                ))}
                <details>
                  <summary>根拠と補足</summary>
                  <div className="evidence-list">
                    {section.assertions.map((a) => (
                      <div key={a.revision_id}>
                        <p>{a.texts.find((t) => t.role === "body")?.content}</p>
                        {a.attributions.map((at, n) => (
                          <p className="small" key={n}>
                            帰属：{at.speaker}
                          </p>
                        ))}
                        <a href={`/evidence/${a.revision_id}`}>
                          資料の該当箇所を確認する
                        </a>
                      </div>
                    ))}
                  </div>
                </details>
              </section>
            );
          })}
        </article>
        <aside className="article-aside">
          <ConnectionMap connections={article.connections} question={title} />
          <section className="panel">
            <h2>参照資料</h2>
            <ol className="source-list">
              {Array.from(sources.values()).map((s) => (
                <li key={s.source_revision_id}>
                  {s.citation}
                  <span className="small">{s.locator}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
