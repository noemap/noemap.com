import {
  nodeCollections,
  nodeTypeNames,
  temporalRoleNames,
  type NodeDocument,
  type NeighborPage,
} from "../../domain/nodes";
import { Neighborhood } from "./Neighborhood";
function httpsSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function NodeView({
  node,
  neighbors,
}: {
  node: NodeDocument;
  neighbors: NeighborPage;
}) {
  const sources = new Map(
    node.article.sections.flatMap((section) =>
      section.assertions.flatMap((assertion) =>
        assertion.sources.map(
          (source) => [source.source_revision_id, source] as const,
        ),
      ),
    ),
  );
  return (
    <>
      <nav className="node-breadcrumb" aria-label="現在位置">
        <a href="/">人間とは何か？</a>
        <span aria-hidden="true">/</span>
        <a href={`/${nodeCollections[node.type]}`}>
          {nodeTypeNames[node.type]}
        </a>
      </nav>
      <div className="article-heading">
        <span className="type-label">{nodeTypeNames[node.type]}</span>
        <h1>{node.title}</h1>
        {node.aliases.length ? (
          <p className="muted">別名：{node.aliases.join("、")}</p>
        ) : null}
        <div className="counts">
          <span>{node.article.sections.length}件の説明</span>
          <span>{sources.size}件の資料</span>
        </div>
      </div>
      <div className="node-grid">
        <article className="reading">
          {node.article.sections.length > 1 ? (
            <nav className="contents" aria-label="目次">
              <strong>このページの内容</strong>
              <ol>
                {node.article.sections.map((section, index) => (
                  <li key={section.revision_id}>
                    <a href={`#section-${index}`}>
                      {section.text.split("\n")[0]}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          {node.article.sections.map((section, index) => {
            const [heading, ...paragraphs] = section.text.split("\n");
            return (
              <section
                id={`section-${index}`}
                className="article-section"
                key={section.revision_id}
              >
                <h2>{heading}</h2>
                {paragraphs.filter(Boolean).map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex}>{paragraph}</p>
                ))}
                {section.assertions.length ? (
                  <ul
                    className="assertion-links"
                    aria-label={`${heading}の記述と出典`}
                  >
                    {section.assertions.map((assertion, assertionIndex) => (
                      <li key={assertion.revision_id}>
                        <a href={`/evidence/${assertion.revision_id}`}>
                          記述と出典
                          {section.assertions.length > 1
                            ? ` ${assertionIndex + 1}`
                            : ""}
                          を読む →
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {section.assertions.length ? (
                  <details>
                    <summary>根拠と補足</summary>
                    <div className="evidence-list">
                      {section.assertions.map((assertion) => (
                        <div key={assertion.revision_id}>
                          <p>
                            {
                              assertion.texts.find(
                                (text) => text.role === "body",
                              )?.content
                            }
                          </p>
                          {assertion.attributions.map(
                            (attribution, attributionIndex) => (
                              <p className="small" key={attributionIndex}>
                                発言・考え方の帰属：{attribution.speaker}
                              </p>
                            ),
                          )}
                          <a href={`/evidence/${assertion.revision_id}`}>
                            資料の該当箇所を確認する
                          </a>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </section>
            );
          })}
          {sources.size ? (
            <section>
              <h2>参照資料</h2>
              <ol className="source-list">
                {Array.from(sources.values()).map((source) => {
                  const url = httpsSourceUrl(source.url);
                  return (
                    <li key={source.source_revision_id}>
                      {source.citation}
                      <span className="small">{source.locator}</span>
                      {source.edition ? (
                        <span className="small">版：{source.edition}</span>
                      ) : null}
                      {url ? (
                        <a
                          className="source-link"
                          href={url}
                          rel="noopener noreferrer"
                        >
                          掲載元を読む →
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
          {node.dates?.length ? (
            <section className="node-dates">
              <h2>年代</h2>
              <ul className="date-list">
                {node.dates.map((date) => (
                  <li key={date.id}>
                    <span>{temporalRoleNames[date.role] ?? "年代"}</span>
                    <strong>{date.date_label}</strong>
                    <a href={`/evidence/${date.id}`}>年代の根拠</a>
                  </li>
                ))}
              </ul>
              <a href="/timeline">年表でほかの知識と見比べる →</a>
            </section>
          ) : null}
        </article>
        <aside className="node-aside">
          <Neighborhood node={node} page={neighbors} />
        </aside>
      </div>
    </>
  );
}
