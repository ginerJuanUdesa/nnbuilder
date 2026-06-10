'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Auto-shrinking dim label: measures actual rendered width against container
// width and steps font-size down (in 0.5px increments) until the string fits
// on one line. Floor at 6px so the text never disappears.
function MatrixDims({ text }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.fontSize = ''; // reset so growth path also works
    const parent = el.parentElement;
    if (!parent) return;
    const max = parent.clientWidth - 4;
    let fs = 11;
    el.style.fontSize = fs + 'px';
    let guard = 30;
    while (el.scrollWidth > max && fs > 6 && guard-- > 0) {
      fs -= 0.5;
      el.style.fontSize = fs + 'px';
    }
  }, [text]);
  return (
    <span ref={ref} className="matrix-node-dims" style={{ whiteSpace: 'nowrap', display: 'inline-block' }}>
      {text}
    </span>
  );
}

// Auto-shrinking node-name: same idea as MatrixDims but with a larger
// baseline so long titles ("MaskedFill", "Transpose") still fit the body
// width. Wraps the .matrix-node-name span so existing color/weight rules
// continue to apply.
function ModuleName({ children, color }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.fontSize = '';
    const parent = el.parentElement;
    if (!parent) return;
    const max = (parent.clientWidth || NODE_SIZE) - 6;
    let fs = 20; // base name size from CSS
    el.style.fontSize = fs + 'px';
    let guard = 40;
    while (el.scrollWidth > max && fs > 8 && guard-- > 0) {
      fs -= 0.5;
      el.style.fontSize = fs + 'px';
    }
  }, [children]);
  return (
    <span
      ref={ref}
      className="matrix-node-name"
      style={{ whiteSpace: 'nowrap', display: 'inline-block', ...(color ? { color } : {}) }}
    >
      {children}
    </span>
  );
}

const SPACING   = 28;
const MAJOR     = 5;
const NODE_SIZE = SPACING * 4; // 112 world-units

const SUPERBOX_COLORS = [
  '#8d99ae', '#a8a29e', '#9e9e9e', '#bdbdbd',
  '#ff8a65', '#ffab91', '#ffd54f', '#ffe082',
  '#81c784', '#a5d6a7', '#4dd0e1', '#81d4fa',
  '#7986cb', '#9fa8da', '#ba68c8', '#e1bee7',
  '#f06292', '#f8bbd0', '#a1887f', '#bcaaa4',
];

// ── Slot position helpers ──────────────────────────────────────────────────

// Grid-aligned fractions: 0.25 = SPACING, 0.5 = 2*SPACING, 0.75 = 3*SPACING
function slotFraction(slotId) {
  if (slotId === 'A' || slotId === 'x')    return 0.25;
  if (slotId === 'B' || slotId === 'mask') return 0.75;
  return 0.5;
}

// rot: 0=right-out, 1=bottom-out, 2=left-out, 3=top-out
function getOutputSlotPos(node) {
  const rot = node.rot ?? 0;
  switch (rot) {
    case 1: return { x: node.x + NODE_SIZE * 0.5, y: node.y + NODE_SIZE };
    case 2: return { x: node.x,                   y: node.y + NODE_SIZE * 0.5 };
    case 3: return { x: node.x + NODE_SIZE * 0.5, y: node.y };
    default: return { x: node.x + NODE_SIZE,      y: node.y + NODE_SIZE * 0.5 };
  }
}

function getInputSlotPos(node, slotId) {
  const rot = node.rot ?? 0;
  const f = slotFraction(slotId);
  switch (rot) {
    case 1: return { x: node.x + NODE_SIZE * f, y: node.y };
    case 2: return { x: node.x + NODE_SIZE,      y: node.y + NODE_SIZE * f };
    case 3: return { x: node.x + NODE_SIZE * f, y: node.y + NODE_SIZE };
    default: return { x: node.x,                y: node.y + NODE_SIZE * f };
  }
}

// CSS inline styles for slot divs — overrides class defaults per rotation
function outSlotStyle(rot) {
  switch (rot) {
    case 1: return { right:'auto', left:'50%',  top:'auto',  bottom:'-6px', transform:'translateX(-50%)' };
    case 2: return { right:'auto', left:'-6px', top:'50%',   bottom:'auto', transform:'translateY(-50%)' };
    case 3: return { right:'auto', left:'50%',  top:'-6px',  bottom:'auto', transform:'translateX(-50%)' };
    default: return { right:'-6px', left:'auto', top:'50%',  bottom:'auto', transform:'translateY(-50%)' };
  }
}
function inSlotStyle(rot, f) {
  const pct = (f * 100).toFixed(2) + '%';
  switch (rot) {
    case 1: return { left:pct, right:'auto', top:'-6px',  bottom:'auto', transform:'translateX(-50%)' };
    case 2: return { right:'-6px', left:'auto', top:pct,  bottom:'auto', transform:'translateY(-50%)' };
    case 3: return { left:pct, right:'auto', top:'auto',  bottom:'-6px', transform:'translateX(-50%)' };
    default: return { left:'-6px', right:'auto', top:pct, bottom:'auto', transform:'translateY(-50%)' };
  }
}

// Slot dot positioned on a specific named side of the node (linear/relu's
// multi-side inputs). Independent of rot — the side name is absolute.
function sideSlotStyle(side) {
  switch (side) {
    case 'top':    return { left:'50%',  right:'auto', top:'-6px',  bottom:'auto', transform:'translateX(-50%)' };
    case 'right':  return { left:'auto', right:'-6px', top:'50%',   bottom:'auto', transform:'translateY(-50%)' };
    case 'bottom': return { left:'50%',  right:'auto', top:'auto',  bottom:'-6px', transform:'translateX(-50%)' };
    case 'left':   return { left:'-6px', right:'auto', top:'50%',   bottom:'auto', transform:'translateY(-50%)' };
  }
}

// Segment ↔ axis-aligned rect overlap (world coords). Used to hide module
// "out" ghost silhouettes that would be visually crossed by a connection.
function segIntersectsRect(p1, p2, rx, ry, rw, rh) {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  if (Math.max(x1, x2) < rx || Math.min(x1, x2) > rx + rw) return false;
  if (Math.max(y1, y2) < ry || Math.min(y1, y2) > ry + rh) return false;
  const inside = (x, y) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
  if (inside(x1, y1) || inside(x2, y2)) return true;
  const dx = x2 - x1, dy = y2 - y1;
  const crossH = (y, xMin, xMax) => {
    if (dy === 0) return false;
    const t = (y - y1) / dy;
    if (t < 0 || t > 1) return false;
    const xh = x1 + t * dx;
    return xh >= xMin && xh <= xMax;
  };
  const crossV = (x, yMin, yMax) => {
    if (dx === 0) return false;
    const t = (x - x1) / dx;
    if (t < 0 || t > 1) return false;
    const yv = y1 + t * dy;
    return yv >= yMin && yv <= yMax;
  };
  return crossH(ry, rx, rx + rw) || crossH(ry + rh, rx, rx + rw)
      || crossV(rx, ry, ry + rh) || crossV(rx + rw, ry, ry + rh);
}

function autoRoute(src, dst) {
  const midX = Math.round((src.x + dst.x) / 2 / SPACING) * SPACING;
  return [
    { x: midX, y: Math.round(src.y / SPACING) * SPACING },
    { x: midX, y: Math.round(dst.y / SPACING) * SPACING },
  ];
}

// ── Canvas drawing helpers ─────────────────────────────────────────────────

function drawPolyline(ctx, pts, cam, z, color, lw, dashed) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = lw;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const sx = (p.x - cam.x) * z, sy = (p.y - cam.y) * z;
    i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
  });
  ctx.stroke(); ctx.setLineDash([]); ctx.restore();
}

function drawArrow(ctx, from, to, cam, z, color, dpr) {
  const ax = (from.x - cam.x) * z, ay = (from.y - cam.y) * z;
  const bx = (to.x   - cam.x) * z, by = (to.y   - cam.y) * z;
  const ang = Math.atan2(by - ay, bx - ax), sz = 7 * dpr;
  ctx.save(); ctx.fillStyle = color;
  ctx.translate(bx, by); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-sz,-sz*.45); ctx.lineTo(-sz,sz*.45);
  ctx.closePath(); ctx.fill(); ctx.restore();
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy;
  if (len2===0) return Math.hypot(px-ax, py-ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2));
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}

