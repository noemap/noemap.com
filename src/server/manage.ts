import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { manageClient } from "./supabase";
import { validateEditableDocument } from "../domain/editable";
import type { ProvisionalReleaseInput } from "../domain/provisional";

export interface DatasetSnapshot {
  id: string;
  document: ProvisionalReleaseInput;
  created_at: string;
  reason: string;
  actor_label: string;
}
export interface DatasetHistoryItem {
  id: string;
  created_at: string;
  reason: string;
  actor_label: string;
  status: string;
}
export interface DatasetEditorState {
  generation: number;
  current: DatasetSnapshot;
  draft: DatasetSnapshot | null;
  history: DatasetHistoryItem[];
}
export class ManageError extends Error {
  constructor(
    public readonly code:
      "conflict" | "unavailable" | "unauthorized" | "invalid",
    message: string,
  ) {
    super(message);
  }
}
const object = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));
const nonempty = (v: unknown): v is string =>
  typeof v === "string" && Boolean(v.trim());

function snapshot(value: unknown): DatasetSnapshot {
  if (
    !object(value) ||
    !nonempty(value.id) ||
    !nonempty(value.created_at) ||
    typeof value.reason !== "string" ||
    typeof value.actor_label !== "string"
  )
    throw new ManageError(
      "unavailable",
      "保存された版を読み取れませんでした。",
    );
  validateEditableDocument(value.document);
  return value as unknown as DatasetSnapshot;
}
function state(value: unknown): DatasetEditorState {
  if (
    !object(value) ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 0 ||
    !Array.isArray(value.history)
  )
    throw new ManageError("unavailable", "編集データを読み取れませんでした。");
  const current = snapshot(value.current);
  const draft = value.draft === null ? null : snapshot(value.draft);
  const history = value.history.map((item) => {
    if (
      !object(item) ||
      !nonempty(item.id) ||
      !nonempty(item.created_at) ||
      typeof item.reason !== "string" ||
      typeof item.actor_label !== "string" ||
      typeof item.status !== "string"
    )
      throw new ManageError("unavailable", "版の履歴を読み取れませんでした。");
    return item as unknown as DatasetHistoryItem;
  });
  return { generation: Number(value.generation), current, draft, history };
}

// React.cache only deduplicates within this server render, never across requests.
export const authenticatedEditor = cache(async () => {
  const client = await manageClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || data.user.is_anonymous) return null;
  const membership = await client.rpc("noemap_editor_identity");
  if (membership.error)
    throw new ManageError(
      "unavailable",
      "編集者の登録を確認できませんでした。",
    );
  if (
    !object(membership.data) ||
    membership.data.user_id !== data.user.id ||
    !nonempty(membership.data.label)
  )
    return null;
  return { client, user_id: data.user.id, label: membership.data.label };
});
export async function requireEditor() {
  const actor = await authenticatedEditor();
  if (!actor) redirect("/manage/login");
  return actor;
}
export const readEditor = cache(async () => {
  const actor = await requireEditor();
  const { data, error } = await actor.client.rpc("noemap_read_editor");
  if (error)
    throw new ManageError(
      "unavailable",
      "編集データを取得できませんでした。少し待ってから再度開いてください。",
    );
  return state(data);
});
export async function readSnapshot(id: string) {
  const actor = await requireEditor();
  const { data, error } = await actor.client.rpc("noemap_read_snapshot", {
    p_snapshot_id: id,
  });
  if (error)
    throw new ManageError("unavailable", "この版を取得できませんでした。");
  return data === null ? null : snapshot(data);
}
export async function writeDataset(
  name: "noemap_save_draft" | "noemap_publish_draft" | "noemap_restore_draft",
  args: Record<string, unknown>,
) {
  const actor = await authenticatedEditor();
  if (!actor)
    throw new ManageError(
      "unauthorized",
      "ログインし直してから保存してください。",
    );
  const { error } = await actor.client.rpc(name, args);
  if (error?.code === "40001")
    throw new ManageError(
      "conflict",
      "別の変更が先に保存されました。入力はこの画面に残しています。最新の版を別タブで確認し、必要な変更を移して保存してください。",
    );
  if (error)
    throw new ManageError(
      "unavailable",
      "保存できませんでした。入力を確認して再度お試しください。",
    );
}
export function workingDocument(value: DatasetEditorState) {
  return value.draft?.document ?? value.current.document;
}
export const manageStatusNames: Record<string, string> = {
  draft: "下書き",
  published: "公開版",
  current: "現在の公開版",
  superseded: "過去の版",
  history: "過去の版",
};
