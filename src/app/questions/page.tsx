import { CollectionView } from "../../components/exploration/CollectionView";
import type { PageQuery } from "../../domain/nodes";
export default function Questions({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  return <CollectionView type="question" searchParams={searchParams} />;
}