// Which side of `node` is closest to world point (wx,wy) — 'right'|'left'|'bottom'|'top'
function closestSide(node, wx, wy) {
  const dx = wx - (node.x + NODE_SIZE / 2);
  const dy = wy - (node.y + NODE_SIZE / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}
// Midpoint of a named side — works dynamically from current node.x/y
function sideToPos(node, side) {
  const h = NODE_SIZE / 2;
  switch (side) {
    case 'right':  return { x: node.x + NODE_SIZE, y: node.y + h };
    case 'left':   return { x: node.x,             y: node.y + h };
    case 'bottom': return { x: node.x + h, y: node.y + NODE_SIZE };
    case 'top':    return { x: node.x + h, y: node.y };
  }
}

// Which side of a node faces the output (rot maps 0→right, 1→bottom, ...).
function rotToOutSide(rot) {
  switch (rot ?? 0) {
    case 1: return 'bottom';
    case 2: return 'left';
    case 3: return 'top';
    default: return 'right';
  }
}
const ALL_SIDES = ['top', 'right', 'bottom', 'left'];

// Connection's input-side position: honors conn.toSide (linear/relu's
// per-side input gates) before falling back to the default slot mapping.
function getConnInputPos(node, conn) {
  if (conn && conn.toSide) return sideToPos(node, conn.toSide);
  return getInputSlotPos(node, conn && conn.toSlotId);
}

// Resolve a shape dim string ("BATCH", "512", 4) → number, using vars array
function resolveValWithVars(s, varsArr) {
  if (typeof s === 'number') return s;
  const n = parseFloat(String(s).trim());
  if (!isNaN(n)) return Math.round(n);
  const vr = varsArr.find(v => v.name === String(s).trim());
  if (vr) { const n2 = parseFloat(vr.value); return isNaN(n2) ? null : Math.round(n2); }
  return null;
}

// ── Variable formula evaluator ─────────────────────────────────────────────
// Each variable's value may be a raw number, a reference to another var
// (e.g. "B"), or an expression mixing numbers, var names, and a small Math
// allow-list (sqrt, floor, ceil, abs, log, exp, pow, min, max, etc.).
// Resolves recursively with cycle protection.
const VAR_FN_SCOPE = {
  sqrt: Math.sqrt, cbrt: Math.cbrt, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, abs: Math.abs, sign: Math.sign,
  log: Math.log, log2: Math.log2, log10: Math.log10, ln: Math.log,
  exp: Math.exp, pow: Math.pow,
  min: Math.min, max: Math.max,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  PI: Math.PI, E: Math.E,
};

function safeEvalVarExpr(expr, scope) {
  // Whitelist input chars so we never feed a string with `;`, `{`, etc. to
  // the Function constructor. Allowed: digits, identifiers, math ops,
  // parens, comma, dot, percent, caret (alias for **), whitespace.
  if (!/^[0-9a-zA-Z+\-*/%()\^,.\s_]+$/.test(expr)) return NaN;
  // Replace Python-style floor division // with Math.floor(a/b).
  // Must run before JS sees it, since JS treats // as line comment.
  // Handles simple token//token (covers T//8, d//heads, etc.)
  // Applied iteratively to handle chained: a//b//c → floor(floor(a/b)/c)
  let normalized = expr.replace(/\^/g, '**');
  let prev;
  do {
    prev = normalized;
    normalized = normalized.replace(/([A-Za-z0-9_.]+)\s*\/\/\s*([A-Za-z0-9_.]+)/g,
      'Math.floor(($1)/($2))');
  } while (normalized !== prev);
  try {
    const keys = Object.keys(scope);
    const vals = Object.values(scope);
    // eslint-disable-next-line no-new-func
    const fn = new Function(...keys, `"use strict"; return (${normalized});`);
    const r = fn(...vals);
    return typeof r === 'number' && Number.isFinite(r) ? r : NaN;
  } catch { return NaN; }
}

// Build a lookup of "NodeName.shape[N]" → numeric value from matrix nodes.
// Used to allow variable expressions like `seq = Input.shape[0]`.
function buildShapeRefs(nodesArr) {
  const refs = {};
  for (const n of (nodesArr || [])) {
    if (n.type === 'matrix' && n.name && Array.isArray(n.shape)) {
      n.shape.forEach((dim, i) => {
        const num = typeof dim === 'number' ? dim : parseFloat(String(dim));
        refs[`${n.name}.shape[${i}]`] = isNaN(num) ? null : num;
      });
    }
  }
  return refs;
}

function resolveVars(vars, nodesArr = []) {
  const shapeRefs = buildShapeRefs(nodesArr);
  const out = {};
  const visiting = new Set();
  const resolveOne = (name) => {
    if (name in out) return out[name];
    if (visiting.has(name)) { out[name] = NaN; return NaN; } // cycle
    visiting.add(name);
    const v = vars.find(x => x.name === name);
    if (!v) { visiting.delete(name); out[name] = NaN; return NaN; }
    let raw = String(v.value ?? '').trim();
    if (raw === '') { visiting.delete(name); out[name] = NaN; return NaN; }
    // Substitute Name.shape[N] references before numeric parsing / eval.
    for (const [ref, val] of Object.entries(shapeRefs)) {
      if (raw.includes(ref)) {
        raw = raw.split(ref).join(val === null ? 'NaN' : String(val));
      }
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      const n = parseFloat(raw);
      visiting.delete(name); out[name] = n; return n;
    }
    // Discover and resolve referenced identifiers first
    const scope = { ...VAR_FN_SCOPE };
    const ids = raw.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
    for (const id of ids) {
      if (id in scope) continue;
      scope[id] = resolveOne(id);
    }
    const result = safeEvalVarExpr(raw, scope);
    visiting.delete(name);
    out[name] = result;
    return result;
  };
  for (const v of vars) if (v.name) resolveOne(v.name);
  return out;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function Grid() {
  const canvasRef = useRef(null);
  const panelRef  = useRef(null);
  const camRef    = useRef({ x: 0, y: 0, zoom: 1 });
  const drawRef   = useRef(null); // exposed so effects can trigger redraws
  const varsRef   = useRef([]);

  // Hydration-safe: initial render must match server (no localStorage reads
  // in useState initializers). Persisted state is loaded once on mount via
  // useEffect below — the first client paint matches the server's empty DOM,
  // then we hydrate user data and re-render.
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedIds,     setSelectedIds]     = useState(new Set());
  const [selectedConnIds, setSelectedConnIds] = useState(new Set());
  const [vars, setVars] = useState([{ name:'BATCH', value:'32' }]);
  const [hydrated, setHydrated] = useState(false);
  const [varsCollapsed, setVarsCollapsed] = useState(false);

  // ── Superboxes (groups) ───────────────────────────────────────────────────
  const [superboxes, setSuperboxes] = useState([]);
  const superboxesRef = useRef([]);
  const selectedSuperboxIdRef = useRef(null);
  // draw-mode: user holds G key to drag-draw a new group rect
  const drawModeRef    = useRef(false);
  const sbDrawStartRef = useRef(null);   // { wx, wy }
  const sbDrawCurrentRef = useRef(null); // { wx, wy }
  // drag state for moving an existing SB
  const sbDraggingRef  = useRef(false);
  const sbDragIdRef    = useRef(null);
  const sbDragOffRef   = useRef({ x: 0, y: 0 });
  // resize state
  const sbResizingRef      = useRef(false);
  const sbResizeIdRef      = useRef(null);
  const sbResizeEdgeRef    = useRef(null);
  const sbResizeStartRef   = useRef({ x: 0, y: 0 });
  const sbResizeOrigRef    = useRef({ x: 0, y: 0, w: 0, h: 0 });
  // eye-button hit areas rebuilt each frame
  const sbEyeBtnsRef = useRef([]);
  // setSuperboxes ref so canvas-effect closures can call it
  const setSuperboxesRef = useRef(setSuperboxes); setSuperboxesRef.current = setSuperboxes;

  useEffect(() => {
    if (hydrated) return;
    // One-shot coord rebase: the point at world (-170, -1) becomes the new
    // (0, 0). Equivalent to translating every world coord by (+170, +1).
    // Guarded by a localStorage flag so it only runs once per browser.
    const SHIFT_FLAG = 'tb_origin_shift_v1';
    const needsShift = (() => {
      try { return !localStorage.getItem(SHIFT_FLAG); } catch { return false; }
    })();
    const SX = 170, SY = 1;
    const shiftNode = (n) => needsShift ? { ...n, x: n.x + SX, y: n.y + SY } : n;
    const shiftConn = (c) => needsShift
      ? { ...c, vertices: c.vertices.map(v => ({ x: v.x + SX, y: v.y + SY })) }
      : c;
    try {
      const n = localStorage.getItem('tb_nodes');
      if (n) setNodes(JSON.parse(n).map(shiftNode));
    } catch {}
    try {
      const c = localStorage.getItem('tb_conns');
      if (c) setConnections(JSON.parse(c).map(shiftConn));
    } catch {}
    if (needsShift) {
      try { localStorage.setItem(SHIFT_FLAG, '1'); } catch {}
    }
    // Always center the viewport on world (0, 0) on initial page load —
    // overrides anything resize() may have set so the user lands on the
    // origin regardless of node positions or previous camera state.
    try {
      const stage = canvasRef.current?.parentElement;
      if (stage) {
        const r = stage.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          camRef.current.x = -r.width / (2 * (camRef.current.zoom || 1));
          camRef.current.y = -r.height / (2 * (camRef.current.zoom || 1));
        }
      }
    } catch {}
    try {
      const v = localStorage.getItem('tb_vars');
      const loaded = v ? JSON.parse(v) : null;
      if (loaded && loaded.length) {
        setVars(loaded[0]?.name === 'BATCH'
          ? loaded
          : [{ name:'BATCH', value:'32' }, ...loaded.filter(x => x.name !== 'BATCH')]);
      }
    } catch {}
    try {
      const g = localStorage.getItem('tb_groups');
      if (g) setSuperboxes(JSON.parse(g));
    } catch {}
    setHydrated(true);
  }, [hydrated]);

  // ── MATMUL → MATRIX binding ────────────────────────────────────────────
  // Matrix spawns only when matmul has BOTH input slots (A and B) wired;
  // despawns the moment either input is removed. Position locked to the
  // matmul's output side. Idempotent: bails out if no spawn/despawn needed
  // this frame (so the effect doesn't loop on its own writes).
  useEffect(() => {
    if (!hydrated) return;
    let needsUpdate = false;
    const nextNodes = [...nodes];
    const nextConns = [...connections];
    let idSeed = nextNodes.reduce((m, n) => Math.max(m, n.id), Date.now()) + 1;

    // Helper: position matrix flush to matmul's output side based on rot
    const matrixPosFor = (m) => {
      const out = getOutputSlotPos(m);
      const rot = m.rot ?? 0;
      switch (rot) {
        case 0: return { x: out.x,              y: out.y - NODE_SIZE / 2 };
        case 1: return { x: out.x - NODE_SIZE/2, y: out.y };
        case 2: return { x: out.x - NODE_SIZE,   y: out.y - NODE_SIZE / 2 };
        case 3: return { x: out.x - NODE_SIZE/2, y: out.y - NODE_SIZE };
      }
    };

    for (const m of nextNodes) {
      if (m.type !== 'matmul') continue;
      // Non-terminal matmul (wired into another module) suppresses its own
      // matrix — the chain's matrices live at the tail end only.
      if (!isTerminal(m)) {
        const matrixIdx = m.matrixId !== undefined
          ? nextNodes.findIndex(n => n.id === m.matrixId) : -1;
        if (matrixIdx !== -1) {
          const mxId = m.matrixId;
          const mx = nextNodes[matrixIdx];
          const mIdx = nextNodes.indexOf(m);
          nextNodes[mIdx] = {
            ...m,
            matrixId: undefined,
            matrixName:  mx.name  !== undefined ? mx.name  : m.matrixName,
            matrixColor: mx.color !== undefined ? mx.color : m.matrixColor,
          };
          nextNodes.splice(matrixIdx, 1);
          for (let i = nextConns.length - 1; i >= 0; i--) {
            if (nextConns[i].fromNodeId === mxId || nextConns[i].toNodeId === mxId) {
              nextConns.splice(i, 1);
            }
          }
          needsUpdate = true;
        }
        continue;
      }
      const inConns = nextConns.filter(c => c.toNodeId === m.id);
      const cA = inConns.find(c => c.toSlotId === 'A');
      const cB = inConns.find(c => c.toSlotId === 'B');
      const nA = cA ? nextNodes.find(n => n.id === cA.fromNodeId) : null;
      const nB = cB ? nextNodes.find(n => n.id === cB.fromNodeId) : null;
      // Resolve via the full chain so matmul whose A/B comes from another
      // module pipeline still computes its shape correctly.
      const shA = effectiveShape(nA);
      const shB = effectiveShape(nB);
      // matmul valid iff (ignoring leading BATCH) last dim of A equals first
      // non-batch dim of B.
      let shapesCompat = false;
      if (shA && shB && shA.length >= 2 && shB.length >= 2) {
        const aLast  = String(shA[shA.length - 1]);
        const bFirst = String(shB[shB.length - 2]); // second-to-last dim of B (PyTorch matmul convention)
        shapesCompat = aLast === bFirst;
      }
      const bothWired = !!(cA && cB) && shapesCompat;
      const matrixIdx = m.matrixId !== undefined
        ? nextNodes.findIndex(n => n.id === m.matrixId)
        : -1;

      // Output shape from A @ B: take A's full shape, replace its last dim
      // with B's last dim.
      const outShape = (shA && shB)
        ? [...shA.slice(0, -1), shB[shB.length - 1]]
        : [4, 4];

      if (bothWired && matrixIdx === -1) {
        // Spawn bound matrix. No auto-edge needed — matrix sits flush against
        // matmul's output side, so the binding is conveyed by adjacency alone.
        // User-customized name/color persist across despawn↔respawn via
        // m.matrixName / m.matrixColor stored on the matmul itself.
        const mxId = idSeed++;
        const pos = matrixPosFor(m);
        const matrix = {
          id: mxId, type: 'matrix',
          name:  m.matrixName  ?? 'out',
          color: m.matrixColor ?? undefined,
          shape: outShape,
          x: pos.x, y: pos.y, boundMatmulId: m.id,
        };
        m.matrixId = mxId;
        nextNodes.push(matrix);
        needsUpdate = true;
      } else if (!bothWired && matrixIdx !== -1) {
        // Despawn: stash matrix.name / matrix.color back onto the matmul so
        // the user's customization survives the next respawn. Replace m via
        // a new object so React snapshots/undo see the field changes.
        const mxId = m.matrixId;
        const mx = nextNodes[matrixIdx];
        const mIdx = nextNodes.indexOf(m);
        nextNodes[mIdx] = {
          ...m,
          matrixId: undefined,
          matrixName:  mx.name  !== undefined ? mx.name  : m.matrixName,
          matrixColor: mx.color !== undefined ? mx.color : m.matrixColor,
        };
        nextNodes.splice(matrixIdx, 1);
        // Remove all connections touching the matrix
        for (let i = nextConns.length - 1; i >= 0; i--) {
          if (nextConns[i].fromNodeId === mxId || nextConns[i].toNodeId === mxId) {
            nextConns.splice(i, 1);
          }
        }
        needsUpdate = true;
      } else if (bothWired && matrixIdx !== -1) {
        // Re-snap matrix position + recompute shape (inputs may have changed
        // since spawn). Diff-guard prevents setState loops. Also mirror the
        // user's current name/color back to the matmul so the next despawn
        // cycle has fresh values to remember.
        const pos = matrixPosFor(m);
        const mx = nextNodes[matrixIdx];
        const shapeDiff = JSON.stringify(mx.shape) !== JSON.stringify(outShape);
        if (mx.x !== pos.x || mx.y !== pos.y || shapeDiff) {
          nextNodes[matrixIdx] = { ...mx, x: pos.x, y: pos.y, shape: outShape };
          needsUpdate = true;
        }
        // Keep matmul.matrixName / matrixColor in sync with the live matrix
        // so the next despawn↔respawn cycle has fresh values. Replace m with
        // a new object + flag needsUpdate so React picks up the field changes.
        const nameDiff  = mx.name  !== undefined && m.matrixName  !== mx.name;
        const colorDiff = mx.color !== undefined && m.matrixColor !== mx.color;
        if (nameDiff || colorDiff) {
          const mIdx = nextNodes.indexOf(m);
          nextNodes[mIdx] = {
            ...m,
            matrixName:  nameDiff  ? mx.name  : m.matrixName,
            matrixColor: colorDiff ? mx.color : m.matrixColor,
          };
          needsUpdate = true;
        }
      }

      // Dim-error: both A and B wired with resolved shapes, but contraction
      // dims don't match (A last ≠ B second-to-last). Highlight the node.
      const matmulError = (cA && cB && shA && shB && !shapesCompat)
        ? `A[-1] = ${shA[shA.length-1]}  ≠  B[-2] = ${shB[shB.length-2]}`
        : null;
      const mErrIdx = nextNodes.findIndex(n => n.id === m.id);
      if (mErrIdx !== -1 && (nextNodes[mErrIdx]._dimError ?? null) !== matmulError) {
        nextNodes[mErrIdx] = { ...nextNodes[mErrIdx], _dimError: matmulError };
        needsUpdate = true;
      }
    }

    // ── MASKED_FILL → bound matrix ───────────────────────────────────────
    // Two-input op (slot 'x' tensor + 'mask') like matmul. Spawns ONE bound
    // matrix when both inputs are wired. Output shape = tensor (x) shape.
    // Non-terminal masked_fill suppresses its matrix (chain semantics).
    for (const m of nextNodes) {
      if (m.type !== 'masked_fill') continue;
      if (!isTerminal(m)) {
        const matrixIdx = m.matrixId !== undefined
          ? nextNodes.findIndex(n => n.id === m.matrixId) : -1;
        if (matrixIdx !== -1) {
          const mxId = m.matrixId;
          const mx = nextNodes[matrixIdx];
          const mIdx = nextNodes.indexOf(m);
          nextNodes[mIdx] = {
            ...m,
            matrixId: undefined,
            matrixName:  mx.name  !== undefined ? mx.name  : m.matrixName,
            matrixColor: mx.color !== undefined ? mx.color : m.matrixColor,
          };
          nextNodes.splice(matrixIdx, 1);
          for (let i = nextConns.length - 1; i >= 0; i--) {
            if (nextConns[i].fromNodeId === mxId || nextConns[i].toNodeId === mxId) {
              nextConns.splice(i, 1);
            }
          }
          needsUpdate = true;
        }
        continue;
      }
      const inConns = nextConns.filter(c => c.toNodeId === m.id);
      const cX = inConns.find(c => c.toSlotId === 'x');
      const cMask = inConns.find(c => c.toSlotId === 'mask');
      const nX    = cX    ? nextNodes.find(n => n.id === cX.fromNodeId)    : null;
      const nMask = cMask ? nextNodes.find(n => n.id === cMask.fromNodeId) : null;
      const shX = effectiveShape(nX);
      const shMask = effectiveShape(nMask);
      // PyTorch only requires mask broadcastable to x — keep it simple:
      // both shapes must resolve. (No dim mismatch check.)
      const bothWired = !!(cX && cMask) && !!shX && !!shMask;
      const matrixIdx = m.matrixId !== undefined
        ? nextNodes.findIndex(n => n.id === m.matrixId)
        : -1;
      const outShape = shX ? [...shX] : [4, 4];

      if (bothWired && matrixIdx === -1) {
        const mxId = idSeed++;
        const pos = matrixPosFor(m);
        const matrix = {
          id: mxId, type: 'matrix',
          name:  m.matrixName  ?? 'out',
          color: m.matrixColor ?? undefined,
          shape: outShape,
          x: pos.x, y: pos.y, boundMatmulId: m.id, // reuse field for shape-readonly hint
        };
        const mIdx = nextNodes.indexOf(m);
        nextNodes[mIdx] = { ...m, matrixId: mxId };
        nextNodes.push(matrix);
        needsUpdate = true;
      } else if (!bothWired && matrixIdx !== -1) {
        const mxId = m.matrixId;
        const mx = nextNodes[matrixIdx];
        const mIdx = nextNodes.indexOf(m);
        nextNodes[mIdx] = {
          ...m,
          matrixId: undefined,
          matrixName:  mx.name  !== undefined ? mx.name  : m.matrixName,
          matrixColor: mx.color !== undefined ? mx.color : m.matrixColor,
        };
        nextNodes.splice(matrixIdx, 1);
        for (let i = nextConns.length - 1; i >= 0; i--) {
          if (nextConns[i].fromNodeId === mxId || nextConns[i].toNodeId === mxId) {
            nextConns.splice(i, 1);
          }
        }
        needsUpdate = true;
      } else if (bothWired && matrixIdx !== -1) {
        const pos = matrixPosFor(m);
        const mx = nextNodes[matrixIdx];
        const shapeDiff = JSON.stringify(mx.shape) !== JSON.stringify(outShape);
        if (mx.x !== pos.x || mx.y !== pos.y || shapeDiff) {
          nextNodes[matrixIdx] = { ...mx, x: pos.x, y: pos.y, shape: outShape };
          needsUpdate = true;
        }
        const nameDiff  = mx.name  !== undefined && m.matrixName  !== mx.name;
        const colorDiff = mx.color !== undefined && m.matrixColor !== mx.color;
        if (nameDiff || colorDiff) {
          const mIdx = nextNodes.indexOf(m);
          nextNodes[mIdx] = {
            ...m,
            matrixName:  nameDiff  ? mx.name  : m.matrixName,
            matrixColor: colorDiff ? mx.color : m.matrixColor,
          };
          needsUpdate = true;
        }
      }
    }

    // ── LINEAR → N matrices ─────────────────────────────────────────────
    // Linear has ONE input gate that accepts arbitrarily many edges. Each
    // incoming edge whose source's last dim equals d_in spawns one bound
    // matrix; output shape per input = [...src.shape.slice(0,-1), d_out].
    // Matrices lay out one-after-another past the linear's output side.
    // Persisted state on the linear node:
    //   matrices: { [sourceConnId]: { matrixId, name, color } }

    // True iff a module has an outgoing edge whose target is another
    // module. Non-terminal modules don't spawn matrices — the chain's
    // matrices live at the terminal end only.
    function isTerminal(m) {
      for (const c of nextConns) {
        if (c.fromNodeId !== m.id) continue;
        const tn = nextNodes.find(n => n.id === c.toNodeId);
        if (tn && (tn.type === 'linear' || tn.type === 'relu' || tn.type === 'scale' || tn.type === 'transpose' || tn.type === 'softmax' || tn.type === 'triu' || tn.type === 'matmul' || tn.type === 'masked_fill' || tn.type === 'dropout' || tn.type === 'slice' || tn.type === 'view' || tn.type === 'contiguous' || tn.type === 'layernorm' || tn.type === 'add' || tn.type === 'conv2d')) {
          return false;
        }
      }
      return true;
    }

    // Recursive effective shape exposed by a node as an edge source.
    // Walks back through module chains so a terminal's input edge resolves
    // the full transform pipeline (matrix → linear → relu → terminal).
    // Cycle-safe via `visited` set; first-input rule for intermediates.
    function effectiveShape(src, visited = new Set()) {
      if (!src || visited.has(src.id)) return null;
      visited.add(src.id);
      if (src.type === 'matrix') return src.shape || null;
      if (src.type === 'matmul') {
        const ins = nextConns.filter(c => c.toNodeId === src.id);
        const cA = ins.find(c => c.toSlotId === 'A');
        const cB = ins.find(c => c.toSlotId === 'B');
        if (!cA || !cB) return null;
        const sA = effectiveShape(nextNodes.find(n => n.id === cA.fromNodeId), new Set(visited));
        const sB = effectiveShape(nextNodes.find(n => n.id === cB.fromNodeId), new Set(visited));
        if (!sA || !sB || sA.length < 2 || sB.length < 2) return null;
        if (String(sA[sA.length - 1]) !== String(sB[sB.length - 2])) return null;
        return [...sA.slice(0, -1), sB[sB.length - 1]];
      }
      if (src.type === 'masked_fill') {
        // masked_fill(x, mask, value) — output shape = x's shape.
        const ins = nextConns.filter(c => c.toNodeId === src.id);
        const cX = ins.find(c => c.toSlotId === 'x');
        if (!cX) return null;
        const sX = effectiveShape(nextNodes.find(n => n.id === cX.fromNodeId), new Set(visited));
        return sX ? [...sX] : null;
      }
      if (src.type === 'view') {
        const ins = nextConns.filter(c => c.toNodeId === src.id);
        if (!ins.length) return null;
        const upstream = effectiveShape(nextNodes.find(n => n.id === ins[0].fromNodeId), new Set(visited));
        if (!upstream) return null;
        const raw = String(src.shape ?? '-1').replace(/[()[\]]/g, '').trim();
        const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
        if (!parts.length) return null;
        // Symbolic output: preserve variable name strings; only resolve to numbers
        // when needed for -1 inference arithmetic.
        const isLiteralNum = s => /^-?\d+(\.\d+)?$/.test(s);
        const outputParts = parts.map(p =>
          p === '-1' ? -1 : isLiteralNum(p) ? parseFloat(p) : p // keep var names as strings
        );
        const negIdx = outputParts.indexOf(-1);
        if (negIdx === -1) return outputParts;
        // Infer -1: resolve everything numerically just for arithmetic.
        const resolveNum = d => typeof d === 'number' ? d : resolveValWithVars(String(d), varsRef.current);
        const inputTotal = upstream.reduce((acc, d) => acc === null ? null : (resolveNum(d) === null ? null : acc * resolveNum(d)), 1);
        if (inputTotal === null) return outputParts.map(v => v === -1 ? '?' : v);
        const otherProd = outputParts.reduce((acc, v, i) => {
          if (acc === null || i === negIdx) return acc;
          const n = resolveNum(v);
          return n !== null ? acc * n : null;
        }, 1);
        if (!otherProd) return outputParts.map(v => v === -1 ? '?' : v);
        const inferred = inputTotal / otherProd;
        // Try to express inferred dim as a variable name if one matches.
        const matchVar = varsRef.current.find(v => resolveValWithVars(v.name, varsRef.current) === inferred);
        return outputParts.map((v, i) => i === negIdx ? (matchVar ? matchVar.name : inferred) : v);
      }
      if (src.type === 'slice') {
        const ins = nextConns.filter(c => c.toNodeId === src.id);
        if (!ins.length) { return null; }
        const upstream = effectiveShape(nextNodes.find(n => n.id === ins[0].fromNodeId), new Set(visited));
        if (!upstream) return null;
        const raw = String(src.dims ?? ':').trim().replace(/^\[/, '').replace(/\]$/, '');
        const specs = raw.split(',').map(s => s.trim());
        const out = [...upstream];
        for (let i = 0; i < upstream.length; i++) {
          if (i >= specs.length) break;
          const spec = specs[i];
          if (spec === ':' || spec === '') continue;
          const parts = spec.split(':');
          if (parts.length < 2) continue;
          const startRaw = parts[0].trim();
          const endRaw   = parts[1].trim();
          const stepRaw  = parts[2]?.trim() ?? '';
          const start = startRaw === '' ? 0 : (resolveValWithVars(startRaw, varsRef.current) ?? 0);
          const end   = endRaw   === '' ? null : resolveValWithVars(endRaw, varsRef.current);
          const step  = stepRaw  === '' ? 1  : (resolveValWithVars(stepRaw, varsRef.current) ?? 1);
          if (end === null) { out[i] = endRaw; continue; } // unresolved var — keep as string
          out[i] = Math.max(0, Math.ceil((end - start) / step));
        }
        return out;
      }
      if (src.type === 'add') {
        const ins = nextConns.filter(c => c.toNodeId === src.id);
        if (ins.length < 2) { shapeCache && (shapeCache[src.id] = null); return null; }
        const shapes = ins.map(c => effectiveShape(nextNodes.find(n => n.id === c.fromNodeId), new Set(visited)));
        if (shapes.some(s => !s)) return null;
        const refStr = JSON.stringify(shapes[0]);
        if (!shapes.every(s => JSON.stringify(s) === refStr)) return null;
        return [...shapes[0]];
      }
      if (src.type === 'conv2d') {
        const ins = nextConns.filter(c => c.toNodeId === src.id);
        if (!ins.length) return null;
        const upstream = effectiveShape(nextNodes.find(n => n.id === ins[0].fromNodeId), new Set(visited));
        if (!upstream || upstream.length !== 4) return null;
        const inCh = src.in_channels ?? 1;
        const inChStr = String(inCh);
        const upCh = String(upstream[1]);
        const chMatch = upCh === inChStr || (() => {
          const a = resolveValWithVars(upCh, varsRef.current);
          const b = resolveValWithVars(inChStr, varsRef.current);
          return a !== null && b !== null && a === b;
        })();
        if (!chMatch) return null;
        const parseConvParam = (val, def) => { const str = String(val ?? def).replace(/[()[\]\s]/g, ''); const parts = str.split(',').map(s => Number(s.trim())); if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]]; const n = Number(parts[0]); return [isNaN(n) ? def : n, isNaN(n) ? def : n]; };
        const [kH, kW] = parseConvParam(src.kernel_size, 3);
        const [sH, sW] = parseConvParam(src.stride, 1);
        const [pH, pW] = parseConvParam(src.padding, 0);
        const [dH, dW] = parseConvParam(src.dilation, 1);
        const H = resolveValWithVars(String(upstream[2]), varsRef.current);
        const W = resolveValWithVars(String(upstream[3]), varsRef.current);
        const Hout = H !== null ? Math.floor((H + 2 * pH - dH * (kH - 1) - 1) / sH) + 1 : '?';
        const Wout = W !== null ? Math.floor((W + 2 * pW - dW * (kW - 1) - 1) / sW) + 1 : '?';
        return [upstream[0], src.out_channels ?? 1, Hout, Wout];
      }
      if (src.type === 'linear' || src.type === 'relu' || src.type === 'scale' || src.type === 'transpose' || src.type === 'softmax' || src.type === 'triu' || src.type === 'dropout' || src.type === 'contiguous' || src.type === 'layernorm') {
        const ins = nextConns.filter(c => c.toNodeId === src.id);
        if (!ins.length) return null;
        const upstream = effectiveShape(nextNodes.find(n => n.id === ins[0].fromNodeId), new Set(visited));
        if (!upstream) return null;
        if (src.type === 'relu' || src.type === 'scale' || src.type === 'softmax' || src.type === 'triu' || src.type === 'dropout' || src.type === 'contiguous' || src.type === 'layernorm') return [...upstream];
        if (src.type === 'transpose') {
          // torch.transpose(input, dim0, dim1) — swap two dims; negatives wrap.
          const L = upstream.length;
          let d0 = Number(src.dim0 ?? -2);
          let d1 = Number(src.dim1 ?? -1);
          if (d0 < 0) d0 = L + d0;
          if (d1 < 0) d1 = L + d1;
          if (d0 < 0 || d1 < 0 || d0 >= L || d1 >= L) return null;
          const out = [...upstream];
          [out[d0], out[d1]] = [out[d1], out[d0]];
          return out;
        }
        // linear — compare string first (fast path), then fall back to
        // resolved numeric comparison so symbolic dims like 'd_k' = 64
        // match a numeric d_in = 64 and vice versa.
        const dInStr = String(src.d_in ?? 4);
        const upLast = String(upstream[upstream.length - 1]);
        const dimsMatchEff = upLast === dInStr ||
          (() => {
            const a = resolveValWithVars(upLast, varsRef.current);
            const b = resolveValWithVars(dInStr, varsRef.current);
            return a !== null && b !== null && a === b;
          })();
        if (!dimsMatchEff) return null;
        return [...upstream.slice(0, -1), src.d_out ?? 4];
      }
      return null;
    }

    // Despawn all bound matrices on a (now non-terminal) module. Stashes
    // name/color into each entry so re-promotion to terminal restores them.
    function despawnAllMatrices(mod) {
      const matrices = { ...(mod.matrices || {}) };
      let anyDespawned = false;
      for (const connId of Object.keys(matrices)) {
        const entry = matrices[connId];
        if (entry?.matrixId === undefined) continue;
        const mi = nextNodes.findIndex(n => n.id === entry.matrixId);
        if (mi !== -1) {
          const mx = nextNodes[mi];
          if (mx.name  !== undefined) entry.name  = mx.name;
          if (mx.color !== undefined) entry.color = mx.color;
          nextNodes.splice(mi, 1);
          for (let i = nextConns.length - 1; i >= 0; i--) {
            if (nextConns[i].fromNodeId === entry.matrixId || nextConns[i].toNodeId === entry.matrixId) {
              nextConns.splice(i, 1);
            }
          }
          anyDespawned = true;
        }
        entry.matrixId = undefined;
      }
      if (anyDespawned) {
        const idx = nextNodes.indexOf(mod);
        nextNodes[idx] = { ...mod, matrices };
        needsUpdate = true;
      }
    }
    const linearMatrixPosFor = (lin, idx) => {
      const out = getOutputSlotPos(lin);
      const rot = lin.rot ?? 0;
      // First matrix flush against linear, each subsequent one shifted along
      // the same axis. idx 0 = closest, idx N = farthest.
      switch (rot) {
        case 0: return { x: out.x + idx * NODE_SIZE,            y: out.y - NODE_SIZE / 2 };
        case 1: return { x: out.x - NODE_SIZE / 2,              y: out.y + idx * NODE_SIZE };
        case 2: return { x: out.x - NODE_SIZE - idx * NODE_SIZE, y: out.y - NODE_SIZE / 2 };
        case 3: return { x: out.x - NODE_SIZE / 2,              y: out.y - NODE_SIZE - idx * NODE_SIZE };
      }
    };

    for (const lin of nextNodes) {
      if (lin.type !== 'linear' && lin.type !== 'relu' && lin.type !== 'scale' && lin.type !== 'transpose' && lin.type !== 'softmax' && lin.type !== 'triu' && lin.type !== 'dropout' && lin.type !== 'slice' && lin.type !== 'view' && lin.type !== 'contiguous' && lin.type !== 'layernorm' && lin.type !== 'add' && lin.type !== 'conv2d') continue;

      // ── Add: N inputs → 1 output matrix (all shapes must match) ──────────
      if (lin.type === 'add') {
        const despawnAdd = () => {
          const mats = { ...(lin.matrices || {}) };
          let changed = false;
          for (const k of Object.keys(mats)) {
            const e = mats[k];
            if (e?.matrixId === undefined) continue;
            const mi = nextNodes.findIndex(n => n.id === e.matrixId);
            if (mi !== -1) {
              const mx = nextNodes[mi];
              if (mx.name  !== undefined) e.name  = mx.name;
              if (mx.color !== undefined) e.color = mx.color;
              nextNodes.splice(mi, 1);
              for (let i = nextConns.length - 1; i >= 0; i--) {
                if (nextConns[i].fromNodeId === e.matrixId || nextConns[i].toNodeId === e.matrixId) nextConns.splice(i, 1);
              }
            }
            e.matrixId = undefined;
            changed = true;
          }
          // Always clear _dimError when despawning (covers shape-mismatch → disconnect path)
          const linIdx = nextNodes.findIndex(n => n.id === lin.id);
          const hasDimErr = linIdx !== -1 && nextNodes[linIdx]._dimError;
          if (changed || hasDimErr) {
            if (linIdx !== -1) nextNodes[linIdx] = { ...lin, matrices: mats, _dimError: undefined };
            needsUpdate = true;
          }
        };
        if (!isTerminal(lin)) { despawnAdd(); continue; }
        const inConns = nextConns.filter(c => c.toNodeId === lin.id);
        if (inConns.length < 2) { despawnAdd(); continue; }
        const shapes = inConns.map(c => effectiveShape(nextNodes.find(n => n.id === c.fromNodeId)));
        if (shapes.some(s => !s)) { despawnAdd(); continue; }
        const refStr = JSON.stringify(shapes[0]);
        if (!shapes.every(s => JSON.stringify(s) === refStr)) {
          despawnAdd();
          const idx = nextNodes.findIndex(n => n.id === lin.id);
          const uniqueShapes = [...new Set(shapes.map(s => JSON.stringify(s)))].map(s => JSON.parse(s));
          const shapeStrs = uniqueShapes.map(s => '(' + s.join(', ') + ')').join(' ≠ ');
          if (idx !== -1) nextNodes[idx] = { ...nextNodes[idx], _dimError: shapeStrs };
          needsUpdate = true;
          continue;
        }
        // Clear any dim error
        { const idx = nextNodes.findIndex(n => n.id === lin.id); if (idx !== -1 && nextNodes[idx]._dimError) { nextNodes[idx] = { ...nextNodes[idx], _dimError: undefined }; needsUpdate = true; } }
        const outShape = shapes[0];
        const mats = { ...(lin.matrices || {}) };
        const entry = mats['__add_out__'] || (mats['__add_out__'] = {});
        // Remove stale keys
        for (const k of Object.keys(mats)) {
          if (k !== '__add_out__') {
            const e = mats[k];
            if (e?.matrixId !== undefined) { const mi = nextNodes.findIndex(n => n.id === e.matrixId); if (mi !== -1) nextNodes.splice(mi, 1); }
            delete mats[k]; needsUpdate = true;
          }
        }
        const pos = linearMatrixPosFor(lin, 0);
        if (entry.matrixId === undefined || !nextNodes.some(n => n.id === entry.matrixId)) {
          const mxId = idSeed++;
          entry.matrixId = mxId;
          nextNodes.push({ id: mxId, type: 'matrix', name: entry.name ?? 'out', color: entry.color ?? undefined, shape: outShape, x: pos.x, y: pos.y, boundLinearId: lin.id, boundLinearConnId: '__add_out__' });
          needsUpdate = true;
        } else {
          const mi = nextNodes.findIndex(n => n.id === entry.matrixId);
          const mx = nextNodes[mi];
          if (mx.x !== pos.x || mx.y !== pos.y || JSON.stringify(mx.shape) !== JSON.stringify(outShape)) {
            nextNodes[mi] = { ...mx, x: pos.x, y: pos.y, shape: outShape };
            needsUpdate = true;
          }
          if (mx.name  !== undefined && entry.name  !== mx.name)  { entry.name  = mx.name;  needsUpdate = true; }
          if (mx.color !== undefined && entry.color !== mx.color) { entry.color = mx.color; needsUpdate = true; }
        }
        if (JSON.stringify(lin.matrices) !== JSON.stringify(mats)) {
          const idx = nextNodes.findIndex(n => n.id === lin.id);
          if (idx !== -1) nextNodes[idx] = { ...nextNodes[idx], matrices: mats };
          needsUpdate = true;
        }
        continue;
      }

      // Only the LAST module in a chain spawns matrices. Intermediate
      // modules (those with an outgoing edge to another module) are silent
      // — their transform composes into the terminal's effective shape via
      // effectiveShape().
      if (!isTerminal(lin)) { despawnAllMatrices(lin); continue; }
      // Per-module output-shape transform applied to each input source's shape.
      //   linear:  [...src.shape.slice(0,-1), d_out]  (requires src last == d_in)
      //   relu:    src.shape                          (passthrough, any shape)
      const dInStr = lin.type === 'linear' ? String(lin.d_in ?? 4) : null;
      const dOut   = lin.type === 'linear' ? (lin.d_out ?? 4)      : null;
      const linInConns = nextConns.filter(c => c.toNodeId === lin.id);
      const matrices = { ...(lin.matrices || {}) };
      let matricesChanged = false;
      let anyDimMismatch = false; // tracks upstream dim ≠ d_in for error display

      // Pass 1: drop entries whose source conn vanished (incl. despawn matrix)
      for (const connId of Object.keys(matrices)) {
        if (!linInConns.some(c => String(c.id) === connId)) {
          const entry = matrices[connId];
          if (entry?.matrixId !== undefined) {
            const mi = nextNodes.findIndex(n => n.id === entry.matrixId);
            if (mi !== -1) {
              const mx = nextNodes[mi];
              // stash latest customization before drop
              if (mx.name  !== undefined) entry.name  = mx.name;
              if (mx.color !== undefined) entry.color = mx.color;
              nextNodes.splice(mi, 1);
              for (let i = nextConns.length - 1; i >= 0; i--) {
                if (nextConns[i].fromNodeId === entry.matrixId || nextConns[i].toNodeId === entry.matrixId) {
                  nextConns.splice(i, 1);
                }
              }
            }
          }
          delete matrices[connId];
          matricesChanged = true;
        }
      }

      // Pass 2: walk inputs in array order; spawn / re-snap / despawn-on-shape-mismatch
      let visibleIdx = 0;
      for (const c of linInConns) {
        const src = nextNodes.find(n => n.id === c.fromNodeId);
        // srcShape from full chain walk-back (matrix or composed module
        // pipeline). Terminal module spawns one matrix per input edge.
        const srcShape = effectiveShape(src);
        const srcLast = srcShape?.length ? String(srcShape[srcShape.length - 1]) : null;
        // Per-module shape transform:
        //   relu / scale: passthrough
        //   linear:       last dim swapped to d_out (requires src last == d_in)
        //   transpose:    swap dim0 ↔ dim1 (negatives wrap)
        let outShape = null;
        let compat = false;
        if (srcShape) {
          if (lin.type === 'relu' || lin.type === 'scale' || lin.type === 'softmax' || lin.type === 'triu' || lin.type === 'contiguous' || lin.type === 'layernorm') {
            outShape = [...srcShape];
            compat = true;
          } else if (lin.type === 'transpose') {
            const L = srcShape.length;
            let d0 = Number(lin.dim0 ?? -2);
            let d1 = Number(lin.dim1 ?? -1);
            if (d0 < 0) d0 = L + d0;
            if (d1 < 0) d1 = L + d1;
            if (d0 >= 0 && d1 >= 0 && d0 < L && d1 < L) {
              outShape = [...srcShape];
              [outShape[d0], outShape[d1]] = [outShape[d1], outShape[d0]];
              compat = true;
            }
          } else if (lin.type === 'dropout') {
            outShape = [...srcShape];
            compat = true;
          } else if (lin.type === 'slice' || lin.type === 'view') {
            // effectiveShape already encodes the full transform for these.
            const computed = effectiveShape(lin);
            if (computed) { outShape = computed; compat = true; }
          } else if (lin.type === 'conv2d') {
            if (srcShape.length === 4) {
              const inCh = lin.in_channels ?? 1;
              const inChStr = String(inCh);
              const upCh = String(srcShape[1]);
              const chMatch = upCh === inChStr || (() => {
                const a = resolveValWithVars(upCh, varsRef.current);
                const b = resolveValWithVars(inChStr, varsRef.current);
                return a !== null && b !== null && a === b;
              })();
              if (chMatch) {
                const parseConvParam = (val, def) => { const str = String(val ?? def).replace(/[()[\]\s]/g, ''); const parts = str.split(',').map(s => Number(s.trim())); if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]]; const n = Number(parts[0]); return [isNaN(n) ? def : n, isNaN(n) ? def : n]; };
                const [kH, kW] = parseConvParam(lin.kernel_size, 3);
                const [sH, sW] = parseConvParam(lin.stride, 1);
                const [pH, pW] = parseConvParam(lin.padding, 0);
                const [dH, dW] = parseConvParam(lin.dilation, 1);
                const H = resolveValWithVars(String(srcShape[2]), varsRef.current);
                const W = resolveValWithVars(String(srcShape[3]), varsRef.current);
                const Hout = H !== null ? Math.floor((H + 2 * pH - dH * (kH - 1) - 1) / sH) + 1 : '?';
                const Wout = W !== null ? Math.floor((W + 2 * pW - dW * (kW - 1) - 1) / sW) + 1 : '?';
                outShape = [srcShape[0], lin.out_channels ?? 1, Hout, Wout];
                compat = true;
              } else {
                anyDimMismatch = true;
              }
            } else {
              anyDimMismatch = true;
            }
          } else if (srcLast !== null) {
            // linear — string compare first, then resolved numeric fallback
            // so symbolic 'd_k'=64 matches numeric d_in=64 and vice versa.
            const dimsMatch = srcLast === dInStr ||
              (() => {
                const a = resolveValWithVars(srcLast, varsRef.current);
                const b = resolveValWithVars(dInStr, varsRef.current);
                return a !== null && b !== null && a === b;
              })();
            if (dimsMatch) {
              outShape = [...srcShape.slice(0, -1), dOut];
              compat = true;
            } else {
              anyDimMismatch = true; // upstream resolved but dims don't match d_in
            }
          }
        }
        const entry = matrices[c.id] || (matrices[c.id] = {});

        if (compat) {
          const pos = linearMatrixPosFor(lin, visibleIdx);
          if (entry.matrixId === undefined || !nextNodes.some(n => n.id === entry.matrixId)) {
            // Spawn
            const mxId = idSeed++;
            entry.matrixId = mxId;
            const matrix = {
              id: mxId, type: 'matrix',
              name:  entry.name  ?? 'out',
              color: entry.color ?? undefined,
              shape: outShape || [dOut],
              x: pos.x, y: pos.y,
              boundLinearId: lin.id, boundLinearConnId: c.id,
            };
            nextNodes.push(matrix);
            matricesChanged = true;
          } else {
            // Re-snap pos/shape + mirror name/color back to entry
            const mi = nextNodes.findIndex(n => n.id === entry.matrixId);
            const mx = nextNodes[mi];
            const shapeDiff = JSON.stringify(mx.shape) !== JSON.stringify(outShape);
            if (mx.x !== pos.x || mx.y !== pos.y || shapeDiff) {
              nextNodes[mi] = { ...mx, x: pos.x, y: pos.y, shape: outShape || mx.shape };
              matricesChanged = true;
            }
            if (mx.name  !== undefined && entry.name  !== mx.name)  { entry.name  = mx.name;  matricesChanged = true; }
            if (mx.color !== undefined && entry.color !== mx.color) { entry.color = mx.color; matricesChanged = true; }
          }
          visibleIdx++;
        } else {
          // Incompatible: despawn (stash, keep entry for restore-on-fix)
          if (entry.matrixId !== undefined) {
            const mi = nextNodes.findIndex(n => n.id === entry.matrixId);
            if (mi !== -1) {
              const mx = nextNodes[mi];
              if (mx.name  !== undefined) entry.name  = mx.name;
              if (mx.color !== undefined) entry.color = mx.color;
              nextNodes.splice(mi, 1);
              for (let i = nextConns.length - 1; i >= 0; i--) {
                if (nextConns[i].fromNodeId === entry.matrixId || nextConns[i].toNodeId === entry.matrixId) {
                  nextConns.splice(i, 1);
                }
              }
              matricesChanged = true;
            }
            entry.matrixId = undefined;
          }
        }
      }

      const linError = (lin.type === 'linear' && anyDimMismatch)
        ? `d_in (${dInStr}) ≠ upstream last dim`
        : (lin.type === 'conv2d' && anyDimMismatch)
        ? `in_channels (${lin.in_channels ?? 1}) ≠ upstream C or not 4D`
        : null;
      const prevLinError = lin._dimError ?? null;
      if (matricesChanged || linError !== prevLinError) {
        const linIdx = nextNodes.indexOf(lin);
        nextNodes[linIdx] = { ...lin, matrices, _dimError: linError };
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      setNodes(nextNodes);
      setConnections(nextConns);
    }
  }, [nodes, connections, hydrated]);

  const nodesRef       = useRef([]);
  const connectionsRef = useRef([]);
  const selectedIdsRef     = useRef(new Set());
  const selectedConnIdsRef = useRef(new Set());
  const nodeEls        = useRef(new Map());
  const movedRef       = useRef(false);
  const clipboardRef   = useRef(null);
  // ── undo/redo history ─────────────────────────────────────────────────
  // Refs (not state) so they don't drive re-renders. Snapshots are JSON
  // strings of {nodes, connections}. Adjacent mutations within COALESCE_MS
  // (covers binding-effect follow-ups) collapse into a single history entry.
  const undoStackRef    = useRef([]);
  const redoStackRef    = useRef([]);
  const lastSnapRef     = useRef(null);
  const lastSnapTimeRef = useRef(0);
  const undoLockRef     = useRef(false);  // true while applying undo/redo
