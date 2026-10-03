import type { Connection } from "../domain/types";
export function ConnectionMap({
  connections,
  question,
}: {
  connections: Connection[];
  question: string;
}) {
  if (!connections.length) return null;
  const visible = connections.slice(0, 2);
  const questionWords = Array.from(question);
  const questionLine = questionWords.slice(0, 14).join("");
  return (
    <section className="panel">
      <h2>問いに関連する考え方</h2>
      <svg
        viewBox="0 0 320 238"
        className="connection-map"
        role="img"
        aria-labelledby="map-title"
        aria-describedby="map-description"
      >
        <title id="map-title">{`${question}と関連する考え方`}</title>
        <desc id="map-description">
          根拠のある記述をもとに、編集者が問いと考え方を関連付けています。名称と関連理由は下の一覧で確認できます。
        </desc>
        <defs>
          <marker
            id="map-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10Z" fill="currentColor" />
          </marker>
        </defs>
        <rect
          x="10"
          y="15"
          width="300"
          height="54"
          rx="8"
          fill="var(--green)"
        />
        <text
          x="160"
          y={questionWords.length > 14 ? 37 : 47}
          textAnchor="middle"
          fill="var(--paper)"
          fontSize="17"
        >
          <tspan x="160">{questionLine}</tspan>
          {questionWords.length > 14 && (
            <tspan x="160" dy="21">
              {questionWords.slice(14, 28).join("")}
              {questionWords.length > 28 ? "…" : ""}
            </tspan>
          )}
        </text>
        {visible.map((c, i) => {
          const x = i === 0 ? 79 : 241;
          const words = Array.from(c.subject);
          return (
            <g key={c.revision_id}>
              <path
                d={`M${x} 160 Q${x} 105 ${i === 0 ? 136 : 184} 74`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                markerEnd="url(#map-arrow)"
              />
              <rect
                x={i === 0 ? 8 : 170}
                y="160"
                width="142"
                height="62"
                rx="8"
                fill="var(--paper)"
                stroke="var(--line)"
              />
              <text
                x={x}
                y={words.length > 8 ? 186 : 196}
                textAnchor="middle"
                fill="var(--ink)"
                fontSize="16"
              >
                <tspan x={x}>{words.slice(0, 8).join("")}</tspan>
                {words.length > 8 && (
                  <tspan x={x} dy="19">
                    {words.slice(8, 16).join("")}
                    {words.length > 16 ? "…" : ""}
                  </tspan>
                )}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="small">編集上の関連</p>
      <ul className="plain-list">
        {connections.map((c) => (
          <li key={c.revision_id}>
            <a href={`/evidence/${c.revision_id}`}>{c.subject}：関連する理由</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
