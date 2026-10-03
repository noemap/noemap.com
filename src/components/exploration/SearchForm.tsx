import { nodeTypeNames, type NodeType } from "../../domain/nodes";
export function SearchForm({
  query = "",
  type,
}: {
  query?: string;
  type?: NodeType;
}) {
  return (
    <form
      action="/search"
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
      <button type="submit">検索</button>
    </form>
  );
}
