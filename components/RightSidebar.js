'use client';

import { useState, useEffect } from 'react';

function Section({ title, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="sb-section">
      <button className="sb-section-header" onClick={() => setOpen(o => !o)}>
        <span className="sb-arrow">{open ? '▾' : '▸'}</span>
        <span className="sb-section-title">{title}</span>
      </button>
      {open && <div className="sb-section-body">{children}</div>}
    </div>
  );
}

// Lighter pass — each swatch shifted up ~one Material shade so picked
// nodes stay readable on white backgrounds.
const COLORS = [
  '#ffffff', '#f5f5f5', '#9e9e9e', '#bdbdbd',
  '#ff8a65', '#ffab91', '#ffd54f', '#ffe082',
  '#81c784', '#a5d6a7', '#4dd0e1', '#81d4fa',
  '#7986cb', '#9fa8da', '#ba68c8', '#e1bee7',
  '#f06292', '#f8bbd0', '#a1887f', '#bcaaa4',
];

export default function RightSidebar() {
  const [node, setNode] = useState(null);
  // Raw shape-input string. Decoupled from node.shape so the user can type
  // ", " or trailing whitespace without the controlled value snapping back
  // (which previously ate every comma keystroke).
  const [shapeStr, setShapeStr] = useState('');

  useEffect(() => {
    const h = (e) => {
      const next = e.detail ? { ...e.detail } : null;
      setNode(next);
      setShapeStr(next?.shape ? next.shape.join(', ') : '');
    };
    window.addEventListener('nodeselect', h);
    return () => window.removeEventListener('nodeselect', h);
  }, []);

  const update = (field, val) => {
    if (!node) return;
    const updated = { ...node, [field]: val };
    setNode(updated);
    window.dispatchEvent(new CustomEvent('nodeupdate', { detail: updated }));
  };

  // Commit raw shape string into node.shape (drop empty tokens). Called on
  // blur / Enter so intermediate states like "4, " remain editable.
  const commitShape = (raw) => {
    const shape = raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (shape.length > 0) update('shape', shape);
  };

  // Title reflects the selected module's type so the panel header tells
  // the user what they're editing at a glance.
  // Shared toggle for every module that spawns an "out" ghost silhouette.
  // Default = visible (treat undefined as true).
  const ghostToggle = (node && ['matmul','linear','relu','scale','transpose','softmax'].includes(node.type)) ? (
    <div className="mi-field" style={{ flexDirection:'row', alignItems:'center', gap:'8px' }}>
      <input
        type="checkbox"
        id={`mod-ghost-${node.id}`}
        checked={node.showGhost !== false}
        onChange={e => update('showGhost', e.target.checked)}
        style={{ accentColor:'#ee4c2c', width:'16px', height:'16px', cursor:'pointer' }}
      />
      <label htmlFor={`mod-ghost-${node.id}`} className="mi-label" style={{ margin:0, cursor:'pointer' }}>show output ghost</label>
    </div>
  ) : null;

  const moduleLabel = !node ? 'Module Information'
    : node.type === 'linear'    ? 'Module Information — nn.Linear'
    : node.type === 'relu'      ? 'Module Information — nn.ReLU'
    : node.type === 'scale'     ? 'Module Information — Scale'
    : node.type === 'transpose' ? 'Module Information — Transpose'
    : node.type === 'softmax'   ? 'Module Information — F.softmax'
    : node.type === 'triu'      ? 'Module Information — torch.triu'
    : node.type === 'masked_fill' ? 'Module Information — masked_fill'
    : node.type === 'matmul'    ? 'Module Information — matmul'
    : node.type === 'matrix'    ? `Module Information — ${
          node.init === 'ones' ? 'torch.ones'
        : node.boundMatmulId !== undefined ? 'Matrix (matmul output)'
        : node.boundLinearId !== undefined ? 'Matrix (module output)'
        : 'Matrix'
      }`
    : 'Module Information';

  return (
    <div className="left-sidebar">
      <Section title={moduleLabel}>
        {!node ? (
          <div className="wi-row">
            <span className="wi-label" style={{ fontStyle: 'italic' }}>No module selected</span>
          </div>
        ) : node.type === 'masked_fill' ? (
          <>
            <div className="mi-field">
              <label className="mi-label">value</label>
              <input
                className="mi-input"
                value={String(node.value ?? '-inf')}
                onChange={e => update('value', e.target.value)}
                placeholder="-inf"
                spellCheck={false}
              />
            </div>
            <span className="mi-hint">x.masked_fill(mask, value) — replaces every position where mask is True with `value`. Two input gates: <code>x</code> (tensor) and <code>m</code> (mask). Output shape = x's shape.</span>
          </>
        ) : node.type === 'triu' ? (
          <>
            <div className="mi-field">
              <label className="mi-label">diagonal</label>
              <input
                className="mi-input"
                value={String(node.diagonal ?? 0)}
                onChange={e => {
                  const raw = e.target.value.trim();
                  const n = parseInt(raw, 10);
                  update('diagonal', Number.isFinite(n) ? n : raw);
                }}
                placeholder="0"
                spellCheck={false}
              />
            </div>
            <span className="mi-hint">torch.triu(x, diagonal) — zeros below the given diagonal (default 0 = main diagonal). Positive shifts above, negative includes diagonals below the main. Output shape = input shape.</span>
          </>
        ) : node.type === 'softmax' ? (
          <>
            <div className="mi-field">
              <label className="mi-label">dim</label>
              <input
                className="mi-input"
                value={String(node.dim ?? -1)}
                onChange={e => {
                  const raw = e.target.value.trim();
                  const n = parseInt(raw, 10);
                  update('dim', Number.isFinite(n) ? n : raw);
                }}
                placeholder="-1"
                spellCheck={false}
              />
            </div>
            <span className="mi-hint">F.softmax(x, dim) — normalizes along the given dim (default -1: last dim). Negative indices wrap from the end. Output shape = input shape.</span>
          </>
        ) : node.type === 'transpose' ? (
          <>
            <div className="mi-field">
              <label className="mi-label">dim0</label>
              <input
                className="mi-input"
                value={String(node.dim0 ?? -2)}
                onChange={e => {
                  const raw = e.target.value.trim();
                  const n = parseInt(raw, 10);
                  update('dim0', Number.isFinite(n) ? n : raw);
                }}
                placeholder="-2"
                spellCheck={false}
              />
            </div>
            <div className="mi-field">
              <label className="mi-label">dim1</label>
              <input
                className="mi-input"
                value={String(node.dim1 ?? -1)}
                onChange={e => {
                  const raw = e.target.value.trim();
                  const n = parseInt(raw, 10);
                  update('dim1', Number.isFinite(n) ? n : raw);
                }}
                placeholder="-1"
                spellCheck={false}
              />
            </div>
            <span className="mi-hint">torch.transpose(input, dim0, dim1) — swaps two dims. Negative indices wrap from the end (default swaps the last two dims).</span>
          </>
        ) : node.type === 'scale' ? (
          <>
            <div className="mi-field">
              <label className="mi-label">Op</label>
              <select
                className="mi-input"
                value={node.op === '/' ? '/' : '*'}
                onChange={e => update('op', e.target.value)}
              >
                <option value="*">× (multiply)</option>
                <option value="/">÷ (divide)</option>
              </select>
            </div>
            <div className="mi-field">
              <label className="mi-label">Factor</label>
              <input
                className="mi-input"
                value={String(node.factor ?? '1')}
                onChange={e => update('factor', e.target.value)}
                placeholder="e.g. 2, sqrt(d_k), B"
                spellCheck={false}
              />
            </div>
            <span className="mi-hint">Output shape = input shape. Factor accepts numbers or variable names.</span>
          </>
        ) : node.type === 'linear' ? (
          <>
            <div className="mi-field">
              <label className="mi-label">d_in</label>
              <input
                className="mi-input"
                value={String(node.d_in ?? 4)}
                onChange={e => {
                  const raw = e.target.value.trim();
                  const parsed = raw === '' ? '' : (!isNaN(raw) ? Math.max(1, parseInt(raw) || 1) : raw);
                  update('d_in', parsed);
                }}
                placeholder="4"
                spellCheck={false}
              />
            </div>
            <div className="mi-field">
              <label className="mi-label">d_out</label>
              <input
                className="mi-input"
                value={String(node.d_out ?? 4)}
                onChange={e => {
                  const raw = e.target.value.trim();
                  const parsed = raw === '' ? '' : (!isNaN(raw) ? Math.max(1, parseInt(raw) || 1) : raw);
                  update('d_out', parsed);
                }}
                placeholder="4"
                spellCheck={false}
              />
            </div>
            <div className="mi-field" style={{ flexDirection:'row', alignItems:'center', gap:'8px' }}>
              <input
                type="checkbox"
                id="linear-bias"
                checked={node.bias !== false}
                onChange={e => update('bias', e.target.checked)}
                style={{ accentColor:'#ee4c2c', width:'16px', height:'16px', cursor:'pointer' }}
              />
              <label htmlFor="linear-bias" className="mi-label" style={{ margin:0, cursor:'pointer' }}>bias</label>
            </div>
            <span className="mi-hint">Spawns one output matrix per input edge: shape = (…, d_out).</span>
          </>
        ) : node.type === 'relu' ? (
          <>
            <span className="mi-hint">nn.ReLU() — elementwise max(0, x). Output shape = input shape.</span>
          </>
        ) : node.type === 'matmul' ? (
          <>
            <span className="mi-hint">torch.matmul — A @ B. Output = (..., A·rows, B·cols). Matrix lives at the output side once both A and B are wired with compatible shapes.</span>
          </>
        ) : node.type === 'matrix' ? (
          <>
            <div className="mi-field">
              <label className="mi-label">Name</label>
              <input
                className="mi-input"
                value={node.name}
                onChange={e => update('name', e.target.value)}
                spellCheck={false}
              />
            </div>
            {(node.boundMatmulId === undefined && node.boundLinearId === undefined) && (
              <div className="mi-field">
                <label className="mi-label">Shape</label>
                <input
                  className="mi-input"
                  value={shapeStr}
                  onChange={e => setShapeStr(e.target.value)}
                  onBlur={e => commitShape(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  placeholder="BATCH, 4"
                  spellCheck={false}
                />
                <span className="mi-hint">Comma-separated dims — use variable names or numbers, e.g. BATCH, 512</span>
              </div>
            )}
            {(node.boundMatmulId !== undefined || node.boundLinearId !== undefined) && (
              <div className="mi-field">
                <label className="mi-label">Shape</label>
                <span className="mi-input" style={{
                  display:'inline-block', opacity:0.7, fontStyle:'italic',
                  pointerEvents:'none',
                }}>{shapeStr || '—'}</span>
                <span className="mi-hint">
                  {node.boundMatmulId !== undefined
                    ? 'Inherited from matmul A @ B — not editable.'
                    : 'Inherited from upstream module — not editable.'}
                </span>
              </div>
            )}
            <div className="mi-field">
              <label className="mi-label">Color</label>
              <div className="mi-colors">
                {COLORS.map(c => (
                  <button
                    key={c}
                    className="mi-color-swatch"
                    style={{
                      background: c,
                      border: (node.color ?? '#ffffff') === c
                        ? '2px solid #ee4c2c'
                        : '2px solid rgba(0,0,0,0.12)',
                    }}
                    onClick={() => update('color', c)}
                    title={c}
                  />
                ))}
              </div>
            </div>
          </>
        ) : null}
        {/* Spawn-ghost toggle — rendered for every module type that can
            project a dotted "out" silhouette, regardless of which branch
            above matched. Sits at the bottom of the panel, separated by a
            thin rule so it's discoverable. */}
        {ghostToggle && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
            {ghostToggle}
          </div>
        )}
      </Section>
    </div>
  );
}
