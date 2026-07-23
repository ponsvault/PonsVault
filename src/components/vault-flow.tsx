/**
 * Fee routing schematic for the Buyback & Burn template.
 *
 * Drawn as a single SVG so labels can never drift from their connectors on
 * resize. Two constraints shaped the geometry:
 * - font sizes are user units, not screen pixels, so box widths are sized
 *   against the longest label at 15/11 units rather than a rendered px value
 * - strokes are flat colours, because an objectBoundingBox gradient collapses
 *   on the zero-height horizontal rail and renders as a stub
 */
export function VaultFlow({ burnBps = 8000 }: { burnBps?: number }) {
  const burnPercent = Math.round(burnBps / 100);
  const treasuryPercent = 100 - burnPercent;

  const nodes = [
    { x: 0, y: 92, label: 'Trading fees', sub: 'WETH · pons locker' },
    { x: 270, y: 92, label: 'Vault', sub: 'immutable rules' },
    { x: 540, y: 8, label: 'Buy back & burn', sub: `${burnPercent}% → 0x…dEaD` },
    { x: 540, y: 176, label: 'Treasury', sub: `${treasuryPercent}% → your wallet` },
  ];

  const rails = [
    { d: 'M180 130 H270', delay: '0s' },
    { d: 'M450 118 C 495 118, 495 46, 540 46', delay: '1.1s' },
    { d: 'M450 142 C 495 142, 495 214, 540 214', delay: '1.1s' },
  ];

  return (
    <div className="vault-flow">
      <svg viewBox="0 0 720 260" role="img" aria-labelledby="vf-title">
        <title id="vf-title">
          {`Trading fees collect in the pons locker and route into the vault, which spends ${burnPercent}% buying back and burning the token while ${treasuryPercent}% goes to the treasury.`}
        </title>

        <g fill="none" strokeWidth="1">
          {rails.map((rail) => (
            <path key={rail.d} d={rail.d} className="vf-rail" />
          ))}
          {rails.map((rail) => (
            <path
              key={`flow-${rail.d}`}
              d={rail.d}
              className="vf-flow"
              style={{ animationDelay: rail.delay }}
            />
          ))}
        </g>

        {nodes.map((node) => (
          <g key={node.label}>
            <rect x={node.x} y={node.y} width="180" height="76" rx="8" className="vf-box" />
            <text x={node.x + 18} y={node.y + 32} className="vf-label">
              {node.label}
            </text>
            <text x={node.x + 18} y={node.y + 54} className="vf-sub">
              {node.sub}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
