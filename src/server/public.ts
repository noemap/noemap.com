import "server-only";
import { value } from "./database";
import { isLocalFictional } from "./mode";
import { realDataset } from "./real-dataset";
import type { Article, CatalogItem, PublicEvidence } from "../domain/types";
export const uuid = (input: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    input,
  );
export const isUuid = uuid;
export async function catalog() {
  if (!isLocalFictional()) return realDataset.catalog();
  return value<CatalogItem[]>("SELECT api.public_catalog('ja')");
}
export async function article(id: string) {
  if (!isLocalFictional()) return realDataset.article(id);
  return uuid(id)
    ? value<Article | null>("SELECT api.public_node($1,'ja')->'article'", [id])
    : null;
}
export async function evidence(id: string) {
  if (!isLocalFictional()) return realDataset.evidence(id);
  return uuid(id)
    ? value<PublicEvidence | null>("SELECT api.read_evidence($1,'ja')", [id])
    : null;
}
