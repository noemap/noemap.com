import { nodeTypeNames, type NodeType } from "../../domain/nodes";
import catalog from "../../data/entry-catalog.json";
import styles from "./SearchForm.module.css";
export function SearchForm({
  query = "",
  type,
  theme = "",
  discipline = "",
  action = "/search",
  compact = false,
}: {
  query?: string;
  type?: NodeType;
  theme?: string;
  discipline?: string;
  action?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <form
        action={action}
        method="get"
        className="exploration-search"
        role="search"
      >
        <label>
          名前・別名から探す
          <input
            name="q"
            type="search"
            defaultValue={query}
            maxLength={120}
            placeholder="問い、人物、概念の名前"
          />
        </label>
        {type ? <input name="type" type="hidden" value={type} /> : null}
        {theme ? <input name="theme" type="hidden" value={theme} /> : null}
        {discipline ? (
          <input name="discipline" type="hidden" value={discipline} />
        ) : null}
        <button type="submit">検索</button>
      </form>
    );
  }

  const conditionCount = [type, theme, discipline].filter(Boolean).length;
  const clearParams = new URLSearchParams();
  if (query) clearParams.set("q", query);
  const clearHref = `${action}${clearParams.size ? `?${clearParams}` : ""}`;

  return (
    <form
      action={action}
      method="get"
      className={styles.searchForm}
      role="search"
    >
      <div className={styles.searchRow}>
        <label className={styles.queryField}>
          気になる言葉で探す
          <input
            name="q"
            type="search"
            defaultValue={query}
            maxLength={120}
            placeholder="例：自分、ヒューム、記憶"
          />
        </label>
        <button className={styles.searchButton} type="submit">
          探す
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
        </button>
      </div>
      <p className={styles.hint}>名前・別名・要約から探せます。</p>
      <details className={styles.filters} open={conditionCount > 0}>
        <summary className={styles.filterSummary}>
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M4 7h16M4 17h16" />
            <circle cx="9" cy="7" r="2" fill="var(--paper)" />
            <circle cx="15" cy="17" r="2" fill="var(--paper)" />
          </svg>
          <span>絞り込み</span>
          {conditionCount ? (
            <span className={styles.conditionCount}>{conditionCount}条件</span>
          ) : null}
          <span className={styles.chevron} aria-hidden="true">
            ⌄
          </span>
        </summary>
        <div className={styles.filterFields}>
          <label className={styles.filterField}>
            ページの種類
            <select name="type" defaultValue={type ?? ""}>
              <option value="">すべて</option>
              {Object.entries(nodeTypeNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterField}>
            テーマ
            <select name="theme" defaultValue={theme}>
              <option value="">すべて</option>
              {catalog.themes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterField}>
            学問・分野
            <select name="discipline" defaultValue={discipline}>
              <option value="">すべて</option>
              {catalog.disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.filterFooter}>
          <p>条件を選んだら「探す」を押してください。</p>
          {conditionCount ? <a href={clearHref}>絞り込みを解除</a> : null}
        </div>
      </details>
    </form>
  );
}
