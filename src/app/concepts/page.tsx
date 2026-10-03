import { CollectionView } from "../../components/exploration/CollectionView";
import type { PageQuery } from "../../domain/nodes";
export default function Concepts({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  return <CollectionView type="concept" searchParams={searchParams} />;
}
