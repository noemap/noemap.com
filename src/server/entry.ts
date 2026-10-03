import "server-only";
import { cache } from "react";
import catalogData from "../data/entry-catalog.json";
import {
  projectEntry,
  filterEntryNodes,
  type EntryCatalog,
} from "../domain/entry";
import { searchNodes } from "./exploration";
import type { NodeSummary } from "../domain/nodes";
export const entryCatalog: EntryCatalog = catalogData;
export const publicEntryData = cache(async () => {
  const nodes: NodeSummary[] = [];
  for (let offset = 0; offset <= 10000; offset += 20) {
    const page = await searchNodes("", undefined, offset);
    nodes.push(...page.items);
    if (!page.has_more) break;
    if (offset === 10000)
      throw Error("Entry catalogue exceeds the current paging boundary");
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    nodes,
    themes: projectEntry(entryCatalog, nodes),
    routes: entryCatalog.routes
      .filter((r) => r.nodeIds.every((id) => byId.has(id)))
      .map((r) => ({ ...r, nodes: r.nodeIds.map((id) => byId.get(id)!) })),
  };
});
export async function searchEntryNodes(
  query: Parameters<typeof filterEntryNodes>[2],
) {
  return filterEntryNodes((await publicEntryData()).nodes, entryCatalog, query);
}
