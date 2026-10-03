import { CollectionView } from "../../components/exploration/CollectionView";
import type { PageQuery } from "../../domain/nodes";
export default function Books({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  return <CollectionView type="work" searchParams={searchParams} />;
}
