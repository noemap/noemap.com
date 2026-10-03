import type { NodeDocument } from "../../domain/nodes";
import type { PublicEvidence } from "../../domain/types";
import styles from "./Reading.module.css";

type SourceReference = PublicEvidence["sources"][number];
type SourceGroup = { id: string; references: SourceReference[] };

export function articleSources(node: NodeDocument): SourceGroup[] {
  const groups = new Map<string, SourceReference[]>();
  for (const section of node.article.sections) {
    for (const assertion of section.assertions) {
      for (const source of assertion.sources) {
        const references = groups.get(source.source_revision_id) ?? [];
        if (
          !references.some(
            (reference) =>
              reference.locator === source.locator &&
              reference.role === source.role &&
              reference.edition === source.edition &&
              reference.citation === source.citation &&
              reference.url === source.url,
          )
        ) {
          references.push(source);
        }
        groups.set(source.source_revision_id, references);
      }
    }
  }
  return Array.from(groups, ([id, references]) => ({ id, references }));
}

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

export function SourceReferences({ sources }: { sources: SourceGroup[] }) {
  if (!sources.length) return null;
  return (
    <section
      className={styles.sources}
      id="reading-sources"
      aria-labelledby="reading-sources-title"
    >
      <span className={styles.eyebrow}>もっと確かめたいときに</span>
      <h2 id="reading-sources-title">参照資料</h2>
      <p className={styles.sectionIntroduction}>
        要約から元の文章へ。参照した箇所を手がかりに、資料を読んでみる。
      </p>
      <ol className={styles.sourceList}>
        {sources.map(({ id, references }, index) => {
          const first = references[0];
          const title = first.citation.split(" — ")[0];
          const locators = [
            ...new Set(references.map((source) => source.locator)),
          ];
          const citations = [
            ...new Set(references.map((source) => source.citation)),
          ];
          const editions = [
            ...new Set(
              references
                .map((source) => source.edition)
                .filter((edition): edition is string => Boolean(edition)),
            ),
          ];
          const urls = [
            ...new Set(
              references
                .map((source) => httpsSourceUrl(source.url))
                .filter((url): url is string => Boolean(url)),
            ),
          ];
          return (
            <li className={styles.source} key={id}>
              <span className={styles.sourceNumber} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className={styles.sourceBody}>
                <h3>{title}</h3>
                <span className={styles.locatorLabel}>参照した箇所</span>
                <ul className={styles.locators}>
                  {locators.map((locator) => (
                    <li key={locator}>{locator}</li>
                  ))}
                </ul>
                <div className={styles.sourceActions}>
                  {urls.map((url, urlIndex) => (
                    <a href={url} rel="noopener noreferrer" key={url}>
                      {urls.length > 1
                        ? `掲載元 ${urlIndex + 1}`
                        : "掲載元を読む"}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  ))}
                </div>
                <details className={styles.sourceDetails}>
                  <summary>著者・版の情報</summary>
                  <div>
                    {citations.map((citation) => (
                      <p key={citation}>{citation}</p>
                    ))}
                    {editions.map((edition) => (
                      <p key={edition}>版：{edition}</p>
                    ))}
                  </div>
                </details>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
