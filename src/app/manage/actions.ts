"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { applyManageForm, ManageInputError } from "../../domain/manage-forms";
import {
  authenticatedEditor,
  ManageError,
  readEditor,
  workingDocument,
  writeDataset,
} from "../../server/manage";

export interface ManageActionState {
  error?: string;
  code?: string;
}
export async function mutateDataset(
  _previous: ManageActionState,
  form: FormData,
): Promise<ManageActionState> {
  let returnTo = "/manage";
  try {
    const requestHeaders = await headers();
    const origin = requestHeaders.get("origin");
    const host =
      requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (!origin || !host || new URL(origin).host !== host)
      throw new ManageError(
        "unauthorized",
        "この画面からもう一度操作してください。",
      );
    if (!(await authenticatedEditor()))
      throw new ManageError(
        "unauthorized",
        "ログインし直してから保存してください。",
      );
    const expected = String(form.get("generation") ?? "");
    const operationId = String(form.get("operation_id") ?? "");
    const reason = String(form.get("reason") ?? "").trim();
    if (
      !/^\d{1,12}$/.test(expected) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        operationId,
      ) ||
      !reason ||
      reason.length > 1000
    )
      throw new ManageInputError("変更理由を入力してから保存してください。");
    const current = await readEditor();
    if (current.generation !== Number(expected))
      throw new ManageError(
        "conflict",
        "別の変更が先に保存されました。入力はこの画面に残しています。最新の版を別タブで確認し、必要な変更を移して保存してください。",
      );
    const common = {
      p_expected_generation: Number(expected),
      p_reason: reason,
      p_operation_id: operationId,
    };
    const operation = String(form.get("operation") ?? "");
    if (
      ["publish", "restore", "withdraw-source"].includes(operation) &&
      form.get("confirm") !== "1"
    )
      throw new ManageInputError(
        "操作の内容を確認してチェックを付けてください。",
      );
    if (operation === "publish") {
      if (!current.draft)
        throw new ManageInputError("公開へ反映する下書きがありません。");
      await writeDataset("noemap_publish_draft", common);
    } else if (operation === "restore") {
      const id = String(form.get("target") ?? "");
      if (!current.history.some((item) => item.id === id))
        throw new ManageInputError("復元する版を確認してください。");
      await writeDataset("noemap_restore_draft", {
        ...common,
        p_snapshot_id: id,
      });
    } else {
      const next = applyManageForm(workingDocument(current), form);
      returnTo = next.returnTo;
      await writeDataset("noemap_save_draft", {
        ...common,
        p_document: next.document,
      });
    }
  } catch (error) {
    if (error instanceof ManageError || error instanceof ManageInputError)
      return {
        error: error.message,
        code: error instanceof ManageError ? error.code : "invalid",
      };
    return {
      error:
        "保存できませんでした。入力をこの画面に残しています。接続を確認して再度お試しください。",
      code: "unavailable",
    };
  }
  revalidatePath("/manage", "layout");
  revalidatePath("/", "layout");
  redirect(`${returnTo}?saved=1`);
}