const toolModeRef    = useRef('pan');
  const selRectRef     = useRef(null);
  const isSelectingRef = useRef(false);
  const pendingConnRef = useRef(null); // { fromNodeId, mouseX, mouseY }
  const draggingVertRef= useRef(null); // { connId, vertexIdx }

  const setNodesRef           = useRef(setNodes);           setNodesRef.current           = setNodes;
  const setConnectionsRef     = useRef(setConnections);     setConnectionsRef.current     = setConnections;
  const setSelectedIdsRef     = useRef(setSelectedIds);     setSelectedIdsRef.current     = setSelectedIds;
  const setSelectedConnIdsRef = useRef(setSelectedConnIds); setSelectedConnIdsRef.current = setSelectedConnIds;

  useEffect(() => {
    varsRef.current = vars;
    if (hydrated) {
      try { localStorage.setItem('tb_vars', JSON.stringify(vars)); } catch {}
    }
    drawRef.current?.();
  }, [vars, hydrated]);

  // ── Undo/redo history tracker ────────────────────────────────────────
  // Compares serialized snapshot against last; pushes prev snap to undo
  // stack on diff. COALESCE window prevents binding-effect follow-ups from
  // splitting one user action into multiple history entries.
  const COALESCE_MS = 200;
  useEffect(() => {
    if (!hydrated) return;
    const snap = JSON.stringify({ nodes, connections, superboxes });
    if (undoLockRef.current) {
      lastSnapRef.current = snap;
      undoLockRef.current = false;
      return;
    }
    if (lastSnapRef.current !== null && lastSnapRef.current !== snap) {
      const now = Date.now();
      const stack = undoStackRef.current;
      if (stack.length && now - lastSnapTimeRef.current < COALESCE_MS) {
        // Collapse: keep the older "before user action" snap, drop in-flight
        // effect-driven intermediates.
      } else {
        stack.push(lastSnapRef.current);
        if (stack.length > 100) stack.shift();
      }
      redoStackRef.current.length = 0;
      lastSnapTimeRef.current = now;
    }
    lastSnapRef.current = snap;
  }, [nodes, connections, superboxes, hydrated]);

  const doUndo = () => {
    const stack = undoStackRef.current;
    if (!stack.length) return;
    const cur = JSON.stringify({ nodes: nodesRef.current, connections: connectionsRef.current, superboxes: superboxesRef.current });
    redoStackRef.current.push(cur);
    const prev = stack.pop();
    const parsed = JSON.parse(prev);
    undoLockRef.current = true;
    setNodes(parsed.nodes || []);
    setConnections(parsed.connections || []);
    setSuperboxes(parsed.superboxes || []);
    setSelectedIds(new Set());
    setSelectedConnIds(new Set());
  };

  const doRedo = () => {
    const stack = redoStackRef.current;
    if (!stack.length) return;
    const cur = JSON.stringify({ nodes: nodesRef.current, connections: connectionsRef.current, superboxes: superboxesRef.current });
    undoStackRef.current.push(cur);
    const next = stack.pop();
    const parsed = JSON.parse(next);
    undoLockRef.current = true;
    setNodes(parsed.nodes || []);
    setConnections(parsed.connections || []);
    setSuperboxes(parsed.superboxes || []);
    setSelectedIds(new Set());
    setSelectedConnIds(new Set());
  };

  const doUndoRef = useRef(doUndo); doUndoRef.current = doUndo;
  const doRedoRef = useRef(doRedo); doRedoRef.current = doRedo;

  const addVar    = () => setVars(v => [...v, { name:'', value:'' }]);
  const removeVar = i  => { if (i===0) return; setVars(v => v.filter((_,j) => j!==i)); };
  const updateVar = (i,f,val) => setVars(v => v.map((vr,j) => j===i ? {...vr,[f]:val} : vr));

  // ── Slot finders (close over refs) ──
  function findNearestOutputSlot(wx, wy) {
    let best = null, minD = 18;
    for (const n of nodesRef.current) {
      const p = getOutputSlotPos(n);
      const d = Math.hypot(wx-p.x, wy-p.y);
      if (d < minD) { minD = d; best = { node:n, slotId:'out', pos:p }; }
    }
    return best;
  }
  function findNearestInputSlot(wx, wy, excludeId) {
    let best = null, minD = 18;
    for (const n of nodesRef.current) {
      if (n.id === excludeId) continue;
      if (n.type === 'matmul') {
        for (const sid of ['A','B']) {
          const p = getInputSlotPos(n, sid);
          const d = Math.hypot(wx-p.x, wy-p.y);
          if (d < minD) { minD = d; best = { node:n, slotId:sid, side:null, pos:p }; }
        }
      } else if (n.type === 'masked_fill') {
        // Two named input slots — 'x' (the tensor) and 'mask'.
        for (const sid of ['x','mask']) {
          const p = getInputSlotPos(n, sid);
          const d = Math.hypot(wx-p.x, wy-p.y);
          if (d < minD) { minD = d; best = { node:n, slotId:sid, side:null, pos:p }; }
        }
      } else if (n.type === 'linear' || n.type === 'relu' || n.type === 'scale' || n.type === 'transpose' || n.type === 'softmax' || n.type === 'triu' || n.type === 'dropout' || n.type === 'slice' || n.type === 'view' || n.type === 'contiguous' || n.type === 'layernorm' || n.type === 'add' || n.type === 'conv2d') {
        // Three input gates: every side except the rot-determined output.
        const outSide = rotToOutSide(n.rot);
        for (const side of ALL_SIDES) {
          if (side === outSide) continue;
          const p = sideToPos(n, side);
          const d = Math.hypot(wx-p.x, wy-p.y);
          if (d < minD) { minD = d; best = { node:n, slotId:'in', side, pos:p }; }
        }
      }
    }
    return best;
  }

  // ── Free position ──
  function freePos(x, y, excludeIds = new Set()) {
    let nx=x, ny=y;
    while (nodesRef.current.some(n => !excludeIds.has(n.id) && n.x===nx && n.y===ny)) nx += SPACING;
    return { x:nx, y:ny };
  }

  // ── Position node DOM overlays ──
  function positionNodes() {
    const cam = camRef.current, sel = selectedIdsRef.current;
    for (const node of nodesRef.current) {
      const el = nodeEls.current.get(node.id);
      if (!el) continue;
      el.style.left      = ((node.x - cam.x) * cam.zoom) + 'px';
      el.style.top       = ((node.y - cam.y) * cam.zoom) + 'px';
      el.style.transform = `scale(${cam.zoom})`;
      const s = sel.has(node.id);
      el.style.outline   = s ? '2px solid #ee4c2c' : 'none';
      // No drop shadow — when nodes stack adjacently (matmul + matrix,
      // linear's row of bound matrices) the shadow would darken the
      // neighbor underneath. Keep only the selection ring.
      el.style.boxShadow = s
        ? '0 0 0 4px rgba(238,76,44,0.15)'
        : 'none';
    }
  }

  // sync refs + side-effects
  useEffect(() => {
    nodesRef.current = nodes;
    positionNodes(); drawRef.current?.();
    if (hydrated) {
      try { localStorage.setItem('tb_nodes', JSON.stringify(nodes)); } catch {}
    }
  }, [nodes, hydrated]);

  useEffect(() => {
    connectionsRef.current = connections;
    drawRef.current?.();
    if (hydrated) {
      try { localStorage.setItem('tb_conns', JSON.stringify(connections)); } catch {}
    }
  }, [connections, hydrated]);


  useEffect(() => {
    selectedIdsRef.current = selectedIds;
    positionNodes(); drawRef.current?.();
    const arr = [...selectedIds];
    const node = arr.length===1 ? nodesRef.current.find(n=>n.id===arr[0]) : null;
    window.dispatchEvent(new CustomEvent('nodeselect', { detail: node ?? null }));
    // Node click → always clear group panel and deselect superbox.
    // Group panel only shown when user directly clicks group background (canvas down() path).
    if (node) {
      selectedSuperboxIdRef.current = null;
      window.dispatchEvent(new CustomEvent('groupselect', { detail: null }));
    } else if (selectedSuperboxIdRef.current === null) {
      window.dispatchEvent(new CustomEvent('groupselect', { detail: null }));
    }
  }, [selectedIds]);

  useEffect(() => {
    selectedConnIdsRef.current = selectedConnIds;
    drawRef.current?.();
  }, [selectedConnIds]);

  useEffect(() => {
    const h = (e) => setNodesRef.current(prev => prev.map(n => n.id===e.detail.id ? {...n,...e.detail} : n));
    window.addEventListener('nodeupdate', h);
    return () => window.removeEventListener('nodeupdate', h);
  }, []);

  useEffect(() => {
    superboxesRef.current = superboxes;
    drawRef.current?.();
    if (hydrated) {
      try { localStorage.setItem('tb_groups', JSON.stringify(superboxes)); } catch {}
    }
  }, [superboxes, hydrated]);

  // ── Superbox sync helpers (component-level so handleNodeMouseDown can call them) ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  function syncLayerMembershipOuter() {
    const sbs = superboxesRef.current;
    const ns  = nodesRef.current;
    for (const sb of sbs) sb.layerIds = [];
    for (const n of ns) {
      const cx = n.x + NODE_SIZE / 2, cy = n.y + NODE_SIZE / 2;
      let best = null, bestArea = Infinity;
      for (const sb of sbs) {
        if (cx >= sb.x && cx <= sb.x + sb.w &&
            cy >= sb.y && cy <= sb.y + sb.h) {
          const area = sb.w * sb.h;
          if (area < bestArea) { best = sb; bestArea = area; }
        }
      }
      if (best) best.layerIds.push(n.id);
    }
  }
  function commitSuperboxesOuter() {
    setSuperboxes([...superboxesRef.current]);
  }

  // ── Main canvas effect ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const stage = canvas.parentElement;
    const cam = camRef.current;
    let dpr=1, initialized=false;

    // world-info RAF
    let rafId, fc=0, fps=0, lastT=performance.now();
    function worldInfoLoop() {
      fc++;
      const now = performance.now();
      if (now-lastT >= 500) { fps=Math.round(fc*1000/(now-lastT)); fc=0; lastT=now; }
      // HUD POS = world coords at the VIEW CENTER, not the camera top-left.
      // That way the user lands on (0, 0) when the page opens centered on
      // the origin, instead of seeing a confusing negative half-screen.
      const r = stage.getBoundingClientRect();
      const cx = cam.x + (r.width  / 2) / cam.zoom;
      const cy = cam.y + (r.height / 2) / cam.zoom;
      // Count learnable parameters across all module nodes.
      // Only nn.Linear has trainable weights; all other ops are param-free.
      // Use resolveValWithVars so variable-name dims (e.g. "B", "T") resolve correctly.
      let totalParams = 0;
      let paramsValid = true;
      const resolvedVars = resolveVars(varsRef.current, nodesRef.current);
      const batchName = varsRef.current[0]?.name ?? 'BATCH';
      const resolveD = (s, fallback) => {
        const key = String(s ?? '').trim();
        // Batch dim is never a feature dim — refuse to use it in param math.
        if (key === batchName) return null;
        const v = resolveValWithVars(s ?? fallback, varsRef.current);
        if (v !== null && !isNaN(v)) return v;
        if (key in resolvedVars && !isNaN(resolvedVars[key])) return resolvedVars[key];
        return null;
      };
      for (const n of nodesRef.current) {
        if (n.type === 'linear') {
          const dIn  = resolveD(n.d_in,  4);
          const dOut = resolveD(n.d_out, 4);
          if (dIn === null || dOut === null) { paramsValid = false; break; }
          totalParams += dIn * dOut + (n.bias !== false ? dOut : 0);
        } else if (n.type === 'layernorm' && n.elementwise_affine !== false) {
          const ns = resolveD(n.normalized_shape, 4);
          if (ns === null) { paramsValid = false; break; }
          totalParams += ns + (n.ln_bias !== false ? ns : 0);
        } else if (n.type === 'conv2d') {
          const inCh  = resolveD(n.in_channels,  1);
          const outCh = resolveD(n.out_channels, 1);
          const g     = resolveD(n.groups,       1);
          if (inCh === null || outCh === null || g === null) { paramsValid = false; break; }
          const parseK = (val, def) => { const str = String(val ?? def).replace(/[()[\]\s]/g, ''); const parts = str.split(',').map(s => Number(s.trim())); if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return parts[0] * parts[1]; const n = Number(parts[0]); return isNaN(n) ? def * def : n * n; };
          const kArea = parseK(n.kernel_size, 3);
          totalParams += outCh * (inCh / g) * kArea + (n.bias !== false ? outCh : 0);
        }
      }
      window.dispatchEvent(new CustomEvent('worldinfo',{ detail:{x:cx,y:cy,zoom:cam.zoom,fps,params:paramsValid ? totalParams : null} }));
      rafId = requestAnimationFrame(worldInfoLoop);
    }
    worldInfoLoop();

    // Persist group name changes originating in RightSidebar
    function onGroupNameUpdate(e) {
      const sb = superboxesRef.current.find(s => s.id === e.detail.id);
      if (sb) {
        sb.name = e.detail.name;
        commitSuperboxes();
        draw();
      }
    }

    function onGroupColorUpdate(e) {
      const sb = superboxesRef.current.find(s => s.id === e.detail.id);
      if (sb) {
        sb.colorIdx = e.detail.colorIdx;
        commitSuperboxes();
        draw();
      }
    }

    function positionPanel() {
      // Pin the Variables panel to the top-left of the viewport (screen
      // coords), independent of pan/zoom. Previously it was anchored to
      // world (0, 0) which placed it in the middle of the canvas — forced
      // the user to scroll away every time.
      const p = panelRef.current; if (!p) return;
      p.style.left = '12px';
      p.style.top  = '12px';
      p.style.transform = 'scale(0.75)';
      p.style.transformOrigin = 'top left';
    }

    // ── Superbox utilities ─────────────────────────────────────────────────
    function snapToGrid(v) { return Math.round(v / SPACING) * SPACING; }

    // For each SB, find the tightest containing SB with strictly larger area.
    function syncSbParentIds() {
      const sbs = superboxesRef.current;
      for (const sb of sbs) {
        const cx = sb.x + sb.w / 2, cy = sb.y + sb.h / 2;
        let best = null, bestArea = Infinity;
        for (const other of sbs) {
          if (other.id === sb.id) continue;
          const area = other.w * other.h;
          if (area <= sb.w * sb.h) continue;
          if (area >= bestArea) continue;
          if (cx >= other.x && cx <= other.x + other.w &&
              cy >= other.y && cy <= other.y + other.h) {
            best = other.id; bestArea = area;
          }
        }
        sb.parentId = best;
      }
    }

    // Assign each node to deepest (smallest area) containing SB only.
    function syncLayerMembership() {
      const sbs = superboxesRef.current;
      const ns  = nodesRef.current;
      for (const sb of sbs) sb.layerIds = [];
      for (const n of ns) {
        const cx = n.x + NODE_SIZE / 2, cy = n.y + NODE_SIZE / 2;
        let best = null, bestArea = Infinity;
        for (const sb of sbs) {
          if (cx >= sb.x && cx <= sb.x + sb.w &&
              cy >= sb.y && cy <= sb.y + sb.h) {
            const area = sb.w * sb.h;
            if (area < bestArea) { best = sb; bestArea = area; }
          }
        }
        if (best) best.layerIds.push(n.id);
      }
    }

    function syncAll() { syncSbParentIds(); syncLayerMembership(); }

    function hitTestSuperbox(wx, wy) {
      const sbs = superboxesRef.current;
      // Build depth map for deepest-first search
      const parentMap = new Map();
      for (const sb of sbs) if (sb.parentId) parentMap.set(sb.id, sb.parentId);
      const depth = (id) => {
        let d = 0, cur = id;
        while (parentMap.has(cur)) { cur = parentMap.get(cur); if (++d > 20) break; }
        return d;
      };
      const sorted = [...sbs].sort((a, b) => depth(b.id) - depth(a.id)); // deepest first
      for (const sb of sorted) {
        if (sb.bgVisible === false) continue;
        if (wx >= sb.x && wx <= sb.x + sb.w && wy >= sb.y && wy <= sb.y + sb.h) return sb;
      }
      return null;
    }

    const _SB_EDGE_CURSORS = {
      n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize',
      ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize',
    };

    function hitTestSuperboxEdge(wx, wy) {
      const sbs = superboxesRef.current;
      const th = Math.max(6, 8 / cam.zoom);
      for (let i = sbs.length - 1; i >= 0; i--) {
        const sb = sbs[i];
        if (sb.bgVisible === false) continue;
        const { x, y, w, h } = sb;
        const inX = wx >= x - th && wx <= x + w + th;
        const inY = wy >= y - th && wy <= y + h + th;
        if (!inX || !inY) continue;
        const onL = wx >= x - th && wx <= x + th;
        const onR = wx >= x + w - th && wx <= x + w + th;
        const onT = wy >= y - th && wy <= y + th;
        const onB = wy >= y + h - th && wy <= y + h + th;
        if (onL && onT) return { sb, edge: 'nw' };
        if (onR && onT) return { sb, edge: 'ne' };
        if (onL && onB) return { sb, edge: 'sw' };
        if (onR && onB) return { sb, edge: 'se' };
        if (onL && wy >= y && wy <= y + h) return { sb, edge: 'w' };
        if (onR && wy >= y && wy <= y + h) return { sb, edge: 'e' };
        if (onT && wx >= x && wx <= x + w) return { sb, edge: 'n' };
        if (onB && wx >= x && wx <= x + w) return { sb, edge: 's' };
      }
      return null;
    }

    function commitSuperboxes() {
      setSuperboxesRef.current([...superboxesRef.current]);
    }

    // Fire groupselect event so RightSidebar can show group properties
    function emitGroupSelect(sb) {
      window.dispatchEvent(new CustomEvent('groupselect', { detail: sb ?? null }));
    }

    function draw() {
      const W=canvas.width, H=canvas.height, z=cam.zoom*dpr, step=SPACING*z;
      ctx.clearRect(0,0,W,H); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);

      const ox=(-cam.x*z)%step, oy=(-cam.y*z)%step;
      const si=Math.floor(cam.x/SPACING)-1, sj=Math.floor(cam.y/SPACING)-1;
      ctx.lineWidth=1;
      let i=si;
      for (let x=ox-step; x<=W+step; x+=step,i++) {
        ctx.strokeStyle=(i%MAJOR===0)?'#bdbdbd':'#dcdcdc';
        ctx.beginPath(); ctx.moveTo(Math.round(x)+.5,0); ctx.lineTo(Math.round(x)+.5,H); ctx.stroke();
      }
      let j=sj;
      for (let y=oy-step; y<=H+step; y+=step,j++) {
        ctx.strokeStyle=(j%MAJOR===0)?'#bdbdbd':'#dcdcdc';
        ctx.beginPath(); ctx.moveTo(0,Math.round(y)+.5); ctx.lineTo(W,Math.round(y)+.5); ctx.stroke();
      }

      // ── Draw superboxes (below connections and nodes) ──────────────────
      sbEyeBtnsRef.current = [];
      {
        const sbsToDraw = superboxesRef.current;
        // Build depth map for draw order (shallow first so nested borders paint on top)
        const _pMap = new Map();
        for (const sb of sbsToDraw) if (sb.parentId) _pMap.set(sb.id, sb.parentId);
        const _depth = (id) => {
          let d = 0, cur = id;
          while (_pMap.has(cur)) { cur = _pMap.get(cur); if (++d > 20) break; }
          return d;
        };
        const sorted = [...sbsToDraw].sort((a, b) => _depth(a.id) - _depth(b.id));
        for (const sb of sorted) {
          const { x, y, w, h } = sb;
          const sx = (x - cam.x) * z;
          const sy = (y - cam.y) * z;
          const sw = w * z;
          const sh = h * z;
          // viewport cull
          if (sx + sw + 60 < 0 || sx - 60 > W || sy + sh + 60 < 0 || sy - 60 > H) continue;
          const color = SUPERBOX_COLORS[sb.colorIdx % SUPERBOX_COLORS.length];
          const isSelected = selectedSuperboxIdRef.current === sb.id;
          // fill
          const sbR = 10 * dpr; // rounded corner radius
          if (sb.bgVisible !== false) {
            ctx.save();
            ctx.globalAlpha = 0.24;
            ctx.fillStyle = color;
            ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, sbR); ctx.fill();
            ctx.restore();
          }
          // border — solid, no dash
          ctx.save();
          ctx.globalAlpha = 1.0;
          ctx.strokeStyle = color;
          ctx.lineWidth = isSelected ? 4 * dpr : 2.5 * dpr;
          ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, sbR); ctx.stroke();
          ctx.restore();
          // label + eye button — pure zoom scaling, same as module divs
          if (cam.zoom > 0.3) {
            const depth = _depth(sb.id);
            const fontSize = (36 - depth * 4) * cam.zoom * dpr;
            const indent = depth * 10 * cam.zoom * dpr;
            ctx.save();
            ctx.font = `bold ${fontSize}px monospace`;
            ctx.fillStyle = color;
            ctx.globalAlpha = isSelected ? 0.95 : 0.75;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            const label = sb.name || '';
            const labelX = sx + 6 * dpr + indent;
            const labelY = sy - 3 * dpr;
            if (label) ctx.fillText(label, labelX, labelY);
            const nameW = label ? ctx.measureText(label).width : 0;
            const eyeR = Math.max(5 * dpr, fontSize * 0.45);
            const eyeCX = labelX + nameW + (label ? eyeR * 1.5 : eyeR * 0.5);
            const eyeCY = labelY - fontSize * 0.38;
            // store hit area in screen coords (actual screen px, not dpr-scaled)
            sbEyeBtnsRef.current.push({ sbId: sb.id, cx: eyeCX / dpr, cy: eyeCY / dpr, r: eyeR / dpr });
            // draw eye icon
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1, eyeR * 0.28);
            ctx.beginPath();
            ctx.ellipse(eyeCX, eyeCY, eyeR, eyeR * 0.6, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(eyeCX, eyeCY, eyeR * 0.3, 0, Math.PI * 2);
            ctx.fill();
            if (sb.bgVisible === false) {
              ctx.beginPath();
              ctx.moveTo(eyeCX - eyeR * 0.85, eyeCY + eyeR * 0.55);
              ctx.lineTo(eyeCX + eyeR * 0.85, eyeCY - eyeR * 0.55);
              ctx.stroke();
            }
            ctx.restore();
          }
        }
        // Draw-mode preview rect
        if (drawModeRef.current && sbDrawStartRef.current && sbDrawCurrentRef.current) {
          const a = sbDrawStartRef.current, b = sbDrawCurrentRef.current;
          const ax = (a.wx - cam.x) * z, ay = (a.wy - cam.y) * z;
          const bx = (b.wx - cam.x) * z, by = (b.wy - cam.y) * z;
          ctx.save();
          const _prX = Math.min(ax,bx), _prY = Math.min(ay,by), _prW = Math.abs(bx-ax), _prH = Math.abs(by-ay), _prR = 10 * dpr;
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = '#4488ff';
          ctx.beginPath(); ctx.roundRect(_prX, _prY, _prW, _prH, _prR); ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = '#4488ff';
          ctx.lineWidth = 1.5 * dpr;
          ctx.setLineDash([5 * dpr, 4 * dpr]);
          ctx.beginPath(); ctx.roundRect(_prX, _prY, _prW, _prH, _prR); ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
      }

      // draw connections (arrows deferred — see _arrowPass below)
      const _arrowPass = [];
      const LINE_BACKOFF = SPACING / 2;
      for (const conn of connectionsRef.current) {
        const fn = nodesRef.current.find(n=>n.id===conn.fromNodeId);
        const tn = nodesRef.current.find(n=>n.id===conn.toNodeId);
        if (!fn||!tn) continue;
        const src = conn.fromSide ? sideToPos(fn, conn.fromSide) : getOutputSlotPos(fn);
        const dst = getConnInputPos(tn, conn);
        // Back off the last point by half a grid box along the final segment
        // so the line + arrowhead both stop short of the destination slot.
        const allPts = [src, ...conn.vertices, dst];
        const last = allPts[allPts.length - 1];
        const prev = allPts[allPts.length - 2];
        const dx = last.x - prev.x, dy = last.y - prev.y;
        const len = Math.hypot(dx, dy);
        const endPt = (len > LINE_BACKOFF)
          ? { x: last.x - (dx / len) * LINE_BACKOFF, y: last.y - (dy / len) * LINE_BACKOFF }
          : { ...last };
        const pts = [src, ...conn.vertices, endPt];
        const sel = selectedConnIdsRef.current.has(conn.id);
        // Orange always — brighter when selected.
        const color = sel ? '#ee4c2c' : 'rgba(238, 76, 44, 0.7)';
        const lw = sel ? 2.5*dpr : 1.5*dpr;
        drawPolyline(ctx, pts, cam, z, color, lw, false);
        // Arrow drawn in a later pass (after slot balls) so it always
        // stays visible on top of the destination slot dot.
        if (pts.length >= 2) {
          _arrowPass.push({ a: pts[pts.length - 2], b: pts[pts.length - 1], color });
        }
        // Vertex dots removed — vertices still draggable via the same
        // hit-test radius in the mousedown handler.
      }

      // Returns true if any connection polyline crosses the world-space
      // rect (rx, ry, NODE_SIZE×NODE_SIZE) — used to hide an "out" ghost
      // silhouette that would otherwise sit beneath a live conn line.
      function _ghostBlocked(rx, ry) {
        const rw = NODE_SIZE, rh = NODE_SIZE;
        for (const conn of connectionsRef.current) {
          const fn = nodesRef.current.find(n => n.id === conn.fromNodeId);
          const tn = nodesRef.current.find(n => n.id === conn.toNodeId);
          if (!fn || !tn) continue;
          const src = conn.fromSide ? sideToPos(fn, conn.fromSide) : getOutputSlotPos(fn);
          const dst = getConnInputPos(tn, conn);
          const pts = [src, ...conn.vertices, dst];
          for (let i = 0; i < pts.length - 1; i++) {
            if (segIntersectsRect(pts[i], pts[i+1], rx, ry, rw, rh)) return true;
          }
        }
        return false;
      }

      // ── Pre-spawn ghost: orange dotted silhouette where the bound MATRIX
      // will land. Suppressed when a real bound matrix already exists (the
      // matrix is drawn as a regular node by React below). Shared by both
      // 2-input "spawn one matrix" modules: matmul and masked_fill.
      for (const node of nodesRef.current) {
        if (node.type !== 'matmul' && node.type !== 'masked_fill') continue;
        if (node.showGhost === false) continue;
        if (node.matrixId !== undefined && nodesRef.current.some(n => n.id === node.matrixId)) continue;
        // Backwards compat: also skip if user manually wired any outgoing edge
        if (connectionsRef.current.some(c => c.fromNodeId === node.id)) continue;

        const outPos = getOutputSlotPos(node);
        const rot = node.rot ?? 0;

        // Flush against the output gate edge (no gap) — forms a 1×2 block with the matmul
        let nx, ny;
        switch (rot) {
          case 0: nx = outPos.x;                ny = outPos.y - NODE_SIZE / 2; break;
          case 1: nx = outPos.x - NODE_SIZE / 2; ny = outPos.y;               break;
          case 2: nx = outPos.x - NODE_SIZE;     ny = outPos.y - NODE_SIZE / 2; break;
          case 3: nx = outPos.x - NODE_SIZE / 2; ny = outPos.y - NODE_SIZE;   break;
        }
        // grid-snap
        nx = Math.round(nx / SPACING) * SPACING;
        ny = Math.round(ny / SPACING) * SPACING;

        if (_ghostBlocked(nx, ny)) continue;
        const sx = (nx - cam.x) * z;
        const sy = (ny - cam.y) * z;
        const sw = NODE_SIZE * z;
        const sh = NODE_SIZE * z;
        if (sw < 6) continue;

        ctx.save();
        // Pre-spawn ghost: orange dotted silhouette showing where the bound
        // MATRIX will land. Only reaches here when the matmul has no real
        // bound matrix (e.g. user deleted it).
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeStyle = 'rgba(238, 76, 44, 0.9)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.strokeRect(sx, sy, sw, sh);
        ctx.setLineDash([]);
        const fs = Math.max(8, Math.round(10 * cam.zoom)) * dpr;
        ctx.font = `bold ${fs}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(238, 76, 44, 0.85)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('out', sx + sw / 2, sy + sh / 2);
        ctx.restore();
      }

      // ── LINEAR / RELU "next slot" ghost ───────────────────────────────
      // Always draw ONE orange dotted silhouette at the spot where the next
      // compatible input edge would spawn its matrix — sits right after the
      // last live matrix in the row. Only on terminal modules (chain tail);
      // intermediates render nothing.
      const _isTerminalDraw = (m) => {
        for (const c of connectionsRef.current) {
          if (c.fromNodeId !== m.id) continue;
          const tn = nodesRef.current.find(n => n.id === c.toNodeId);
          if (tn && (tn.type === 'linear' || tn.type === 'relu' || tn.type === 'scale' || tn.type === 'transpose' || tn.type === 'softmax' || tn.type === 'triu' || tn.type === 'matmul' || tn.type === 'masked_fill' || tn.type === 'dropout' || tn.type === 'slice' || tn.type === 'view' || tn.type === 'contiguous' || tn.type === 'layernorm' || tn.type === 'add' || tn.type === 'conv2d')) return false;
        }
        return true;
      };
      for (const node of nodesRef.current) {
        if (node.type !== 'linear' && node.type !== 'relu' && node.type !== 'scale' && node.type !== 'transpose' && node.type !== 'softmax' && node.type !== 'triu' && node.type !== 'dropout' && node.type !== 'slice' && node.type !== 'view' && node.type !== 'contiguous' && node.type !== 'layernorm' && node.type !== 'add' && node.type !== 'conv2d') continue;
        if (node.showGhost === false) continue;
        if (!_isTerminalDraw(node)) continue;
        const outPos = getOutputSlotPos(node);
        const rot = node.rot ?? 0;

        const matrices = node.matrices || {};
        const liveIds = new Set(
          Object.values(matrices)
            .filter(e => e?.matrixId !== undefined)
            .map(e => e.matrixId)
        );
        let liveCount = 0;
        for (const n of nodesRef.current) if (liveIds.has(n.id)) liveCount++;

        const idx = liveCount; // next free slot
        let nx, ny;
        switch (rot) {
          case 0: nx = outPos.x + idx * NODE_SIZE;              ny = outPos.y - NODE_SIZE / 2; break;
          case 1: nx = outPos.x - NODE_SIZE / 2;                ny = outPos.y + idx * NODE_SIZE; break;
          case 2: nx = outPos.x - NODE_SIZE - idx * NODE_SIZE;  ny = outPos.y - NODE_SIZE / 2; break;
          case 3: nx = outPos.x - NODE_SIZE / 2;                ny = outPos.y - NODE_SIZE - idx * NODE_SIZE; break;
        }
        nx = Math.round(nx / SPACING) * SPACING;
        ny = Math.round(ny / SPACING) * SPACING;
        if (_ghostBlocked(nx, ny)) continue;
        const sx = (nx - cam.x) * z;
        const sy = (ny - cam.y) * z;
        const sw = NODE_SIZE * z;
        const sh = NODE_SIZE * z;
        if (sw < 6) continue;

        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sx, sy, sw, sh);
        ctx.strokeStyle = 'rgba(238, 76, 44, 0.9)';
        ctx.lineWidth = 1.5 * dpr;
        ctx.setLineDash([5 * dpr, 4 * dpr]);
        ctx.strokeRect(sx, sy, sw, sh);
        ctx.setLineDash([]);
        const fs = Math.max(8, Math.round(10 * cam.zoom)) * dpr;
        ctx.font = `bold ${fs}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(238, 76, 44, 0.85)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('out', sx + sw / 2, sy + sh / 2);
        ctx.restore();
      }

      // ── Slot dots ──────────────────────────────────────────────────────
      // Painted on the canvas so they always sit BELOW every node body
      // (DOM divs above canvas) regardless of DOM order. The outer half of
      // each ball still shows because node bodies are smaller than where
      // these dots sit (the ball straddles the body edge).
      const drawSlotDot = (wx, wy, isOutput) => {
        const sx = (wx - cam.x) * z;
        const sy = (wy - cam.y) * z;
        const r  = 6 * z;
        if (r < 1.5) return;
        ctx.save();
        ctx.fillStyle   = isOutput ? '#ee4c2c' : '#ffffff';
        ctx.strokeStyle = isOutput ? '#ee4c2c' : '#bdbdbd';
        ctx.lineWidth   = 2 * dpr;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };
      for (const n of nodesRef.current) {
        if (n.type === 'matmul') {
          const pA = getInputSlotPos(n, 'A');
          const pB = getInputSlotPos(n, 'B');
          const po = getOutputSlotPos(n);
          drawSlotDot(pA.x, pA.y, false);
          drawSlotDot(pB.x, pB.y, false);
          drawSlotDot(po.x, po.y, true);
        } else if (n.type === 'masked_fill') {
          const pX = getInputSlotPos(n, 'x');
          const pM = getInputSlotPos(n, 'mask');
          const po = getOutputSlotPos(n);
          drawSlotDot(pX.x, pX.y, false);
          drawSlotDot(pM.x, pM.y, false);
          drawSlotDot(po.x, po.y, true);
        } else if (n.type === 'linear' || n.type === 'relu' || n.type === 'scale' || n.type === 'transpose' || n.type === 'softmax' || n.type === 'triu' || n.type === 'dropout' || n.type === 'slice' || n.type === 'view' || n.type === 'contiguous' || n.type === 'layernorm' || n.type === 'add' || n.type === 'conv2d') {
          const outSide = rotToOutSide(n.rot);
          for (const side of ALL_SIDES) {
            if (side === outSide) continue;
            const p = sideToPos(n, side);
            drawSlotDot(p.x, p.y, false);
          }
          const po = getOutputSlotPos(n);
          drawSlotDot(po.x, po.y, true);
        }
      }

      // ── Connection arrows (deferred) ────────────────────────────────
      // Drawn after slot balls so they always sit on top. Endpoint was
      // already backed off by the conn-draw pass, so the arrow tip lands
      // half a grid cell short of the destination slot.
      for (const a of _arrowPass) {
        drawArrow(ctx, a.a, a.b, cam, z, a.color, dpr);
      }

      // pending connection rubber-band — draws through manually placed vertices
      const pc = pendingConnRef.current;
      if (pc) {
        const fn = nodesRef.current.find(n=>n.id===pc.fromNodeId);
        if (fn) {
          const src = pc.fromSide ? sideToPos(fn, pc.fromSide) : getOutputSlotPos(fn);
          const dst = { x:pc.mouseX, y:pc.mouseY };
          const pts = [src, ...(pc.vertices || []), dst];
          drawPolyline(ctx, pts, cam, z, 'rgba(238,76,44,0.75)', 1.5*dpr, true);
          // draw small dot at each placed vertex
          for (const v of (pc.vertices || [])) {
            const vx = (v.x - cam.x) * z, vy = (v.y - cam.y) * z;
            ctx.save();
            ctx.fillStyle = '#ee4c2c';
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.arc(vx, vy, 4 * dpr, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }

      // selection rect
      const sr = selRectRef.current;
      if (sr) {
        const rx1=(sr.x1-cam.x)*z, ry1=(sr.y1-cam.y)*z;
        const rw=(sr.x2-sr.x1)*z,  rh=(sr.y2-sr.y1)*z;
        ctx.fillStyle='rgba(238,76,44,0.10)'; ctx.fillRect(rx1,ry1,rw,rh);
        ctx.strokeStyle='rgba(238,76,44,0.85)'; ctx.lineWidth=1.5*dpr;
        ctx.setLineDash([5*dpr,4*dpr]); ctx.strokeRect(rx1,ry1,rw,rh); ctx.setLineDash([]);
      }

      positionPanel(); positionNodes();
    }

    drawRef.current = draw;

    function resize() {
      dpr = window.devicePixelRatio||1;
      const r = stage.getBoundingClientRect();
      canvas.width=Math.max(1,Math.floor(r.width*dpr)); canvas.height=Math.max(1,Math.floor(r.height*dpr));
      if (!initialized&&r.width>0&&r.height>0) { cam.x=-r.width/2; cam.y=-r.height/2; initialized=true; }
      draw();
    }

    function setTool(mode) {
      toolModeRef.current=mode;
      drawModeRef.current = mode === 'group';
      if (mode !== 'group') { sbDrawStartRef.current = null; sbDrawCurrentRef.current = null; }
      stage.style.cursor = (mode==='select'||mode==='connect'||mode==='group') ? 'crosshair' : mode==='rotate' ? 'cell' : '';
      window.dispatchEvent(new CustomEvent('toolmodechanged',{ detail:mode }));
    }
    function onToolChange(e) { setTool(e.detail); }

    let panning=false, sx=0, sy=0, scx=0, scy=0;

    function down(e) {
      if (e.target!==canvas) return;
      movedRef.current=false;
      const r=stage.getBoundingClientRect();
      const wx=cam.x+(e.clientX-r.left)/cam.zoom;
      const wy=cam.y+(e.clientY-r.top)/cam.zoom;
      const cx=e.clientX-r.left, cy=e.clientY-r.top;

      // ── Draw mode (G key): start superbox rect ──
      if (drawModeRef.current) {
        sbDrawStartRef.current   = { wx: snapToGrid(wx), wy: snapToGrid(wy) };
        sbDrawCurrentRef.current = { wx: snapToGrid(wx), wy: snapToGrid(wy) };
        draw(); return;
      }

      // ── Eye button hit (screen coords, before world-space checks) ──
      for (const btn of sbEyeBtnsRef.current) {
        const ddx = cx - btn.cx, ddy = cy - btn.cy;
        if (ddx * ddx + ddy * ddy <= btn.r * btn.r * 2.5) {
          const sb = superboxesRef.current.find(s => s.id === btn.sbId);
          if (sb) {
            sb.bgVisible = sb.bgVisible === false ? true : false;
            commitSuperboxes(); draw();
          }
          return;
        }
      }

      // ── Superbox edge (resize) ──
      const sbEdgeHit = hitTestSuperboxEdge(wx, wy);
      if (sbEdgeHit) {
        const { sb, edge } = sbEdgeHit;
        // Anchor pre-resize snapshot (same coalesce-avoidance as SB drag).
        lastSnapRef.current = JSON.stringify({ nodes: nodesRef.current, connections: connectionsRef.current, superboxes: superboxesRef.current });
        lastSnapTimeRef.current = Date.now() - 500;
        selectedSuperboxIdRef.current = sb.id;
        emitGroupSelect(sb);
        sbResizingRef.current    = true;
        sbResizeIdRef.current    = sb.id;
        sbResizeEdgeRef.current  = edge;
        sbResizeStartRef.current = { x: wx, y: wy };
        sbResizeOrigRef.current  = { x: sb.x, y: sb.y, w: sb.w, h: sb.h };
        stage.style.cursor = _SB_EDGE_CURSORS[edge];
        draw(); return;
      }

      // ── Pending connection (any mode): canvas click adds vertex or completes ──
      if (pendingConnRef.current) {
        const pc = pendingConnRef.current;
        const slot = findNearestInputSlot(wx, wy, pc.fromNodeId);
        if (slot) {
          const fn = nodesRef.current.find(n => n.id === pc.fromNodeId);
          const conn = {
            id: Date.now(), fromNodeId: fn.id, fromSlotId: 'out',
            ...(pc.fromSide ? { fromSide: pc.fromSide } : {}),
            toNodeId: slot.node.id, toSlotId: slot.slotId,
            ...(slot.side ? { toSide: slot.side } : {}),
            vertices: pc.vertices || [],
          };
          setConnectionsRef.current(prev => [...prev, conn]);
          pendingConnRef.current = null;
          window.dispatchEvent(new CustomEvent('toolchange', { detail: 'pan' }));
        } else {
          // Click on empty grid → add vertex at snapped position
          const snapped = { x: Math.round(wx / SPACING) * SPACING, y: Math.round(wy / SPACING) * SPACING };
          pendingConnRef.current = { ...pc, vertices: [...(pc.vertices || []), snapped] };
        }
        draw(); return;
      }

      // ── Connect mode ── start a connection by clicking near a node on canvas
      if (toolModeRef.current==='connect') {
        let nearNode = null, minD = Infinity;
        for (const n of nodesRef.current) {
          const ncx = Math.max(n.x, Math.min(n.x + NODE_SIZE, wx));
          const ncy = Math.max(n.y, Math.min(n.y + NODE_SIZE, wy));
          const d = Math.hypot(wx - ncx, wy - ncy);
          if (d < minD) { minD = d; nearNode = n; }
        }
        if (nearNode && minD < 20) {
          const fromSide = (nearNode.type === 'matrix' || nearNode.type === 'linear' || nearNode.type === 'relu' || nearNode.type === 'scale' || nearNode.type === 'transpose' || nearNode.type === 'softmax' || nearNode.type === 'triu' || nearNode.type === 'matmul' || nearNode.type === 'masked_fill' || nearNode.type === 'dropout' || nearNode.type === 'slice' || nearNode.type === 'view' || nearNode.type === 'contiguous' || nearNode.type === 'layernorm' || nearNode.type === 'add')
            ? closestSide(nearNode, wx, wy)
            : null;
          pendingConnRef.current = { fromNodeId: nearNode.id, fromSide, mouseX: wx, mouseY: wy, vertices: [] };
          draw();
        }
        return;
      }

      // ── Select mode ──
      if (toolModeRef.current==='select') {
        selRectRef.current={ x1:wx,y1:wy,x2:wx,y2:wy }; isSelectingRef.current=true; return;
      }

      // ── Pan mode: check vertex drag first ──
      for (const conn of connectionsRef.current) {
        for (let vi=0; vi<conn.vertices.length; vi++) {
          const v=conn.vertices[vi];
          const vsx=(v.x-cam.x)*cam.zoom, vsy=(v.y-cam.y)*cam.zoom;
          if (Math.hypot(cx-vsx,cy-vsy)<10) { draggingVertRef.current={connId:conn.id,vertexIdx:vi}; return; }
        }
      }

      // ── Superbox body (drag / select) — pan mode only ──
      const sbHit = hitTestSuperbox(wx, wy);
      if (sbHit) {
        // Connection lines take priority — skip group drag if click is near a line
        const CONN_THRESH = 8;
        let nearConn = false;
        for (const conn of connectionsRef.current) {
          const fn = nodesRef.current.find(n => n.id === conn.fromNodeId);
          const tn = nodesRef.current.find(n => n.id === conn.toNodeId);
          if (!fn || !tn) continue;
          const pts = [getOutputSlotPos(fn), ...(conn.vertices || []), getConnInputPos(tn, conn)];
          for (let i = 0; i < pts.length - 1; i++) {
            if (distToSegment(wx, wy, pts[i].x, pts[i].y, pts[i+1].x, pts[i+1].y) < CONN_THRESH) {
              nearConn = true; break;
            }
          }
          if (nearConn) break;
        }
        if (!nearConn) {
          // Anchor lastSnapRef to the pre-drag state so the snapshot effect (fired
          // after up() commits all moves) correctly pushes this as the undo entry.
          // Also rewind lastSnapTimeRef so the 200ms coalesce window doesn't swallow it.
          const preDragSnap = JSON.stringify({ nodes: nodesRef.current, connections: connectionsRef.current, superboxes: superboxesRef.current });
          lastSnapRef.current = preDragSnap;
          lastSnapTimeRef.current = Date.now() - 500;
          selectedSuperboxIdRef.current = sbHit.id;
          setSelectedIdsRef.current(new Set());
          setSelectedConnIdsRef.current(new Set());
          emitGroupSelect(sbHit);
          sbDraggingRef.current = true;
          sbDragIdRef.current   = sbHit.id;
          sbDragOffRef.current  = { x: wx - sbHit.x, y: wy - sbHit.y };
          stage.style.cursor = 'move';
          draw(); return;
        }
        // Near a connection inside group — fall through; onClick will select it
      }

      // Deselect superbox when clicking empty canvas
      if (selectedSuperboxIdRef.current !== null) {
        selectedSuperboxIdRef.current = null;
        emitGroupSelect(null);
        draw();
      }

      // Pan
      panning=true; sx=e.clientX; sy=e.clientY; scx=cam.x; scy=cam.y;
      stage.classList.add('panning');
    }

    function move(e) {
      const r=stage.getBoundingClientRect();
      const wx=cam.x+(e.clientX-r.left)/cam.zoom;
      const wy=cam.y+(e.clientY-r.top)/cam.zoom;

      // vertex drag
      if (draggingVertRef.current) {
        const { connId, vertexIdx } = draggingVertRef.current;
        const snx=Math.round(wx/SPACING)*SPACING, sny=Math.round(wy/SPACING)*SPACING;
        setConnectionsRef.current(prev => {
          const next = prev.map(c => {
            if (c.id!==connId) return c;
            const v=[...c.vertices]; v[vertexIdx]={x:snx,y:sny}; return {...c,vertices:v};
          });
          connectionsRef.current=next; return next;
        });
        draw(); return;
      }

      // rubber-band
      if (pendingConnRef.current) {
        pendingConnRef.current={ ...pendingConnRef.current, mouseX:wx, mouseY:wy };
        draw(); return;
      }

      // superbox draw-mode: update live preview
      if (drawModeRef.current && sbDrawStartRef.current) {
        sbDrawCurrentRef.current = { wx: snapToGrid(wx), wy: snapToGrid(wy) };
        draw(); return;
      }

      // superbox resize
      if (sbResizingRef.current) {
        movedRef.current = true;
        const sb = superboxesRef.current.find(s => s.id === sbResizeIdRef.current);
        if (sb) {
          const orig  = sbResizeOrigRef.current;
          const start = sbResizeStartRef.current;
          const ddx = wx - start.x, ddy = wy - start.y;
          const edge = sbResizeEdgeRef.current;
          if (edge.includes('e')) sb.w = Math.max(SPACING, orig.w + ddx);
          if (edge.includes('s')) sb.h = Math.max(SPACING, orig.h + ddy);
          if (edge.includes('w')) {
            const nw = Math.max(SPACING, orig.w - ddx);
            sb.x = orig.x + orig.w - nw; sb.w = nw;
          }
          if (edge.includes('n')) {
            const nh = Math.max(SPACING, orig.h - ddy);
            sb.y = orig.y + orig.h - nh; sb.h = nh;
          }
          draw();
        }
        return;
      }

      // superbox drag (moves SB + all descendant nodes)
      if (sbDraggingRef.current) {
        movedRef.current = true;
        const sb = superboxesRef.current.find(s => s.id === sbDragIdRef.current);
        if (sb) {
          const off = sbDragOffRef.current;
          const ddx = wx - off.x - sb.x;
          const ddy = wy - off.y - sb.y;
          sb.x += ddx; sb.y += ddy;

          // Collect descendant SBs and layer IDs (no double-move)
          const _descSbIds    = new Set();
          const _descLayerIds = new Set();
          const _collectDesc  = pid => {
            superboxesRef.current.forEach(c => {
              if (c.parentId === pid) {
                _descSbIds.add(c.id);
                (c.layerIds || []).forEach(id => _descLayerIds.add(id));
                _collectDesc(c.id);
              }
            });
          };
          _collectDesc(sb.id);

          // Move direct layers (skip those living inside a child SB)
          (sb.layerIds || []).forEach(lid => {
            if (_descLayerIds.has(lid)) return;
            const n = nodesRef.current.find(x => x.id === lid);
            if (n) { n.x += ddx; n.y += ddy; }
          });
          // Move descendant SBs
          _descSbIds.forEach(cid => {
            const c = superboxesRef.current.find(s => s.id === cid);
            if (c) { c.x += ddx; c.y += ddy; }
          });
          // Move layers inside descendant SBs
          _descLayerIds.forEach(lid => {
            const n = nodesRef.current.find(x => x.id === lid);
            if (n) { n.x += ddx; n.y += ddy; }
          });
          // Move vertices of connections where both endpoints are inside this group
          const _allMovedIds = new Set([...(sb.layerIds || []), ..._descLayerIds]);
          connectionsRef.current.forEach(conn => {
            if (_allMovedIds.has(conn.fromNodeId) && _allMovedIds.has(conn.toNodeId)) {
              conn.vertices = (conn.vertices || []).map(v => ({ x: v.x + ddx, y: v.y + ddy }));
            }
          });
          // Flush node positions to DOM
          positionNodes();
          draw();
        }
        return;
      }

      // selection rect
      if (isSelectingRef.current) {
        movedRef.current=true;
        selRectRef.current.x2=wx; selRectRef.current.y2=wy; draw(); return;
      }

      // pan
      if (!panning) return;
      const dx=e.clientX-sx, dy=e.clientY-sy;
      if (Math.abs(dx)+Math.abs(dy)>4) movedRef.current=true;
      cam.x=scx-dx/cam.zoom; cam.y=scy-dy/cam.zoom; draw();
    }

    function up() {
      if (draggingVertRef.current) { draggingVertRef.current=null; return; }

      // Finalize superbox draw
      if (drawModeRef.current && sbDrawStartRef.current && sbDrawCurrentRef.current) {
        const a = sbDrawStartRef.current, b = sbDrawCurrentRef.current;
        const x1 = snapToGrid(Math.min(a.wx, b.wx));
        const y1 = snapToGrid(Math.min(a.wy, b.wy));
        const x2 = Math.max(snapToGrid(Math.max(a.wx, b.wx)), x1 + SPACING * 2);
        const y2 = Math.max(snapToGrid(Math.max(a.wy, b.wy)), y1 + SPACING * 2);
        if (x2 - x1 >= SPACING * 2 && y2 - y1 >= SPACING * 2) {
          const newSb = {
            id: Date.now(),
            name: '',
            x: x1, y: y1, w: x2 - x1, h: y2 - y1,
            layerIds: [],
            colorIdx: superboxesRef.current.length % SUPERBOX_COLORS.length,
            parentId: null,
            bgVisible: true,
          };
          superboxesRef.current.push(newSb);
          syncAll();
          selectedSuperboxIdRef.current = newSb.id;
          emitGroupSelect(newSb);
          commitSuperboxes();
        }
        sbDrawStartRef.current   = null;
        sbDrawCurrentRef.current = null;
        setTool('pan'); // exit draw mode after creating a group
        draw(); return;
      }

      // Finalize superbox resize — snap to grid
      if (sbResizingRef.current) {
        const sb = superboxesRef.current.find(s => s.id === sbResizeIdRef.current);
        if (sb) {
          sb.x = snapToGrid(sb.x); sb.y = snapToGrid(sb.y);
          sb.w = Math.max(SPACING, snapToGrid(sb.w));
          sb.h = Math.max(SPACING, snapToGrid(sb.h));
          syncAll();
          commitSuperboxes();
        }
        sbResizingRef.current  = false;
        sbResizeIdRef.current  = null;
        sbResizeEdgeRef.current = null;
        stage.style.cursor = drawModeRef.current ? 'crosshair' : '';
        draw(); return;
      }

      // Finalize superbox drag — snap to grid, also snap moved nodes
      if (sbDraggingRef.current) {
        const sb = superboxesRef.current.find(s => s.id === sbDragIdRef.current);
        if (sb) {
          const snappedX = snapToGrid(sb.x);
          const snappedY = snapToGrid(sb.y);
          const ddx = snappedX - sb.x;
          const ddy = snappedY - sb.y;
          sb.x = snappedX; sb.y = snappedY;

          const _dSbIds    = new Set();
          const _dLayerIds = new Set();
          const _cD = pid => {
            superboxesRef.current.forEach(c => {
              if (c.parentId === pid) {
                _dSbIds.add(c.id);
                (c.layerIds || []).forEach(id => _dLayerIds.add(id));
                _cD(c.id);
              }
            });
          };
          _cD(sb.id);

          (sb.layerIds || []).forEach(lid => {
            if (_dLayerIds.has(lid)) return;
            const n = nodesRef.current.find(x => x.id === lid);
            if (n) { n.x = snapToGrid(n.x + ddx); n.y = snapToGrid(n.y + ddy); }
          });
          _dSbIds.forEach(cid => {
            const c = superboxesRef.current.find(s => s.id === cid);
            if (c) { c.x = snapToGrid(c.x + ddx); c.y = snapToGrid(c.y + ddy); }
          });
          _dLayerIds.forEach(lid => {
            const n = nodesRef.current.find(x => x.id === lid);
            if (n) { n.x = snapToGrid(n.x + ddx); n.y = snapToGrid(n.y + ddy); }
          });

          // Snap vertices of internal connections to grid
          const _snapMovedIds = new Set([...(sb.layerIds || []), ..._dLayerIds]);
          connectionsRef.current.forEach(conn => {
            if (_snapMovedIds.has(conn.fromNodeId) && _snapMovedIds.has(conn.toNodeId)) {
              conn.vertices = (conn.vertices || []).map(v => ({
                x: snapToGrid(v.x + ddx),
                y: snapToGrid(v.y + ddy),
              }));
            }
          });
          setConnectionsRef.current([...connectionsRef.current]);

          syncAll();
          // Commit node positions into React state
          setNodesRef.current([...nodesRef.current]);
          commitSuperboxes();
        }
        sbDraggingRef.current = false;
        sbDragIdRef.current   = null;
        stage.style.cursor = drawModeRef.current ? 'crosshair' : '';
        draw(); return;
      }

      if (isSelectingRef.current) {
        isSelectingRef.current=false;
        const sr=selRectRef.current; selRectRef.current=null;
        let picked = false;
        if (sr) {
          const minX=Math.min(sr.x1,sr.x2), maxX=Math.max(sr.x1,sr.x2);
          const minY=Math.min(sr.y1,sr.y2), maxY=Math.max(sr.y1,sr.y2);
          const hit=nodesRef.current.filter(n=>n.x<maxX&&n.x+NODE_SIZE>minX&&n.y<maxY&&n.y+NODE_SIZE>minY);
          setSelectedIdsRef.current(new Set(hit.map(n=>n.id)));
          setSelectedConnIdsRef.current(new Set());
          picked = hit.length > 0;
        }
        // Drop back to pan once selection lands (matches connect-tool flow).
        if (picked) setTool('pan');
        draw(); return;
      }
      panning=false; stage.classList.remove('panning');
    }

    function wheel(e) {
      e.preventDefault();
      const r=stage.getBoundingClientRect();
      const mx=e.clientX-r.left, my=e.clientY-r.top;
      const wx=cam.x+mx/cam.zoom, wy=cam.y+my/cam.zoom;
      const f=e.deltaY<0?1.1:1/1.1;
      cam.zoom=Math.min(5,Math.max(0.15,cam.zoom*f));
      cam.x=wx-mx/cam.zoom; cam.y=wy-my/cam.zoom; draw();
    }

    function onKeyDown(e) {
      const tag=document.activeElement?.tagName;
      if (tag==='INPUT'||tag==='TEXTAREA') return;

      if (e.key==='Escape') {
        pendingConnRef.current=null;
        if (['select','connect','rotate'].includes(toolModeRef.current)) setTool('pan');
        draw(); return;
      }
      // Undo / Redo
      if ((e.ctrlKey||e.metaKey)&&e.key==='z'&&!e.shiftKey) { e.preventDefault(); doUndoRef.current(); return; }
      if ((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.key==='z'&&e.shiftKey))) { e.preventDefault(); doRedoRef.current(); return; }
      if ((e.key==='s'||e.key==='S')&&!e.ctrlKey&&!e.metaKey) { setTool(toolModeRef.current==='select'?'pan':'select'); return; }
      if ((e.key==='c'||e.key==='C')&&!e.ctrlKey&&!e.metaKey) { setTool(toolModeRef.current==='connect'?'pan':'connect'); return; }
      // G: toggle group draw mode
      if ((e.key==='g'||e.key==='G')&&!e.ctrlKey&&!e.metaKey) {
        setTool(drawModeRef.current ? 'pan' : 'group');
        draw(); return;
      }
      // Delete/Backspace: remove selected superbox
      if ((e.key==='Delete'||e.key==='Backspace') && selectedSuperboxIdRef.current !== null) {
        const idx = superboxesRef.current.findIndex(s => s.id === selectedSuperboxIdRef.current);
        if (idx !== -1) {
          superboxesRef.current.splice(idx, 1);
          syncAll();
          selectedSuperboxIdRef.current = null;
          emitGroupSelect(null);
          commitSuperboxes();
          draw();
        }
        return;
      }
      if ((e.key==='r'||e.key==='R')&&!e.ctrlKey&&!e.metaKey) {
        // Rotate every selected node 90° CW in place + re-route any conn
        // attached to a rotated node.
        const selIds = selectedIdsRef.current;
        if (!selIds.size) return;
        const nextNodes = nodesRef.current.map(n =>
          selIds.has(n.id) ? { ...n, rot: (((n.rot ?? 0) + 1) % 4) } : n
        );
        setNodesRef.current(nextNodes);
        setConnectionsRef.current(prev => prev.map(c => {
          const fn = nextNodes.find(n => n.id === c.fromNodeId);
          const tn = nextNodes.find(n => n.id === c.toNodeId);
          if (!fn || !tn) return c;
          if (!selIds.has(fn.id) && !selIds.has(tn.id)) return c;
          const src = c.fromSide ? sideToPos(fn, c.fromSide) : getOutputSlotPos(fn);
          return { ...c, vertices: autoRoute(src, getConnInputPos(tn, c)) };
        }));
        return;
      }

      const sel=selectedIdsRef.current;
      if ((e.ctrlKey||e.metaKey)&&e.key==='c') { clipboardRef.current=nodesRef.current.filter(n=>sel.has(n.id)); }
      if ((e.ctrlKey||e.metaKey)&&e.key==='x') {
        clipboardRef.current=nodesRef.current.filter(n=>sel.has(n.id));
        const fullSel = new Set(sel);
        for (const n of nodesRef.current) {
          if ((n.type === 'matmul' || n.type === 'masked_fill') && n.matrixId !== undefined && fullSel.has(n.id)) fullSel.add(n.matrixId);
          if ((n.type === 'linear' || n.type === 'relu' || n.type === 'scale' || n.type === 'transpose' || n.type === 'softmax' || n.type === 'triu' || n.type === 'dropout' || n.type === 'slice' || n.type === 'view' || n.type === 'contiguous' || n.type === 'layernorm' || n.type === 'add') && n.matrices && fullSel.has(n.id)) {
            for (const e of Object.values(n.matrices)) {
              if (e?.matrixId !== undefined) fullSel.add(e.matrixId);
            }
          }
        }
        setNodesRef.current(prev=>prev.filter(n=>!fullSel.has(n.id)));
        setConnectionsRef.current(prev=>prev.filter(c=>!fullSel.has(c.fromNodeId)&&!fullSel.has(c.toNodeId)));
        setSelectedIdsRef.current(new Set());
      }
      if ((e.ctrlKey||e.metaKey)&&e.key==='v') {
        const src=clipboardRef.current; if (!src||!src.length) return;
        const newIds=new Set();
        const pasted=src.map(s=>{ const pos=freePos(s.x+SPACING*2,s.y+SPACING*2); const n={...s,id:Date.now()+Math.random(),...pos}; newIds.add(n.id); return n; });
        setNodesRef.current(prev=>[...prev,...pasted]);
        setSelectedIdsRef.current(newIds);
      }
      if ((e.key==='Delete'||e.key==='Backspace')&&(sel.size>0||selectedConnIdsRef.current.size>0)) {
        const selC=selectedConnIdsRef.current;
        // Cascade: MATMUL / LINEAR take their bound MATRIX nodes with them.
        const fullSel = new Set(sel);
        for (const n of nodesRef.current) {
          if ((n.type === 'matmul' || n.type === 'masked_fill') && n.matrixId !== undefined && fullSel.has(n.id)) fullSel.add(n.matrixId);
          if ((n.type === 'linear' || n.type === 'relu' || n.type === 'scale' || n.type === 'transpose' || n.type === 'softmax' || n.type === 'triu' || n.type === 'dropout' || n.type === 'slice' || n.type === 'view' || n.type === 'contiguous' || n.type === 'layernorm' || n.type === 'add') && n.matrices && fullSel.has(n.id)) {
            for (const e of Object.values(n.matrices)) {
              if (e?.matrixId !== undefined) fullSel.add(e.matrixId);
            }
          }
        }
        setNodesRef.current(prev => {
          const next = prev.filter(n => !fullSel.has(n.id));
          // Unbind matmul if user is removing only the matrix (binding effect
          // will rebuild linear.matrices on its own next render).
          for (const n of next) {
            if ((n.type === 'matmul' || n.type === 'masked_fill') && n.matrixId !== undefined && fullSel.has(n.matrixId)) n.matrixId = undefined;
          }
          return next;
        });
        setConnectionsRef.current(prev=>prev.filter(c=>!fullSel.has(c.fromNodeId)&&!fullSel.has(c.toNodeId)&&!selC.has(c.id)));
        setSelectedIdsRef.current(new Set());
        setSelectedConnIdsRef.current(new Set());
      }
    }

    function dragOver(e) { e.preventDefault(); }
    function drop(e) {
      e.preventDefault();
      const nodeType=e.dataTransfer.getData('nodeType'); if (!nodeType) return;
      const rect=stage.getBoundingClientRect();
      const wx=cam.x+(e.clientX-rect.left)/cam.zoom-NODE_SIZE/2;
      const wy=cam.y+(e.clientY-rect.top)/cam.zoom-NODE_SIZE/2;
      const pos=freePos(Math.round(wx/SPACING)*SPACING, Math.round(wy/SPACING)*SPACING);

      // MATMUL / LINEAR drop alone — their bound MATRIX nodes appear when
      // inputs are wired (binding effect). MATRIX drops as a standalone node.
      let nn;
      if (nodeType === 'matmul') {
        nn = { id: Date.now(), type: 'matmul', ...pos };
      } else if (nodeType === 'linear') {
        nn = {
          id: Date.now(), type: 'linear',
          d_in: 4, d_out: 4, bias: true,
          ...pos,
        };
      } else if (nodeType === 'conv2d') {
        nn = {
          id: Date.now(), type: 'conv2d',
          in_channels: 1, out_channels: 1,
          kernel_size: 3, stride: 1, padding: 0,
          dilation: 1, groups: 1,
          bias: true,
          ...pos,
        };
      } else if (nodeType === 'view') {
        nn = { id: Date.now(), type: 'view', shape: '-1', ...pos };
      } else if (nodeType === 'dropout') {
        nn = { id: Date.now(), type: 'dropout', p: 0.5, ...pos };
      } else if (nodeType === 'slice') {
        nn = { id: Date.now(), type: 'slice', dims: ':', ...pos };
      } else if (nodeType === 'contiguous') {
        nn = { id: Date.now(), type: 'contiguous', ...pos };
      } else if (nodeType === 'add') {
        nn = { id: Date.now(), type: 'add', ...pos };
      } else if (nodeType === 'layernorm') {
        nn = { id: Date.now(), type: 'layernorm', normalized_shape: 4, elementwise_affine: true, ln_bias: true, ...pos };
      } else if (nodeType === 'relu') {
        nn = { id: Date.now(), type: 'relu', ...pos };
      } else if (nodeType === 'scale') {
        nn = { id: Date.now(), type: 'scale', op: '*', factor: '1', ...pos };
      } else if (nodeType === 'transpose') {
        nn = { id: Date.now(), type: 'transpose', dim0: -2, dim1: -1, ...pos };
      } else if (nodeType === 'softmax') {
        nn = { id: Date.now(), type: 'softmax', dim: -1, ...pos };
      } else if (nodeType === 'triu') {
        nn = { id: Date.now(), type: 'triu', diagonal: 0, ...pos };
      } else if (nodeType === 'masked_fill') {
        nn = { id: Date.now(), type: 'masked_fill', value: '-inf', ...pos };
      } else if (nodeType === 'ones') {
        // torch.ones — literal all-ones tensor. Same matrix shape/binding
        // semantics; `init: 'ones'` flag is what the future torch-code
        // translator reads to emit torch.ones(shape).
        nn = {
          id: Date.now(), type: 'matrix', init: 'ones',
          name: 'ones', shape: [4, 4],
          ...pos,
        };
      } else {
        nn = { id: Date.now(), type: 'matrix', name: 'W', shape: [4, 4], ...pos };
      }
      setNodesRef.current(prev => {
        const next = [...prev, nn];
        nodesRef.current = next;
        syncLayerMembership();
        commitSuperboxes();
        return next;
      });
      setSelectedIdsRef.current(new Set([nn.id]));
    }

    // Serialization handlers — Toolbar dispatches 'tb-save' / 'tb-load'.
    // File extension is .tbuild (JSON content) so OS file association +
    // visual disambiguation from the eventual .py torch-export work later.
    function onSaveArch() {
      // Ask the user for a filename. Cancel (null) aborts the save.
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const suggested = `torchbuilder-${ts}`;
      const raw = window.prompt('Save architecture as:', suggested);
      if (raw === null) return;                  // user cancelled
      let name = raw.trim() || suggested;
      // Strip any user-supplied extension so we always emit .tbuild.
      name = name.replace(/\.(tbuild|json)$/i, '');
      const data = {
        version: 1,
        nodes: nodesRef.current,
        connections: connectionsRef.current,
        vars: varsRef.current,
        groups: superboxesRef.current,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.tbuild`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    }
    function onLoadArch() {
      const inp = document.createElement('input');
      inp.type = 'file';
      // Accept the new .tbuild extension plus legacy .json saves.
      inp.accept = '.tbuild,application/json,.json';
      inp.onchange = (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(String(reader.result));
            if (Array.isArray(data.nodes))       setNodesRef.current(data.nodes);
            if (Array.isArray(data.connections)) setConnectionsRef.current(data.connections);
            if (Array.isArray(data.vars))        setVars(data.vars);
            if (Array.isArray(data.groups))      setSuperboxesRef.current(data.groups);
            setSelectedIdsRef.current(new Set());
            setSelectedConnIdsRef.current(new Set());
            selectedSuperboxIdRef.current = null;
            emitGroupSelect(null);
          } catch (err) {
            alert('Load failed: ' + err.message);
          }
        };
        reader.readAsText(f);
      };
      inp.click();
    }

    const ro=new ResizeObserver(resize);
    ro.observe(stage);
    window.addEventListener('mousemove',move);
    window.addEventListener('mouseup',up);
    window.addEventListener('keydown',onKeyDown);
    window.addEventListener('toolchange',onToolChange);
    window.addEventListener('tb-save', onSaveArch);
    window.addEventListener('tb-load', onLoadArch);
    window.addEventListener('groupnameupdate', onGroupNameUpdate);
    window.addEventListener('groupcolorupdate', onGroupColorUpdate);
    stage.addEventListener('mousedown',down);
    stage.addEventListener('wheel',wheel,{passive:false});
    stage.addEventListener('dragover',dragOver);
    stage.addEventListener('drop',drop);
    resize();

    return () => {
      cancelAnimationFrame(rafId); ro.disconnect();
      window.removeEventListener('mousemove',move);
      window.removeEventListener('mouseup',up);
      window.removeEventListener('keydown',onKeyDown);
      window.removeEventListener('toolchange',onToolChange);
      window.removeEventListener('tb-save', onSaveArch);
      window.removeEventListener('tb-load', onLoadArch);
      window.removeEventListener('groupnameupdate', onGroupNameUpdate);
    window.removeEventListener('groupcolorupdate', onGroupColorUpdate);
      stage.removeEventListener('mousedown',down);
      stage.removeEventListener('wheel',wheel);
      stage.removeEventListener('dragover',dragOver);
      stage.removeEventListener('drop',drop);
      drawRef.current=null;
    };
  }, []);

  function handleNodeMouseDown(e, node) {
    e.stopPropagation();

    // World coords — needed before any mode check
    const cam = camRef.current;
    const stageEl = canvasRef.current?.parentElement;
    const r = stageEl?.getBoundingClientRect();
    const wx = r ? cam.x + (e.clientX - r.left) / cam.zoom : node.x + NODE_SIZE / 2;
    const wy = r ? cam.y + (e.clientY - r.top)  / cam.zoom : node.y + NODE_SIZE / 2;

    // ── Complete pending connection (any mode) ───────────────────────────
    const pcEarly = pendingConnRef.current;
    if (pcEarly && toolModeRef.current !== 'rotate') {
      if (pcEarly.fromNodeId !== node.id && node.type !== 'matrix') {
        let bestSlot = 'in', bestSide = null;
        if (node.type === 'matmul' || node.type === 'masked_fill') {
          const slots = node.type === 'matmul' ? ['A','B'] : ['x','mask'];
          let bestD = Infinity;
          for (const sid of slots) {
            const p = getInputSlotPos(node, sid);
            const d = Math.hypot(wx - p.x, wy - p.y);
            if (d < bestD) { bestD = d; bestSlot = sid; }
          }
        } else {
          const outSide = rotToOutSide(node.rot);
          let bestD = Infinity;
          for (const side of ALL_SIDES) {
            if (side === outSide) continue;
            const p = sideToPos(node, side);
            const d = Math.hypot(wx - p.x, wy - p.y);
            if (d < bestD) { bestD = d; bestSide = side; }
          }
        }
        const fn = nodesRef.current.find(n => n.id === pcEarly.fromNodeId);
        const conn = {
          id: Date.now(), fromNodeId: fn.id, fromSlotId: 'out',
          ...(pcEarly.fromSide ? { fromSide: pcEarly.fromSide } : {}),
          toNodeId: node.id, toSlotId: bestSlot,
          ...(bestSide ? { toSide: bestSide } : {}),
          vertices: pcEarly.vertices || [],
        };
        setConnectionsRef.current(prev => [...prev, conn]);
        pendingConnRef.current = null;
        window.dispatchEvent(new CustomEvent('toolchange', { detail: 'pan' }));
        drawRef.current?.();
        return;
      }
      // clicked source node again — cancel
      pendingConnRef.current = null;
      drawRef.current?.();
      return;
    }

    // ── Start connection from output slot in pan/select mode ─────────────
    if ((toolModeRef.current === 'pan' || toolModeRef.current === 'select') && !pendingConnRef.current) {
      const outPos = getOutputSlotPos(node);
      if (Math.hypot(wx - outPos.x, wy - outPos.y) < SPACING) {
        const fromSide = (node.type === 'matrix' || node.type === 'linear' || node.type === 'relu' || node.type === 'scale' || node.type === 'transpose' || node.type === 'softmax' || node.type === 'triu' || node.type === 'matmul' || node.type === 'masked_fill' || node.type === 'dropout' || node.type === 'slice' || node.type === 'view' || node.type === 'contiguous' || node.type === 'layernorm' || node.type === 'add')
          ? closestSide(node, wx, wy)
          : null;
        pendingConnRef.current = { fromNodeId: node.id, fromSide, mouseX: wx, mouseY: wy, vertices: [] };
        drawRef.current?.();
        return;
      }
    }

    // rotate mode: click to rotate 90° CW and re-route connections
    if (toolModeRef.current === 'rotate') {
      const nextNodes = nodesRef.current.map(n =>
        n.id === node.id ? { ...n, rot: (((n.rot ?? 0) + 1) % 4) } : n
      );
      setNodesRef.current(nextNodes);
      setConnectionsRef.current(prev => prev.map(c => {
        const fn = nextNodes.find(n => n.id === c.fromNodeId);
        const tn = nextNodes.find(n => n.id === c.toNodeId);
        if (!fn || !tn) return c;
        if (fn.id !== node.id && tn.id !== node.id) return c;
        const src = c.fromSide ? sideToPos(fn, c.fromSide) : getOutputSlotPos(fn);
        return { ...c, vertices: autoRoute(src, getConnInputPos(tn, c)) };
      }));
      return;
    }

    // connect mode: click node body to start connection
    // (completion is handled by the early-return block above, any mode)
    if (toolModeRef.current === 'connect') {
      const fromSide = (node.type === 'matrix' || node.type === 'linear' || node.type === 'relu' || node.type === 'scale' || node.type === 'transpose' || node.type === 'softmax' || node.type === 'triu' || node.type === 'matmul' || node.type === 'masked_fill' || node.type === 'dropout' || node.type === 'slice' || node.type === 'view' || node.type === 'contiguous' || node.type === 'layernorm' || node.type === 'add')
        ? closestSide(node, wx, wy)
        : null;
      pendingConnRef.current = { fromNodeId: node.id, fromSide, mouseX: wx, mouseY: wy, vertices: [] };
      drawRef.current?.();
      return;
    }

    const ctrl=e.ctrlKey||e.metaKey;
    const prevSel=selectedIdsRef.current;
    // Compute next selection synchronously so snapshot matches
    let nextSel;
    if (ctrl) {
      nextSel=new Set(prevSel);
      if (nextSel.has(node.id)) nextSel.delete(node.id); else nextSel.add(node.id);
    } else {
      nextSel = prevSel.has(node.id) ? new Set(prevSel) : new Set([node.id]);
    }
    setSelectedIds(nextSel);

    // drag selected nodes (cam already declared at top of handleNodeMouseDown)
    const startX=e.clientX, startY=e.clientY;
    const snapshot=nodesRef.current
      .filter(n=>nextSel.has(n.id))
      .map(n=>({ id:n.id,ox:n.x,oy:n.y }));
    const dragIds=new Set(snapshot.map(s=>s.id));
    let lastPos=snapshot.map(s=>({id:s.id,x:s.ox,y:s.oy}));

    // Snapshot vertices of any connection where BOTH endpoints are in the
    // drag set — those should rigid-translate with the nodes so the routing
    // stays intact instead of snapping back to autoRoute.
    const connSnapshot = connectionsRef.current
      .filter(c => dragIds.has(c.fromNodeId) && dragIds.has(c.toNodeId))
      .map(c => ({ id: c.id, oVerts: c.vertices.map(v => ({ x: v.x, y: v.y })) }));
    const connDragIds = new Set(connSnapshot.map(c => c.id));

    const onMove=(me)=>{
      movedRef.current=true;
      const rawDx=(me.clientX-startX)/cam.zoom, rawDy=(me.clientY-startY)/cam.zoom;
      // Snap delta to grid (matches how node positions snap) so vertices
      // track nodes pixel-for-pixel and don't drift one grid cell.
      const sdx=Math.round(rawDx/SPACING)*SPACING, sdy=Math.round(rawDy/SPACING)*SPACING;
      lastPos=snapshot.map(s=>({ id:s.id, x:Math.round((s.ox+rawDx)/SPACING)*SPACING, y:Math.round((s.oy+rawDy)/SPACING)*SPACING }));
      setNodesRef.current(prev=>prev.map(n=>{ const p=lastPos.find(lp=>lp.id===n.id); return p?{...n,x:p.x,y:p.y}:n; }));
      if (connDragIds.size) {
        setConnectionsRef.current(prev => prev.map(c => {
          if (!connDragIds.has(c.id)) return c;
          const snap = connSnapshot.find(cs => cs.id === c.id);
          return { ...c, vertices: snap.oVerts.map(v => ({ x: v.x + sdx, y: v.y + sdy })) };
        }));
      }
    };
    const onUp=()=>{
      const freed=lastPos.map(p=>({id:p.id,...freePos(p.x,p.y,dragIds)}));
      setNodesRef.current(prev=>{
        const next = prev.map(n=>{ const f=freed.find(fp=>fp.id===n.id); return f?{...n,x:f.x,y:f.y}:n; });
        // Sync superbox layer membership after node drag finishes
        nodesRef.current = next;
        syncLayerMembershipOuter();
        commitSuperboxesOuter();
        return next;
      });
      window.removeEventListener('mousemove',onMove);
      window.removeEventListener('mouseup',onUp);
    };
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
  }

  return (
    <>
      <canvas ref={canvasRef} onClick={e=>{
        if (movedRef.current) return;
        const cam=camRef.current, r=canvasRef.current.getBoundingClientRect();
        const wx=cam.x+(e.clientX-r.left)/cam.zoom, wy=cam.y+(e.clientY-r.top)/cam.zoom;
        const THRESH=8;
        let hit=null;
        for (const conn of connectionsRef.current) {
          const fn=nodesRef.current.find(n=>n.id===conn.fromNodeId);
          const tn=nodesRef.current.find(n=>n.id===conn.toNodeId);
          if (!fn||!tn) continue;
          const pts=[getOutputSlotPos(fn),...conn.vertices,getConnInputPos(tn,conn)];
          for (let i=0;i<pts.length-1;i++) {
            if (distToSegment(wx,wy,pts[i].x,pts[i].y,pts[i+1].x,pts[i+1].y)<THRESH) { hit=conn; break; }
          }
          if (hit) break;
        }
        if (hit) {
          selectedSuperboxIdRef.current = null;
          setSelectedConnIds(new Set([hit.id]));
          setSelectedIds(new Set());
        } else {
          setSelectedIds(new Set());
          setSelectedConnIds(new Set());
        }
      }} />

      {/* Variables panel */}
      <div ref={panelRef} className="vars-panel" style={{position:'absolute'}}
        onMouseDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
        <div className="vars-header">
          <button
            className="vars-collapse"
            onClick={() => setVarsCollapsed(c => !c)}
            title={varsCollapsed ? 'Expand' : 'Collapse'}
            style={{
              background:'none', border:'none', cursor:'pointer',
              padding:'0 6px 0 0', font:'inherit', color:'inherit',
            }}
          >{varsCollapsed ? '▸' : '▾'}</button>
          <span style={{ flex:1 }}>Variables</span>
          {!varsCollapsed && <button className="vars-add" onClick={addVar}>+</button>}
        </div>
        {!varsCollapsed && (() => {
          // Resolve every variable in one pass so each row can show its
          // computed value next to the raw expression. Refs like "A+B" or
          // "floor(sqrt(N))" surface their evaluated number on the right.
          const resolved = resolveVars(vars, nodes);
          return (
            <>
              {vars.length===0 && <div className="vars-empty">No variables yet</div>}
              {vars.map((v,i) => {
                const raw = String(v.value ?? '').trim();
                const isLiteralNum = /^-?\d+(\.\d+)?$/.test(raw);
                const computed = v.name ? resolved[v.name] : NaN;
                const showComputed = !isLiteralNum && raw.length > 0;
                return (
                  <div className="vars-row" key={i}>
                    <input className="vars-name" value={v.name} onChange={e=>updateVar(i,'name',e.target.value)} placeholder="name" spellCheck={false} readOnly={i===0} style={i===0?{opacity:0.5,cursor:'default'}:undefined}/>
                    <span className="vars-eq">=</span>
                    <input className="vars-val" value={v.value} onChange={e=>updateVar(i,'value',e.target.value)} placeholder="value or A+B, sqrt(N)…" spellCheck={false}/>
                    {showComputed && (
                      <span style={{
                        marginLeft:'6px', fontSize:'11px',
                        fontFamily:"'Courier New', monospace",
                        color: Number.isFinite(computed) ? '#6c6c6c' : '#ee4c2c',
                        whiteSpace:'nowrap',
                      }}>
                        {Number.isFinite(computed) ? `= ${computed}` : '= ?'}
                      </span>
                    )}
                    {i>0 && <button className="vars-del" onClick={()=>removeVar(i)}>×</button>}
                    {i===0 && <span style={{width:'18px',flexShrink:0}}/>}
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>

      {/* Nodes */}
      {nodes.map(node => (
        <div key={node.id} className={`matrix-node${node._dimError ? ' node-error' : ''}`}
          ref={el=>{ if(el) nodeEls.current.set(node.id,el); else nodeEls.current.delete(node.id); }}
          style={{
            position:'absolute', transformOrigin:'top left',
            width:NODE_SIZE, height:NODE_SIZE,
            // Body color is rendered by a ::before pseudo-element (see CSS)
            // so slot dots can sit BEHIND the body via z-index: -1 while
            // still painting above the canvas grid.
            '--node-bg': (node.type==='matmul' || node.type==='linear' || node.type==='relu' || node.type==='scale' || node.type==='transpose' || node.type==='softmax' || node.type==='triu' || node.type==='masked_fill' || node.type==='dropout' || node.type==='slice' || node.type==='view' || node.type==='contiguous' || node.type==='layernorm' || node.type==='add' || node.type==='conv2d') ? '#e4e4e4'
                        : (node.color??'#ffffff'),
          }}
          onMouseDown={e=>handleNodeMouseDown(e,node)}
          onWheel={e=>e.stopPropagation()}
        >
          {node.type==='matrix' && (
            <>
              <ModuleName>{node.name}</ModuleName>
              <MatrixDims text={'(' + (node.shape ?? [4, 4]).join(', ') + ')'} />
            </>
          )}
          {(node.type==='relu' || node.type==='linear' || node.type==='scale' || node.type==='transpose' || node.type==='softmax' || node.type==='triu' || node.type==='layernorm' || node.type==='add') && null /* slot dots rendered below */}
          {node.type==='triu' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            const d = node.diagonal ?? 0;
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#ee4c2c">Triu</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={`diag = ${d}`} />
                </div>
              </>
            );
          })()}
          {node.type==='softmax' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            const d = node.dim ?? -1;
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#ee4c2c">Softmax</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={`dim = ${d}`} />
                </div>
              </>
            );
          })()}
          {node.type==='transpose' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            const d0 = node.dim0 ?? -2, d1 = node.dim1 ?? -1;
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#ee4c2c">Transpose</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={`swap (${d0}, ${d1})`} />
                </div>
              </>
            );
          })()}
          {node.type==='scale' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            // Op symbol: 'x' for multiplication, '/' for division.
            const op  = node.op === '/' ? '/' : 'x';
            const fac = String(node.factor ?? '1');
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#ee4c2c">Scale</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={`${op} ${fac}`} />
                </div>
              </>
            );
          })()}
          {node.type==='relu' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#ee4c2c">ReLU</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text="max(0, x)" />
                </div>
              </>
            );
          })()}
          {node.type==='view' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            const shapeStr = String(node.shape ?? '-1').replace(/[()[\]]/g,'').trim();
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#ee4c2c">View</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={`(${shapeStr})`} />
                </div>
              </>
            );
          })()}
          {node.type==='dropout' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#ee4c2c">Dropout</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={`p = ${node.p ?? 0.5}`} />
                </div>
              </>
            );
          })()}
          {node.type==='slice' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            const dimsDisplay = String(node.dims ?? ':');
            const label = dimsDisplay.startsWith('[') ? dimsDisplay : `[${dimsDisplay}]`;
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#ee4c2c">Slice</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={label} />
                </div>
              </>
            );
          })()}
          {node.type==='contiguous' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#ee4c2c">contiguous</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text=".contiguous()" />
                </div>
              </>
            );
          })()}
          {node.type==='linear' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#4488ff">Linear</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={`W(${node.d_in ?? 4}, ${node.d_out ?? 4})`} />
                </div>
                {node.bias !== false && (
                  <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                    <MatrixDims text={`b(${node.d_out ?? 4})`} />
                  </div>
                )}
              </>
            );
          })()}
          {node.type==='conv2d' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            const inCh = node.in_channels ?? 1;
            const outCh = node.out_channels ?? 1;
            const g = node.groups ?? 1;
            const parseKR = (val, def) => { const str = String(val ?? def).replace(/[()[\]\s]/g, ''); const parts = str.split(',').map(s => Number(s.trim())); if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return [parts[0], parts[1]]; const n = Number(parts[0]); return [isNaN(n) ? def : n, isNaN(n) ? def : n]; };
            const [kH, kW] = parseKR(node.kernel_size, 3);
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color={node._dimError ? '#c0392b' : '#4488ff'}>Conv2d</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  {node._dimError ? (
                    <MatrixDims text="⚠ error" />
                  ) : (
                    <MatrixDims text={`W(${outCh},${g > 1 ? Math.round(inCh/g) : inCh},${kH},${kW})${g > 1 ? `×${g}` : ''}`} />
                  )}
                </div>
                {!node._dimError && node.bias !== false && (
                  <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                    <MatrixDims text={`b(${outCh})`} />
                  </div>
                )}
              </>
            );
          })()}
          {node.type==='add' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color={node._dimError ? '#c0392b' : '#ee4c2c'}>Add</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  {node._dimError ? (
                    <MatrixDims text="⚠ error" />
                  ) : (
                    <MatrixDims text="x₁ + x₂ + …" />
                  )}
                </div>
              </>
            );
          })()}
          {node.type==='layernorm' && (() => {
            const rot = node.rot ?? 0;
            const outSide = rotToOutSide(rot);
            const ns = node.normalized_shape ?? 4;
            return (
              <>
                {ALL_SIDES.filter(s => s !== outSide).map(side => (
                  <div key={side} className="node-slot node-slot-in" style={sideSlotStyle(side)}/>
                ))}
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <ModuleName color="#4488ff">LayerNorm</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={`(${ns},)`} />
                </div>
              </>
            );
          })()}
          {node.type==='masked_fill' && (() => {
            const rot = node.rot ?? 0;
            // Two input slots on the input side at 0.25 / 0.75 fractions
            // (slotFraction maps 'x' → 0.25, 'mask' → 0.75) so they share
            // the matmul A/B placement convention.
            const labelX = rot===0 ? {left:'4px',  top:'25%',   transform:'translateY(-50%)'}
                         : rot===1 ? {left:'25%',  top:'4px',   transform:'translateX(-50%)'}
                         : rot===2 ? {right:'4px', left:'auto', top:'25%',    transform:'translateY(-50%)'}
                         :           {left:'25%',  bottom:'4px',transform:'translateX(-50%)'};
            const labelM = rot===0 ? {left:'4px',  top:'75%',   transform:'translateY(-50%)'}
                         : rot===1 ? {left:'75%',  top:'4px',   transform:'translateX(-50%)'}
                         : rot===2 ? {right:'4px', left:'auto', top:'75%',    transform:'translateY(-50%)'}
                         :           {left:'75%',  bottom:'4px',transform:'translateX(-50%)'};
            return (
              <>
                <div className="node-slot node-slot-in" style={inSlotStyle(rot, 0.25)}/>
                <div className="node-slot node-slot-in" style={inSlotStyle(rot, 0.75)}/>
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <span className="node-slot-label" style={{position:'absolute',...labelX}}>x</span>
                <span className="node-slot-label" style={{position:'absolute',...labelM}}>m</span>
                <ModuleName color="#ee4c2c">MaskedFill</ModuleName>
                <div style={{ display:'block', width:'100%', textAlign:'center' }}>
                  <MatrixDims text={`fill = ${String(node.value ?? '-inf')}`} />
                </div>
              </>
            );
          })()}
          {node.type==='matmul' && (() => {
            const rot = node.rot ?? 0;
            // Label positions — always inside the node, adjacent to each slot
            // Labels just inside the node edge, aligned with each gate
            const labelA = rot===0 ? {left:'4px',  top:'25%',   transform:'translateY(-50%)'}
                         : rot===1 ? {left:'25%',  top:'4px',   transform:'translateX(-50%)'}
                         : rot===2 ? {right:'4px', left:'auto', top:'25%',    transform:'translateY(-50%)'}
                         :           {left:'25%',  bottom:'4px',transform:'translateX(-50%)'};
            const labelB = rot===0 ? {left:'4px',  top:'75%',   transform:'translateY(-50%)'}
                         : rot===1 ? {left:'75%',  top:'4px',   transform:'translateX(-50%)'}
                         : rot===2 ? {right:'4px', left:'auto', top:'75%',    transform:'translateY(-50%)'}
                         :           {left:'75%',  bottom:'4px',transform:'translateX(-50%)'};
            return (
              <>
                <div className="node-slot node-slot-in" style={inSlotStyle(rot, 0.25)}/>
                <div className="node-slot node-slot-in" style={inSlotStyle(rot, 0.75)}/>
                <div className="node-slot node-slot-out" style={outSlotStyle(rot)}/>
                <span className="node-slot-label" style={{position:'absolute',...labelA}}>A</span>
                <span className="node-slot-label" style={{position:'absolute',...labelB}}>B</span>
                <span className="matmul-symbol">@</span>
              </>
            );
          })()}
        </div>
      ))}
    </>
  );
}
