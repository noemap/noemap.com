import "server-only";
import { value } from "./database";
import { isLocalFictional } from "./mode";
import { getRealDataset } from "./real-dataset";
import { isUuid } from "./public";
import type {
  NodeDocument,
  NodeSummary,
  NeighborPage,
  NodePage,
  TimelinePage,
} from "../domain/nodes";

export interface ResolvedNode {
  id: string;
  href: string;
  redirect: boolean;
}
export interface ExplorationHome {
  root: NodeSummary | null;
  questions: NodeSummary[];
  neighbors: NeighborPage;
}
const collections = new Set(["questions", "people", "concepts", "books"]);
const types = new Set(["question", "person", "concept", "work"]);
const emptyNeighbors = (offset = 0): NeighborPage => ({
  items: [],
  offset,
  has_more: false,
});
function validOffset(offset: number) {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= 10000;
}
export async function resolveNode(collection: string, key: string) {
  if (!isLocalFictional())
    return (await getRealDataset()).resolveNode(collection, key);
  if (
    !collections.has(collection) ||
    (!isUuid(key) && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) ||
    key.length > 96
  )
    return null;
  return value<ResolvedNode | null>("SELECT api.resolve_node($1,$2,'ja')", [
    collection,
    key,
  ]);
}
export async function publicNode(id: string) {
  if (!isLocalFictional()) return (await getRealDataset()).publicNode(id);
  if (!isUuid(id)) return null;
  return value<NodeDocument | null>(
    `WITH document AS MATERIALIZED (SELECT api.public_node($1,'ja') AS data)
     SELECT CASE WHEN data IS NULL THEN NULL ELSE
       data || jsonb_build_object('dates',api.public_dates($1,'ja')) END FROM document`,
    [id],
  );
}
// A page and its relations are projected in one SQL statement/snapshot.
// A correction or revocation cannot mix endpoints from different snapshots.
export async function nodePage(id: string, offset = 0) {
  if (!isLocalFictional()) return (await getRealDataset()).nodePage(id, offset);
  if (!isUuid(id) || !validOffset(offset)) return null;
  return value<{
    document: NodeDocument;
    neighbors: NeighborPage;
  } | null>(
    `WITH document AS MATERIALIZED (SELECT api.public_node($1,'ja') AS data)
     SELECT CASE WHEN data IS NULL THEN NULL ELSE jsonb_build_object(
       'document',data || jsonb_build_object('dates',api.public_dates($1,'ja')),
       'neighbors',api.public_neighbors($1,'ja',20,$2)) END FROM document`,
    [id, offset],
  );
}
export async function neighbors(id: string, offset = 0) {
  if (!isLocalFictional())
    return (await getRealDataset()).neighbors(id, offset);
  if (!isUuid(id) || !validOffset(offset)) return emptyNeighbors();
  return value<NeighborPage>("SELECT api.public_neighbors($1,'ja',20,$2)", [
    id,
    offset,
  ]);
}
export async function searchNodes(q: string, type?: string, offset = 0) {
  if (!isLocalFictional())
    return (await getRealDataset()).searchNodes(q, type, offset);
  if (!validOffset(offset) || (type && !types.has(type)))
    return { items: [], offset: 0, has_more: false } satisfies NodePage;
  const query = q.normalize("NFKC").trim().slice(0, 160);
  return value<NodePage>("SELECT api.public_search($1,'ja',$2,20,$3)", [
    query,
    type || null,
    offset,
  ]);
}
export async function explorationHome() {
  if (!isLocalFictional()) return (await getRealDataset()).explorationHome();
  return value<ExplorationHome>(
    `WITH home AS MATERIALIZED (SELECT api.public_home('ja') AS data)
     SELECT data || jsonb_build_object('neighbors', CASE WHEN data->'root' = 'null'::jsonb
       THEN jsonb_build_object('items','[]'::jsonb,'offset',0,'has_more',false)
       ELSE api.public_neighbors((data->'root'->>'id')::uuid,'ja',20,0) END) FROM home`,
  );
}
export async function timelineNodes(offset = 0) {
  if (!isLocalFictional())
    return (await getRealDataset()).timelineNodes(offset);
  if (!validOffset(offset))
    return { items: [], offset: 0, has_more: false } satisfies TimelinePage;
  return value<TimelinePage>("SELECT api.public_timeline('ja',20,$1)", [
    offset,
  ]);
}
