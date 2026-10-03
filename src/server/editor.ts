import "server-only";
import { redirect } from "next/navigation";
import { session } from "./session";
import { value } from "./database";
import type { Listing, RevisionDetail } from "../domain/types";
export async function editor() {
  const actor = await session();
  if (!actor) redirect("/editor/login");
  return actor;
}
export async function listings(id: string) {
  return value<Listing[]>("SELECT api.editor_list()", [], id);
}
export async function search(
  id: string,
  query = "",
  kind: string | null = null,
  state: string | null = null,
  offset = 0,
) {
  return value<{ items: Listing[]; total: number }>(
    "SELECT api.editor_search($1,$2,$3,$4)",
    [query, kind, state, offset],
    id,
  );
}
export async function detail(id: string, revision: string) {
  return value<RevisionDetail | null>(
    "SELECT api.editor_revision($1)",
    [revision],
    id,
  );
}
export const errorMessages: Record<string, string> = {
  invalid: "入力を確認してください。必要な項目が不足している可能性があります。",
  conflict:
    "別の更新が先に行われました。画面を更新して、内容を確認してください。",
  dependency:
    "対象または根拠に未公開・停止中の項目があります。関連する項目を確認してください。",
  permission: "この操作を行う権限がありません。",
  failed:
    "保存できませんでした。本文、根拠、確認状況を見直してから再度お試しください。",
};
