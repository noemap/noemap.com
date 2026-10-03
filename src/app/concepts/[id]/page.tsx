import { NodeRoute } from "../../../components/nodes/NodeRoute";
import type { PageQuery } from "../../../domain/nodes";
export default function Concepts(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageQuery>;
}) {
  return <NodeRoute collection="concepts" {...props} />;
}

import { nodeMetadata } from "../../../server/node-metadata";
export function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return nodeMetadata("concepts", params);
}
