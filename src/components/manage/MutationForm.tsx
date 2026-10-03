"use client";
import { useActionState, useId, useState } from "react";
import { mutateDataset } from "../../app/manage/actions";

export interface FormOption {
  value: string;
  label: string;
}
export interface ManageField {
  name: string;
  label: string;
  kind?: "text" | "textarea" | "select" | "choices" | "hidden" | "checkbox";
  value: string | string[];
  options?: FormOption[];
  required?: boolean;
  maxLength?: number;
  note?: string;
  when?: { field: string; value: string };
}
export interface FormEvidence {
  source: string;
  locator: string;
  role: string;
}
interface Props {
  generation: number;
  operationId: string;
  operation: string;
  batch?: string;
  target?: string;
  fields?: ManageField[];
  evidence?: {
    values: FormEvidence[];
    options: FormOption[];
    exceptQuestion?: boolean;
  };
  submitLabel?: string;
}
export function MutationForm({
  generation,
  operationId,
  operation,
  batch = "",
  target = "",
  fields = [],
  evidence,
  submitLabel = "下書きを保存",
}: Props) {
  const [result, action, pending] = useActionState(mutateDataset, {});
  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    Object.fromEntries(fields.map((field) => [field.name, field.value])),
  );
  const [reason, setReason] = useState("");
  // The generation belongs to the displayed inputs. It must not silently change
  // beneath unsaved edits when another server render refreshes this component.
  const [expected] = useState(generation);
  const [requestId] = useState(operationId);
  const [references, setReferences] = useState<
    (FormEvidence & { rowKey: string })[]
  >(() =>
    evidence?.values.length
      ? evidence.values.map((value, index) => ({
          ...value,
          rowKey: String(index),
        }))
      : [{ source: "", locator: "", role: "support", rowKey: "0" }],
  );
  const prefix = useId();
  const showEvidence =
    evidence && (!evidence.exceptQuestion || values.type !== "question");
  return (
    <form action={action} className="manage-form">
      <input type="hidden" name="generation" value={expected} />
      <input type="hidden" name="operation_id" value={requestId} />
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="batch" value={batch} />
      <input type="hidden" name="target" value={target} />
      {showEvidence ? (
        <input
          type="hidden"
          name="evidence"
          value={JSON.stringify(
            references.map(({ source, locator, role }) => ({
              source,
              locator,
              role,
            })),
          )}
        />
      ) : null}
      {result.error ? (
        <div className="notice warning" role="alert">
          <p>{result.error}</p>
          {result.code === "conflict" ? (
            <a href="/manage" target="_blank" rel="noopener noreferrer">
              最新の編集状態を別タブで開く
            </a>
          ) : null}
          {result.code === "unauthorized" ? (
            <a href="/manage/login" target="_blank" rel="noopener noreferrer">
              ログイン画面を別タブで開く
            </a>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={pending} className="manage-fields">
        {fields.map((field) => {
          if (field.when && values[field.when.field] !== field.when.value)
            return null;
          const id = `${prefix}-${field.name}`;
          const value = values[field.name] ?? "";
          const update = (next: string | string[]) =>
            setValues((old) => ({ ...old, [field.name]: next }));
          if (field.kind === "hidden")
            return (
              <input
                key={field.name}
                type="hidden"
                name={field.name}
                value={String(value)}
              />
            );
          if (field.kind === "choices")
            return (
              <fieldset className="manage-choices" key={field.name}>
                <legend>
                  {field.label}
                  {field.required ? "（必須）" : ""}
                </legend>
                {field.note ? <p className="field-note">{field.note}</p> : null}
                <div className="manage-choice-list">
                  {(field.options ?? []).map((option) => (
                    <label className="check" key={option.value}>
                      <input
                        type="checkbox"
                        name={field.name}
                        value={option.value}
                        checked={
                          Array.isArray(value) && value.includes(option.value)
                        }
                        onChange={(event) =>
                          update(
                            event.target.checked
                              ? [
                                  ...(Array.isArray(value) ? value : []),
                                  option.value,
                                ]
                              : (Array.isArray(value) ? value : []).filter(
                                  (v) => v !== option.value,
                                ),
                          )
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          if (field.kind === "checkbox")
            return (
              <label className="check" key={field.name}>
                <input
                  type="checkbox"
                  name={field.name}
                  value="1"
                  checked={value === "1"}
                  required={field.required}
                  onChange={(event) => update(event.target.checked ? "1" : "")}
                />
                <span>{field.label}</span>
              </label>
            );
          return (
            <div key={field.name}>
              <label htmlFor={id}>
                {field.label}
                {field.required ? "（必須）" : ""}
              </label>
              {field.kind === "textarea" ? (
                <textarea
                  id={id}
                  name={field.name}
                  value={String(value)}
                  required={field.required}
                  maxLength={field.maxLength ?? 2000}
                  onChange={(event) => update(event.target.value)}
                />
              ) : field.kind === "select" ? (
                <select
                  id={id}
                  name={field.name}
                  value={String(value)}
                  required={field.required}
                  onChange={(event) => update(event.target.value)}
                >
                  <option value="">選んでください</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  name={field.name}
                  value={String(value)}
                  required={field.required}
                  maxLength={field.maxLength ?? 1000}
                  onChange={(event) => update(event.target.value)}
                />
              )}
              {field.note ? <p className="field-note">{field.note}</p> : null}
            </div>
          );
        })}
        {showEvidence ? (
          <fieldset className="manage-evidence">
            <legend>資料と該当箇所（必須）</legend>
            <p className="field-note">
              要約を支える箇所を指定します。原文の全文は貼り付けません。留保の資料も残してください。
            </p>
            {references.map((reference, index) => (
              <div className="manage-reference" key={reference.rowKey}>
                <label htmlFor={`${prefix}-source-${index}`}>
                  資料 {index + 1}
                </label>
                <select
                  id={`${prefix}-source-${index}`}
                  required
                  value={reference.source}
                  onChange={(event) =>
                    setReferences((old) =>
                      old.map((item, i) =>
                        i === index
                          ? { ...item, source: event.target.value }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="">資料を選んでください</option>
                  {evidence.options.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label}
                    </option>
                  ))}
                </select>
                <label htmlFor={`${prefix}-locator-${index}`}>
                  資料内の位置
                </label>
                <input
                  id={`${prefix}-locator-${index}`}
                  required
                  maxLength={1000}
                  value={reference.locator}
                  placeholder="章・節・段落・頁など"
                  onChange={(event) =>
                    setReferences((old) =>
                      old.map((item, i) =>
                        i === index
                          ? { ...item, locator: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
                <label htmlFor={`${prefix}-role-${index}`}>
                  この資料の役割
                </label>
                <select
                  id={`${prefix}-role-${index}`}
                  value={reference.role}
                  onChange={(event) =>
                    setReferences((old) =>
                      old.map((item, i) =>
                        i === index
                          ? { ...item, role: event.target.value }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="support">記述を支える</option>
                  <option value="qualification">留保・補足</option>
                  <option value="counter">反対根拠</option>
                </select>
                {references.length > 1 ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setReferences((old) => old.filter((_, i) => i !== index))
                    }
                  >
                    この資料指定を外す
                  </button>
                ) : null}
              </div>
            ))}
            {references.length < 30 ? (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setReferences((old) => [
                    ...old,
                    {
                      source: "",
                      locator: "",
                      role: "support",
                      rowKey: crypto.randomUUID(),
                    },
                  ])
                }
              >
                資料指定を追加
              </button>
            ) : null}
          </fieldset>
        ) : null}
        <label htmlFor={`${prefix}-reason`}>変更理由（必須）</label>
        <textarea
          className="manage-reason"
          id={`${prefix}-reason`}
          name="reason"
          required
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="どの資料を確認し、なぜ変更するか"
        />
        <p className="field-note">
          理由は版の履歴に保存します。パスワードや個人の連絡先は入力しません。
        </p>
        <button type="submit">
          {pending ? "保存しています…" : submitLabel}
        </button>
      </fieldset>
    </form>
  );
}
