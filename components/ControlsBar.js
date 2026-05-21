'use client';

// Bottom-of-viewport cheatsheet listing the editor's keyboard / mouse
// controls. Read-only — purely informational.
const GROUPS = [
  {
    label: 'Tools',
    items: [
      ['S',      'Selection rect'],
      ['C',      'Connect mode'],
      ['Esc',    'Cancel tool / pending conn'],
    ],
  },
  {
    label: 'Edit',
    items: [
      ['R',          'Rotate selected 90°'],
      ['Del / ⌫',    'Delete selected'],
      ['Ctrl+Z',     'Undo'],
      ['Ctrl+Y',     'Redo'],
      ['Ctrl+C/V/X', 'Copy / Paste / Cut'],
    ],
  },
  {
    label: 'View',
    items: [
      ['Drag canvas', 'Pan'],
      ['Scroll',      'Zoom'],
    ],
  },
];

export default function ControlsBar() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 10,
        zIndex: 10,
        display: 'flex',
        gap: '20px',
        flexWrap: 'wrap',
        alignItems: 'center',
        fontSize: '11px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: '#ee4c2c',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {GROUPS.map((g) => (
        <span key={g.label} style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '10px', opacity: 0.85 }}>
            {g.label}
          </span>
          {g.items.map(([k, d]) => (
            <span key={k}>
              <span style={{ fontFamily: "'Courier New', monospace", fontWeight: 700 }}>[{k}]</span>
              <span style={{ opacity: 0.85 }}> {d}</span>
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
