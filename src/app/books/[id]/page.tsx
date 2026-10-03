import { NodeRoute } from "../../../components/nodes/NodeRoute";
import type { PageQuery } from "../../../domain/nodes";
export default function Books(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageQuery>;
}) {
  return <NodeRoute collection="books" {...props} />;
}
