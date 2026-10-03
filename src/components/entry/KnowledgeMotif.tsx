export function KnowledgeMotif() {
  return (
    <div className="knowledge-motif" aria-hidden="true">
      <svg viewBox="0 0 340 230" fill="none">
        <circle cx="170" cy="114" r="97" className="motif-orbit" />
        <circle cx="170" cy="114" r="67" className="motif-orbit motif-inner" />
        <path
          d="M171 113 86 56M171 113 268 65M171 113 255 179M171 113 77 175"
          className="motif-lines"
        />
        <path
          d="M86 56Q173-10 268 65M77 175Q165 257 255 179"
          className="motif-lines motif-dotted"
        />
        <circle cx="170" cy="114" r="32" className="motif-center" />
        <text x="170" y="120" textAnchor="middle" className="motif-core-label">
          問い
        </text>
        <g className="motif-node">
          <circle cx="86" cy="56" r="25" />
          <text x="86" y="61" textAnchor="middle">
            自分
          </text>
        </g>
        <g className="motif-node">
          <circle cx="268" cy="65" r="25" />
          <text x="268" y="70" textAnchor="middle">
            意識
          </text>
        </g>
        <g className="motif-node">
          <circle cx="255" cy="179" r="25" />
          <text x="255" y="184" textAnchor="middle">
            記憶
          </text>
        </g>
        <g className="motif-node">
          <circle cx="77" cy="175" r="25" />
          <text x="77" y="180" textAnchor="middle">
            他者
          </text>
        </g>
        <circle cx="179" cy="17" r="3" className="motif-point" />
        <circle cx="301" cy="133" r="3" className="motif-point" />
        <circle cx="138" cy="208" r="3" className="motif-point" />
      </svg>
      <span>ひとつの問いから、世界がひろがる。</span>
    </div>
  );
}
