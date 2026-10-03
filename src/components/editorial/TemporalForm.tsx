import type { EditorialTemporal } from "../../domain/types";
import { temporalRoleNames } from "../../domain/nodes";
import { Operation } from "../EditorForms";

const bounds = [
  ["start_earliest", "開始時期・最も早い年"],
  ["start_latest", "開始時期・最も遅い年"],
  ["end_earliest", "終了時期・最も早い年"],
  ["end_latest", "終了時期・最も遅い年"],
] as const;

function humanYear(year: number | null) {
  if (year === null) return "不明・未入力";
  return year <= 0 ? `紀元前${1 - year}年` : `西暦${year}年`;
}

export function TemporalDetails({ temporal }: { temporal: EditorialTemporal }) {
  return (
    <div>
      <p>
        <strong>
          {temporalRoleNames[temporal.role]}：{temporal.date_label}
        </strong>
      </p>
      <dl>
        <dt>資料に書かれた年代</dt>
        <dd className="revision-text">{temporal.original_label}</dd>
        <dt>資料の暦・紀年法</dt>
        <dd>{temporal.calendar}</dd>
        {bounds.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{humanYear(temporal[key])}</dd>
          </div>
        ))}
      </dl>
      <p className="field-note">
        年の範囲は年表に並べるための情報です。年代が確実かどうかは、資料と根拠の説明で確認します。
      </p>
    </div>
  );
}

export function TemporalForm({
  revision,
  generation,
  temporal,
}: {
  revision: string;
  generation: number;
  temporal?: EditorialTemporal | null;
}) {
  return (
    <form method="post" action="/editor/action">
      <Operation
        action="temporal"
        revision={revision}
        generation={generation}
      />
      <label>
        年代の種類
        <select name="role" defaultValue={temporal?.role ?? "active"}>
          {Object.entries(temporalRoleNames).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="field-note">
        生年・没年は人物、刊行年は著作、成立年代は概念に使います。活動年代は人物・著作・概念に使えます。
      </p>
      <label>
        読者に見せる年代
        <input
          name="date_label"
          defaultValue={temporal?.date_label ?? ""}
          maxLength={1000}
          required
          placeholder="例：紀元前450年ごろ（架空例）"
        />
      </label>
      <p className="field-note">
        「ごろ」や年代の幅、異説など、資料から分かる不確かさを省かずに書きます。
      </p>
      <label>
        資料に書かれた年代
        <textarea
          name="original_label"
          defaultValue={temporal?.original_label ?? ""}
          rows={3}
          maxLength={2000}
          required
        />
      </label>
      <label>
        資料の暦・紀年法
        <input
          name="calendar"
          defaultValue={temporal?.calendar ?? ""}
          maxLength={120}
          required
          placeholder="例：西暦、和暦など"
        />
      </label>
      <details open={Boolean(temporal)}>
        <summary>年表に置く年の範囲（任意）</summary>
        <p className="field-note">
          根拠のある範囲だけ入力します。分からない年は空欄にします。紀元前1年は「1」と「紀元前」を選びます。0年は使いません。
        </p>
        <p className="field-note">
          生年・没年・刊行年・成立年代は開始時期のみを使います。終了時期は活動年代に入力します。
        </p>
        {bounds.map(([key, label]) => {
          const value = temporal?.[key] ?? null;
          const year = value === null ? "" : value <= 0 ? 1 - value : value;
          const era = value !== null && value <= 0 ? "bce" : "ce";
          return (
            <div key={key} className="editor-grid">
              <label>
                {label}
                <input
                  name={`${key}_year`}
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={year}
                />
              </label>
              <label>
                {label}の紀元
                <select name={`${key}_era`} defaultValue={era}>
                  <option value="ce">西暦</option>
                  <option value="bce">紀元前</option>
                </select>
              </label>
            </div>
          );
        })}
      </details>
      <p className="field-note">
        年代を保存しても、この版は下書きのままです。下の根拠資料を確認してから、内容を確定してください。
      </p>
      <button>年代の下書きを保存</button>
    </form>
  );
}
