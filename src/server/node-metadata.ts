import "server-only";
import type { Metadata } from "next";
import type { NodeCollection } from "../domain/nodes";
import { resolveNode, publicNode } from "./exploration";
export async function nodeMetadata(
  collection: NodeCollection,
  params: Promise<{ id: string }>,
): Promise<Metadata> {
  const { id } = await params;
  const resolved = await resolveNode(collection, id);
  const node = resolved ? await publicNode(resolved.id) : null;
  if (!node)
    return {
      title: "ページが見つかりません — NOEMAP",
      robots: { index: false, follow: false },
    };
  const url = `https://noemap.com${node.href}`;
  return {
    title: `${node.title} — NOEMAP`,
    description: node.summary,
    alternates: { canonical: url },
    openGraph: {
      title: node.title,
      description: node.summary,
      url,
      type: "article",
      locale: "ja_JP",
      siteName: "NOEMAP",
    },
  };
}
