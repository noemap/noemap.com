import { nodeTypeNames, type NodeType } from "../../domain/nodes";
import catalog from "../../data/entry-catalog.json";
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
      {!compact ? (
        <>
          <label>
            種類
            <select name="type" defaultValue={type ?? ""}>
              <option value="">すべて</option>
              {Object.entries(nodeTypeNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
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
          <label>
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
        </>
      ) : null}
      <button type="submit">検索</button>
    </form>
  );
}
