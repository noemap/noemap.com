import type { NodeSummary, NodePage } from "./nodes";

export interface Theme {
  id: string;
  slug: string;
  title: string;
  shortLabel: string;
  prompt: string;
  icon: string;
  order: number;
  showOnHome: boolean;
}
export interface Discipline {
  id: string;
  title: string;
}
export interface EntryGroup {
  id: string;
  title: string;
  themeIds: string[];
  overviewNodeId?: string;
  questionIds: string[];
  orderByTheme: Record<string, number | undefined>;
}
export interface NodeClassification {
  nodeId: string;
  themeIds: string[];
  disciplineIds: string[];
  updatedAt: string;
}
export interface EntryCatalog {
  schemaVersion: number;
  themes: Theme[];
  disciplines: Discipline[];
  groups: EntryGroup[];
  classifications: NodeClassification[];
  routes: {
    id: string;
    title: string;
    description: string;
    nodeIds: string[];
  }[];
}
export interface PublicEntryGroup {
  id: string;
  title: string;
  overview: NodeSummary | null;
  questions: NodeSummary[];
}
export interface PublicTheme extends Theme {
  groups: PublicEntryGroup[];
}
export interface EntrySelection {
  theme: string | null;
  group: string | null;
}

// The caller supplies ONLY its current public projection. A withdrawn or draft
// node cannot be revived by navigation metadata, overview links or route steps.
export function projectEntry(
  catalog: EntryCatalog,
  publicNodes: NodeSummary[],
) {
  const nodes = new Map(publicNodes.map((n) => [n.id, n]));
  return catalog.themes
    .filter((t) => t.showOnHome)
    .sort((a, b) => a.order - b.order)
    .map((theme) => ({
      ...theme,
      groups: catalog.groups
        .filter((g) => g.themeIds.includes(theme.id))
        .sort(
          (a, b) =>
            (a.orderByTheme[theme.id] ?? 0) - (b.orderByTheme[theme.id] ?? 0),
        )
        .map((group) => ({
          id: group.id,
          title: group.title,
          overview:
            group.overviewNodeId &&
            nodes.get(group.overviewNodeId)?.type === "question"
              ? nodes.get(group.overviewNodeId)!
              : null,
          questions: group.questionIds
            .map((id) => nodes.get(id))
            .filter((n): n is NodeSummary => n?.type === "question"),
        }))
        .filter((group) => group.questions.length > 0),
    }));
}
export function entrySelection(
  themes: PublicTheme[],
  theme?: string | null,
  group?: string | null,
): EntrySelection {
  const selected = themes.find((t) => t.id === theme && t.groups.length);
  if (!selected) return { theme: null, group: null };
  return {
    theme: selected.id,
    group: selected.groups.some((g) => g.id === group) ? group! : null,
  };
}
export function classificationFor(catalog: EntryCatalog, id: string) {
  const classification = catalog.classifications.find((c) => c.nodeId === id);
  return {
    themes: catalog.themes.filter((t) =>
      classification?.themeIds.includes(t.id),
    ),
    disciplines: catalog.disciplines.filter((d) =>
      classification?.disciplineIds.includes(d.id),
    ),
    updatedAt: classification?.updatedAt ?? null,
  };
}
export function filterEntryNodes(
  nodes: NodeSummary[],
  catalog: EntryCatalog,
  query: {
    q?: string;
    type?: string;
    theme?: string;
    discipline?: string;
    offset?: number;
  },
): NodePage {
  const text = (query.q ?? "").normalize("NFKC").toLocaleLowerCase("ja").trim();
  const metadata = new Map(catalog.classifications.map((c) => [c.nodeId, c]));
  const filtered = nodes.filter((n) => {
    const c = metadata.get(n.id);
    return (
      (!query.type || n.type === query.type) &&
      (!query.theme || c?.themeIds.includes(query.theme)) &&
      (!query.discipline || c?.disciplineIds.includes(query.discipline)) &&
      (!text ||
        [n.title, ...n.aliases, n.summary].some((v) =>
          v.normalize("NFKC").toLocaleLowerCase("ja").includes(text),
        ))
    );
  });
  const offset = query.offset ?? 0;
  const rank = (n: NodeSummary) => {
    const normalized = (v: string) =>
      v.normalize("NFKC").toLocaleLowerCase("ja");
    const title = normalized(n.title),
      aliases = n.aliases.map(normalized);
    const values = [title, ...aliases];
    return !text || title === text
      ? 0
      : aliases.includes(text)
        ? 1
        : values.some((v) => v.startsWith(text))
          ? 2
          : values.some((v) => v.includes(text))
            ? 3
            : 4;
  };
  filtered.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.title.localeCompare(b.title, "ja") ||
      a.id.localeCompare(b.id),
  );
  return {
    items: filtered.slice(offset, offset + 20),
    offset,
    has_more: filtered.length > offset + 20,
  };
}
export function validateEntryCatalog(
  catalog: EntryCatalog,
  allNodes: NodeSummary[],
) {
  const unique = (values: string[], what: string) => {
    if (new Set(values).size !== values.length)
      throw Error(`Duplicate ${what}`);
  };
  unique(
    catalog.themes.map((t) => t.id),
    "theme",
  );
  unique(
    catalog.themes.map((t) => t.slug),
    "theme slug",
  );
  unique(
    catalog.groups.map((g) => g.id),
    "entry group",
  );
  unique(
    catalog.disciplines.map((d) => d.id),
    "discipline",
  );
  unique(
    catalog.classifications.map((c) => c.nodeId),
    "classification",
  );
  unique(
    catalog.routes.map((r) => r.id),
    "route",
  );
  const nodes = new Map(allNodes.map((n) => [n.id, n]));
  const themes = new Set(catalog.themes.map((t) => t.id));
  const disciplines = new Set(catalog.disciplines.map((d) => d.id));
  const node = (id: string, type?: string) => {
    if (!nodes.has(id) || (type && nodes.get(id)!.type !== type))
      throw Error(`Missing or wrong-type node ${id}`);
  };
  const icons = new Set([
    "activity",
    "brain",
    "users",
    "landmark",
    "scale",
    "sun",
    "hourglass",
    "compass",
  ]);
  for (const theme of catalog.themes)
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(theme.slug) || !icons.has(theme.icon))
      throw Error("Invalid theme");
  for (const group of catalog.groups) {
    unique(group.questionIds, "question reference");
    for (const theme of group.themeIds)
      if (!themes.has(theme)) throw Error("Missing theme");
    for (const id of group.questionIds) node(id, "question");
    if (group.overviewNodeId) node(group.overviewNodeId, "question");
  }
  for (const c of catalog.classifications) {
    node(c.nodeId);
    for (const theme of c.themeIds)
      if (!themes.has(theme)) throw Error("Missing theme");
    for (const d of c.disciplineIds)
      if (!disciplines.has(d)) throw Error("Missing discipline");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.updatedAt)) throw Error("Invalid date");
  }
  for (const route of catalog.routes) {
    unique(route.nodeIds, "route step");
    for (const id of route.nodeIds) node(id);
  }
}
