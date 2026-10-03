import { connection } from "next/server";
import { notFound, permanentRedirect } from "next/navigation";
import { nodePage, resolveNode } from "../../server/exploration";
import {
  queryOffset,
  type NodeCollection,
  type PageQuery,
} from "../../domain/nodes";
import { NodeView } from "./NodeView";
import { entryCatalog, publicEntryData } from "../../server/entry";
import { classificationFor } from "../../domain/entry";
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
  const [page, entry] = await Promise.all([
    nodePage(resolved.id, offset),
    publicEntryData(),
  ]);
  if (!page) notFound();
  return (
    <NodeView
      node={page.document}
      neighbors={page.neighbors}
      classification={classificationFor(entryCatalog, resolved.id)}
      readingRoutes={entry.routes.filter((r) =>
        r.nodeIds.includes(resolved.id),
      )}
    />
  );
}
