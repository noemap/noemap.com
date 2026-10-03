import { NodeRoute } from "../../../components/nodes/NodeRoute";
import type { PageQuery } from "../../../domain/nodes";
export default function Books(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageQuery>;
}) {
  return <NodeRoute collection="books" {...props} />;
}

import { nodeMetadata } from "../../../server/node-metadata";
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return nodeMetadata("books", params);
}
