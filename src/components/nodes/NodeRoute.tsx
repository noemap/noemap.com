import { connection } from "next/server";
import { notFound, permanentRedirect } from "next/navigation";
import { nodePage, resolveNode } from "../../server/exploration";
import {
  queryOffset,
  type NodeCollection,
  type PageQuery,
} from "../../domain/nodes";
import { NodeView } from "./NodeView";
export async function NodeRoute({
  collection,
  params,
  searchParams,
}: {
  collection: NodeCollection;
  params: Promise<{ id: string }>;
  searchParams: Promise<PageQuery>;
}) {
  await connection();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const resolved = await resolveNode(collection, id);
  if (!resolved) notFound();
  const offset = queryOffset(query.offset);
  if (resolved.redirect)
    permanentRedirect(`${resolved.href}${offset ? `?offset=${offset}` : ""}`);
  const page = await nodePage(resolved.id, offset);
  if (!page) notFound();
  return <NodeView node={page.document} neighbors={page.neighbors} />;
}
