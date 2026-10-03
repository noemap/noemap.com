import { randomUUID } from "node:crypto";
export function Operation({
  action,
  revision,
  generation,
}: {
  action: string;
  revision: string;
  generation: number;
}) {
  return (
    <>
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="generation" value={generation} />
      <input type="hidden" name="operation" value={randomUUID()} />
    </>
  );
}
export function Reason({
  label = "理由",
  value,
}: {
  label?: string;
  value?: string;
}) {
  return (
    <>
      <label>
        {label}
        <textarea
          name="reason"
          required
          maxLength={2000}
          rows={3}
          defaultValue={value}
        />
      </label>
    </>
  );
}
export function HumanCheck() {
  return (
    <label className="check">
      <input type="checkbox" name="human" value="checked" required />
      <span>本文、根拠、発言者、対象とする箇所を自分で確認しました。</span>
    </label>
  );
}
