import { CollectionView } from "../../components/exploration/CollectionView";
import type { PageQuery } from "../../domain/nodes";
export default function People({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  return <CollectionView type="person" searchParams={searchParams} />;
}
