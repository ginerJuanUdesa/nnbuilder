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

function InfoRow({ label, value }) {
  return (
    <div className="wi-row">
      <span className="wi-label">{label}</span>
      <span className="wi-value">{value}</span>
    </div>
  );
}



export default function LeftSidebar() {
  const [info, setInfo] = useState({ x: '—', y: '—', zoom: '—', fps: '—', params: '—' });

  useEffect(() => {
    const handler = (e) => {
      const w = e.detail;
      const p = w.params;
      const paramsStr = p === null ? '?'
                      : p >= 1e9  ? (p / 1e9).toFixed(2) + 'B'
                      : p >= 1e6  ? (p / 1e6).toFixed(2) + 'M'
                      : p >= 1e3  ? (p / 1e3).toFixed(1) + 'K'
                      : String(p);
      setInfo({
        x:      w.x.toFixed(0),
        y:      w.y.toFixed(0),
        zoom:   (w.zoom * 100).toFixed(0) + '%',
        fps:    w.fps,
        params: paramsStr,
      });
    };
    window.addEventListener('worldinfo', handler);
    return () => window.removeEventListener('worldinfo', handler);
  }, []);

  return (
    <div className="left-sidebar">
      <Section title="World Information">
        <InfoRow label="X"          value={info.x} />
        <InfoRow label="Y"          value={info.y} />
        <InfoRow label="Zoom"       value={info.zoom} />
        <InfoRow label="FPS"        value={info.fps} />
        <InfoRow label="Parameters" value={info.params} />
      </Section>

      <Section title="Matrixes">
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'matrix')}
        >
          <span className="pal-name">Matrix</span>
          <span className="pal-desc">Literal tensor (mask, input, weight…)</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'ones')}
        >
          <span className="pal-name">Ones</span>
          <span className="pal-desc">torch.ones(shape)</span>
        </div>
      </Section>
      <Section title="Tensor ops">
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'matmul')}
        >
          <span className="pal-name">matmul</span>
          <span className="pal-desc">torch.matmul — A @ B</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'add')}
        >
          <span className="pal-name">Add</span>
          <span className="pal-desc">torch.add — element-wise sum, N inputs</span>
        </div>
      </Section>
      <Section title="nn.Modules">
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'linear')}
        >
          <span className="pal-name">Linear</span>
          <span className="pal-desc">nn.Linear(d_in, d_out, bias)</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'conv2d')}
        >
          <span className="pal-name">Conv2d</span>
          <span className="pal-desc">nn.Conv2d(in_ch, out_ch, kernel, stride, padding)</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'transpose')}
        >
          <span className="pal-name">Transpose</span>
          <span className="pal-desc">torch.transpose(dim0, dim1)</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'layernorm')}
        >
          <span className="pal-name">LayerNorm</span>
          <span className="pal-desc">nn.LayerNorm(normalized_shape)</span>
        </div>
      </Section>
      <Section title="nn.ActivationFunctions">
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'relu')}
        >
          <span className="pal-name">ReLU</span>
          <span className="pal-desc">nn.ReLU() — elementwise max(0, x)</span>
        </div>
      </Section>
      <Section title="nn.Regularization">
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'dropout')}
        >
          <span className="pal-name">Dropout</span>
          <span className="pal-desc">nn.Dropout(p) — stochastic zero-out</span>
        </div>
      </Section>
      <Section title="F.functions">
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'scale')}
        >
          <span className="pal-name">Scale</span>
          <span className="pal-desc">x × c  or  x ÷ c  (scalar factor)</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'softmax')}
        >
          <span className="pal-name">Softmax</span>
          <span className="pal-desc">F.softmax(x, dim)</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'triu')}
        >
          <span className="pal-name">Triu</span>
          <span className="pal-desc">torch.triu(x, diagonal) — upper triangular</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'masked_fill')}
        >
          <span className="pal-name">MaskedFill</span>
          <span className="pal-desc">x.masked_fill(mask, value)</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'contiguous')}
        >
          <span className="pal-name">Contiguous</span>
          <span className="pal-desc">.contiguous() — enforce memory layout</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'view')}
        >
          <span className="pal-name">View</span>
          <span className="pal-desc">x.view(*shape) — reshape, -1 infers dim</span>
        </div>
        <div
          className="pal-item"
          draggable
          onDragStart={e => e.dataTransfer.setData('nodeType', 'slice')}
        >
          <span className="pal-name">Slice</span>
          <span className="pal-desc">x[:T, :T] — per-dim index bounds</span>
        </div>
      </Section>
    </div>
  );
}
