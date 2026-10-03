import {
  nodeCollections,
  nodeTypeNames,
  temporalRoleNames,
  type NodeDocument,
  type NeighborPage,
} from "../../domain/nodes";
import { Neighborhood } from "./Neighborhood";
import { EntryReturnLink } from "../entry/EntryReturnLink";
import type { classificationFor } from "../../domain/entry";
import {
  questionPerspectives,
  QuestionPerspectives,
  ReadingContinuation,
  type ReadingRoute,
} from "../reading/ReadingGuides";
import { articleSources, SourceReferences } from "../reading/SourceReferences";
import styles from "../reading/Reading.module.css";
export function NodeView({
  node,
  neighbors,
  classification,
  readingRoutes = [],
}: {
  node: NodeDocument;
  neighbors: NeighborPage;
  classification?: ReturnType<typeof classificationFor>;
  readingRoutes?: ReadingRoute[];
}) {
  const sources = articleSources(node);
  const perspectives = questionPerspectives(node, neighbors, readingRoutes);
  const perspectiveIds = new Set(perspectives.map((card) => card.node.id));
  return (
    <div className={styles.page}>
      <EntryReturnLink
        nodeId={node.id}
        fallbackHref={`/${nodeCollections[node.type]}`}
        fallbackLabel={nodeTypeNames[node.type]}
      />
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
        <p className="node-introduction">{node.summary}</p>
        {classification ? (
          <div className="entry-node-meta">
            {classification.themes.map((t) => (
              <a key={t.id} href={`/themes/${t.slug}`}>
                {t.title}
              </a>
            ))}
            {classification.disciplines.map((d) => (
              <a key={d.id} href={`/explore?discipline=${d.id}`}>
                {d.title}
              </a>
            ))}
            {classification.updatedAt ? (
              <span>
                更新日：
                <time dateTime={classification.updatedAt}>
                  {classification.updatedAt}
                </time>
              </span>
            ) : null}
          </div>
        ) : null}
        {node.aliases.length ? (
          <p className="muted">別名：{node.aliases.join("、")}</p>
        ) : null}
        {sources.length ? (
          <a className={styles.sourceCount} href="#reading-sources">
            {sources.length}つの参照資料から読む
            <span aria-hidden="true">↓</span>
          </a>
        ) : null}
      </div>
      <nav className={styles.readingNav} aria-label="このページの読み方">
        {perspectives.length ? (
          <a href="#reading-perspectives">考え方を見てみる</a>
        ) : null}
        {sources.length ? <a href="#reading-sources">出典を確かめる</a> : null}
        {neighbors.items.length || neighbors.offset ? (
          <a href="#connections">つながりをたどる</a>
        ) : null}
      </nav>
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
          <QuestionPerspectives cards={perspectives} />
          {node.article.sections.map((section, index) => {
            const [heading, ...paragraphs] = section.text.split("\n");
            const content = paragraphs.filter(Boolean);
            const repeatsIntroduction =
              content[0]?.trim() === node.summary.trim();
            const visibleParagraphs = repeatsIntroduction
              ? content.slice(1)
              : content;
            const visibleHeading =
              heading === "概要" && repeatsIntroduction
                ? visibleParagraphs.length
                  ? "読み方と出典"
                  : node.type === "question"
                    ? "この問いの出典"
                    : "このページの出典"
                : heading;
            return (
              <section
                id={`section-${index}`}
                className="article-section"
                key={section.revision_id}
              >
                <h2>{visibleHeading}</h2>
                {visibleParagraphs.map((paragraph, paragraphIndex) => (
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
                                {attribution.context ? (
                                  <span>{attribution.context}</span>
                                ) : null}
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
          <ReadingContinuation
            node={node}
            neighbors={neighbors}
            routes={readingRoutes}
            perspectiveIds={perspectiveIds}
          />
          <SourceReferences sources={sources} />
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
    </div>
  );
}
