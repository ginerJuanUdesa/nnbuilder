/* PRNG */
function hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) >>> 0;
}
function hashF(x, y) { return hash(x, y) / 4294967296; }

/* Coordinate transforms */
function worldToScreen(wx, wy) {
  return [(wx - camX) * zoom + W / 2, (wy - camY) * zoom + H / 2];
}
function screenToWorld(sx, sy) {
  return [(sx - W / 2) / zoom + camX, (sy - H / 2) / zoom + camY];
}
function snapToGrid(v) {
  return Math.round(v / gridSpacing) * gridSpacing;
}

/* Color utility */
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r}, ${g}, ${b}`;
}

/* Variable resolution — resolves a string name to its numeric value.
   Supports formula mode: variable.formula = 'sqrt(B)' etc.           */

const _MATH_CTX = {
  sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  abs: Math.abs, log: Math.log, log2: Math.log2, log10: Math.log10,
  exp: Math.exp, pow: Math.pow, min: Math.min, max: Math.max,
  sign: Math.sign, trunc: Math.trunc, PI: Math.PI, E: Math.E,
};

function evalFormula(formula, depth) {
  if (depth > 10) return 1; // cycle guard
  const ctx = { ..._MATH_CTX };
  variables.forEach(vr => { if (vr.name) ctx[vr.name] = resolveVar(vr, depth + 1); });
  try {
    const fn = new Function(...Object.keys(ctx), `"use strict"; return (${formula});`);
    const result = fn(...Object.values(ctx));
    if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) return 1;
    return Math.max(1, Math.round(result));
  } catch { return 1; }
}

function resolveVar(vr, depth = 0) {
  if (depth > 10) return 1;
  // legacy formula field — backward compat with old saves
  if (vr.formula && vr.formula.trim()) return evalFormula(vr.formula.trim(), depth);
  const str = (vr.value || '').trim();
  // pure integer → parse directly
  if (/^-?\d+$/.test(str)) { const n = parseInt(str); return isNaN(n) ? 1 : Math.max(1, n); }
  // anything else → auto-treat as formula (variable refs, math expressions)
  if (str) return evalFormula(str, depth);
  return 1;
}

function resolveVal(v) {
  if (typeof v === 'number') return v;
  const str = String(v).trim();
  const found = variables.find(vr => vr.name === str);
  if (found) return resolveVar(found, 0);
  const n = parseInt(str);
  return isNaN(n) ? 1 : Math.max(1, n);
}

/* Ensure the batch-size variable B is always first in variables[].
   Called after every state load/restore so it can never be missing. */
function ensureBatchVar() {
  let bIdx = variables.findIndex(v => v._batch);
  if (bIdx === -1) {
    variables.unshift({ name: 'BATCH', value: '32', _batch: true });
  } else {
    if (bIdx !== 0) {
      const bv = variables.splice(bIdx, 1)[0];
      variables.unshift(bv);
    }
    variables[0].name = 'BATCH'; // name is fixed
  }
}

/* getDisplayShape — like shapeCache but preserves variable names in dims.
   Traces raw layer props instead of resolved numbers where possible. */
function getDisplayShape(layerId) {
  // Per-frame memo: getDisplayShape recurses upstream; without caching, drawing
  // each layer re-walks the whole chain → O(D^2*(n+m)) per frame. _dispCache is
  // cleared in computeOutputShapes (same lifecycle as shapeCache).
  if (layerId in _dispCache) return _dispCache[layerId];
  _dispCache[layerId] = null; // cycle sentinel: break self/mutual recursion
  const _r = _computeDisplayShape(layerId);
  _dispCache[layerId] = _r;
  return _r;
}
function _computeDisplayShape(layerId) {
  const layer = layers.find(l => l.id === layerId);
  if (!layer) return null;
  const resolved = shapeCache[layerId];
  if (!resolved) return null;

  if (layer.type === 'input') {
    return ['BATCH', ...(layer.dims || []).map(d => d)]; // BATCH always prepended as dim 0
  }
  if (layer.type === 'triu') {
    return (layer.dims && layer.dims.length) ? layer.dims.map(d => d) : [1, 1];
  }
  if (layer.type === 'maskedfill') {
    const inc = (_connByTo.get(layerId) || []);
    return inc.length > 0 ? getDisplayShape(inc[0].from) : resolved;
  }
  if (layer.type === 'linear' || layer.type === 'shared_dense') {
    const inc = (_connByTo.get(layerId) || []);
    const srcDisp = inc.length > 0 ? getDisplayShape(inc[0].from) : null;
    const leading = srcDisp ? srcDisp.slice(0, -1) : resolved.slice(0, -1);
    const last = layer.units !== undefined ? layer.units : resolved[resolved.length - 1];
    return [...leading, last];
  }
  if (layer.type === 'unsqueeze') {
    const inc = (_connByTo.get(layerId) || []);
    const srcDisp = inc.length > 0 ? getDisplayShape(inc[0].from) : null;
    if (!srcDisp) return resolved;
    const dim = layer.dim !== undefined ? resolveVal(layer.dim) : 0;
    const actualDim = dim < 0 ? srcDisp.length + 1 + dim : dim;
    const out = [...srcDisp];
    out.splice(Math.max(0, Math.min(actualDim, srcDisp.length)), 0, 1);
    return out;
  }
  if (layer.type === 'squeeze') {
    const inc = (_connByTo.get(layerId) || []);
    const srcDisp = inc.length > 0 ? getDisplayShape(inc[0].from) : null;
    if (!srcDisp) return resolved;
    const rawDim = layer.dim !== undefined && layer.dim !== null && layer.dim !== '' ? resolveVal(layer.dim) : null;
    if (rawDim === null || rawDim === undefined) {
      const out = srcDisp.filter(d => d !== 1 && d !== '1');
      return out.length > 0 ? out : [1];
    }
    const n = srcDisp.length;
    const d = rawDim < 0 ? n + rawDim : rawDim;
    const out = [...srcDisp];
    const resolvedVal = (d >= 0 && d < n) ? resolveVal(srcDisp[d]) : -1;
    if (resolvedVal === 1) out.splice(d, 1);
    return out.length > 0 ? out : [1];
  }
  if (layer.type === 'softmax') {
    const inc = (_connByTo.get(layerId) || []);
    return inc.length > 0 ? getDisplayShape(inc[0].from) : resolved;
  }
  if (layer.type === 'layernorm') {
    const inc = (_connByTo.get(layerId) || []);
    return inc.length > 0 ? getDisplayShape(inc[0].from) : resolved;
  }
  if (layer.type === 'rmsnorm') {
    const inc = (_connByTo.get(layerId) || []);
    return inc.length > 0 ? getDisplayShape(inc[0].from) : resolved;
  }
  if (layer.type === 'scale') {
    const inc = (_connByTo.get(layerId) || []);
    return inc.length > 0 ? getDisplayShape(inc[0].from) : resolved;
  }
  if (layer.type === 'transpose') {
    const inc = (_connByTo.get(layerId) || []);
    if (inc.length === 0) return resolved;
    const srcDisp = getDisplayShape(inc[0].from);
    if (!srcDisp) return resolved;
    const n  = srcDisp.length;
    let d0 = layer.dim0 !== undefined ? Number(layer.dim0) : 0;
    let d1 = layer.dim1 !== undefined ? Number(layer.dim1) : 1;
    if (d0 < 0) d0 = n + d0;
    if (d1 < 0) d1 = n + d1;
    if (d0 < 0 || d0 >= n || d1 < 0 || d1 >= n) return resolved;
    const out = [...srcDisp];
    [out[d0], out[d1]] = [out[d1], out[d0]];
    return out;
  }
  if (layer.type === 'add') {
    const inc = (_connByTo.get(layerId) || []);
    if (inc.length === 0) return resolved;
    const dispShapes = inc.map(c => getDisplayShape(c.from)).filter(Boolean);
    if (dispShapes.length === 0) return resolved;
    // Apply PyTorch broadcasting over display shapes (preserves variable names)
    const maxNdim = Math.max(...dispShapes.map(s => s.length));
    const padded  = dispShapes.map(s => [...Array(maxNdim - s.length).fill(1), ...s]);
    const out = [];
    let compatible = true;
    for (let i = 0; i < maxNdim; i++) {
      const dims    = padded.map(s => s[i]);
      const nonOnes = dims.filter(d => d !== 1 && d !== '1');
      if (nonOnes.length > 0 && !nonOnes.every(d => d === nonOnes[0])) { compatible = false; break; }
      out.push(nonOnes.length > 0 ? nonOnes[0] : 1);
    }
    return compatible ? out : resolved;
  }
  if (layer.type === 'matmul') {
    const inc = (_connByTo.get(layerId) || []);
    if (inc.length < 2) return resolved;
    const dispA = getDisplayShape(inc[0].from);
    const dispB = getDisplayShape(inc[1].from);
    if (!dispA || !dispB || dispA.length < 2 || dispB.length < 2) return resolved;
    const n = dispA[dispA.length - 2];
    const p = dispB[dispB.length - 1];
    const batchA = dispA.slice(0, -2);
    const batchB = dispB.slice(0, -2);
    const maxBatch = Math.max(batchA.length, batchB.length);
    const padA = [...Array(maxBatch - batchA.length).fill(1), ...batchA];
    const padB = [...Array(maxBatch - batchB.length).fill(1), ...batchB];
    const batchOut = padA.map((a, i) => (a === 1 || a === '1') ? padB[i] : a);
    return [...batchOut, n, p];
  }
  if (layer.type === 'custom') {
    const cInc = (_connByTo.get(layerId) || []);
    const extDisp = cInc.length ? getDisplayShape(cInc[cInc.length - 1].from) : null;
    if (layer.subnet && typeof subnetDisplay === 'function') {
      const d = subnetDisplay(layer.subnet, extDisp, layer.varOverrides);
      if (d) return d;
    }
    return resolved;
  }
  if (layer.type === 'fanout') {
    // container → stacked into a new dim: inner [B,…] → [B, N, …]
    const inner = (typeof _fanoutInnerMap !== 'undefined') ? _fanoutInnerMap.get(layerId) : null;
    if (!inner) return resolved;
    const d = getDisplayShape(inner.id);
    if (!d || d.length === 0) return d || resolved;
    const rawN = layer.n !== undefined ? layer.n : 2;
    const Nshow = /^-?\d+$/.test(String(rawN)) ? Math.max(1, parseInt(rawN, 10)) : rawN;
    return [d[0], Nshow, ...d.slice(1)];
  }
  if (layer.type === 'concat') {
    const inc = (_connByTo.get(layerId) || []);
    if (inc.length === 0) return resolved;
    const ds = inc.map(c => getDisplayShape(c.from)).filter(Boolean);
    if (ds.length === 0) return resolved;
    const nd = ds[0].length;
    if (!ds.every(s2 => s2.length === nd)) return resolved;
    let d = layer.dim !== undefined ? resolveVal(layer.dim) : -1;
    if (d < 0) d = nd + d;
    if (d < 0 || d >= nd) return resolved;
    const out = [...ds[0]];
    const col = ds.map(s2 => s2[d]);
    if (col.length > 1 && col.every(v => v === col[0])) {
      out[d] = `${col.length}×${col[0]}`;          // N identical → "6×size"
    } else if (col.every(v => typeof v === 'number')) {
      out[d] = col.reduce((a, b) => a + b, 0);          // mixed numeric → sum
    } else {
      out[d] = col.join('+');                            // symbolic → a+b+...
    }
    return out;
  }
  if (layer.type === 'output') {
    const inc = (_connByTo.get(layerId) || []);
    return inc.length > 0 ? getDisplayShape(inc[0].from) : resolved;
  }
  return resolved; // flatten, mean, conv — fall back to resolved
}

/* Spatial queries */
function overlapsAny(wx, wy, excludeId) {
  for (const l of layers) {
    if (l.id === excludeId) continue;
    if (l.type === 'fanout') continue; // container: boxes are meant to sit inside it
    const t = layerTypes[l.type];
    if (Math.abs(wx - l.x) < t.w && Math.abs(wy - l.y) < t.h) return true;
  }
  return false;
}

/* If layerId is the inner box of a FANOUT container, return that fanout
   layer (connections must attach to the container, not the internal box). */
function fanoutOwnerOf(layerId) {
  if (typeof _fanoutInnerMap === 'undefined') return null;
  for (const [fid, innerL] of _fanoutInnerMap) {
    if (innerL && innerL.id === layerId) return layers.find(l => l.id === fid) || null;
  }
  return null;
}

function hitTestLayer(wx, wy) {
  // pass 1: non-container layers (so a box inside a FANOUT is grabbable)
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.type === 'fanout') continue;
    const t = layerTypes[l.type];
    const hw = t.w / 2, hh = t.h / 2;
    if (wx >= l.x - hw && wx <= l.x + hw && wy >= l.y - hh && wy <= l.y + hh) return l;
  }
  // pass 2: fanout containers (fallback — empty area inside one selects it)
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.type !== 'fanout') continue;
    const t = layerTypes[l.type];
    const hw = t.w / 2, hh = t.h / 2;
    if (wx >= l.x - hw && wx <= l.x + hw && wy >= l.y - hh && wy <= l.y + hh) return l;
  }
  return null;
}

/* --- Superbox nesting helpers --- */
function sbDepth(sb) {
  let d = 0, cur = sb;
  while (cur && cur.parentId) {
    cur = superboxes.find(s => s.id === cur.parentId);
    if (++d > 30) break; // cycle guard
  }
  return d;
}

function isSbDescendant(sb, ancestorId) {
  // returns true if 'sb' is a descendant of ancestorId (to prevent cycles)
  let cur = sb;
  while (cur && cur.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = superboxes.find(s => s.id === cur.parentId);
    if (sbDepth(cur || {}) > 30) break;
  }
  return false;
}

function sbsSortedByDepth() {
  return [...superboxes].sort((a, b) => sbDepth(a) - sbDepth(b));
}

/* Find which superbox a world point falls into (deepest child first) */
function hitTestSuperboxDeepest(wx, wy) {
  // iterate sorted deepest-first so children take priority
  // bgVisible===false superboxes are invisible — skip so they can't be dragged
  const sorted = sbsSortedByDepth().reverse();
  for (const sb of sorted) {
    if (sb.bgVisible === false) continue;
    if (wx >= sb.x && wx <= sb.x + sb.w && wy >= sb.y && wy <= sb.y + sb.h) {
      return superboxes.indexOf(sb);
    }
  }
  return -1;
}

const _SB_EDGE_CURSORS = {
  n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize',
  ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize'
};

function hitTestSuperboxEdge(wx, wy) {
  const th = Math.max(6, 8 / zoom); // 8 screen px in world space
  for (let i = superboxes.length - 1; i >= 0; i--) {
    const sb = superboxes[i];
    if (sb.bgVisible === false) continue;
    const { x, y, w, h } = sb;
    const inX  = wx >= x - th && wx <= x + w + th;
    const inY  = wy >= y - th && wy <= y + h + th;
    if (!inX || !inY) continue;
    const onL = wx >= x - th && wx <= x + th;
    const onR = wx >= x + w - th && wx <= x + w + th;
    const onT = wy >= y - th && wy <= y + th;
    const onB = wy >= y + h - th && wy <= y + h + th;
    // corners first
    if (onL && onT) return { idx: i, edge: 'nw' };
    if (onR && onT) return { idx: i, edge: 'ne' };
    if (onL && onB) return { idx: i, edge: 'sw' };
    if (onR && onB) return { idx: i, edge: 'se' };
    // edges
    if (onL && wy >= y && wy <= y + h) return { idx: i, edge: 'w' };
    if (onR && wy >= y && wy <= y + h) return { idx: i, edge: 'e' };
    if (onT && wx >= x && wx <= x + w) return { idx: i, edge: 'n' };
    if (onB && wx >= x && wx <= x + w) return { idx: i, edge: 's' };
  }
  return null;
}

function hitTestSuperbox(wx, wy) {
  return hitTestSuperboxDeepest(wx, wy);
}

/* hitTestConnection calls buildConnPath (defined in renderer.js) — safe at call-time */
function hitTestConnection(sx, sy, threshold) {
  const th = threshold || 8;
  for (let i = connections.length - 1; i >= 0; i--) {
    const c = connections[i];
    const fromLayer = layers.find(l => l.id === c.from);
    const toLayer   = layers.find(l => l.id === c.to);
    if (!fromLayer || !toLayer) continue;
    const path = buildConnPath(fromLayer, toLayer, c);
    for (let j = 0; j < path.length - 1; j++) {
      const p1 = path[j], p2 = path[j + 1];
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;
      let t = ((sx - p1.x) * dx + (sy - p1.y) * dy) / (len * len);
      t = Math.max(0, Math.min(1, t));
      const px = p1.x + t * dx, py = p1.y + t * dy;
      if (Math.sqrt((sx - px) ** 2 + (sy - py) ** 2) <= th) return i;
    }
  }
  return -1;
}

function isHologramBlocked(layer) {
  const t = layerTypes[layer.type];
  const boxTop = layer.y - t.h / 2;
  for (const other of layers) {
    if (other.id === layer.id) continue;
    const ot = layerTypes[other.type];
    const xOverlap = Math.abs(other.x - layer.x) < (t.w + ot.w) / 2;
    const yOverlap = other.y + ot.h / 2 > boxTop - 100 && other.y - ot.h / 2 < boxTop;
    if (xOverlap && yOverlap) return true;
  }
  return false;
}

function canConnect(from, to) {
  if (from.id === to.id) return false;
  return (
    (from.type === 'input'     && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'linear'    && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'mean'      && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'flatten'   && ['linear', 'mean', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'conv'      && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'unsqueeze' && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'squeeze'   && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'softmax'   && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'add'       && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'matmul'       && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'scale'     && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'transpose' && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'output'    && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'layernorm'  && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'rmsnorm'   && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'custom'    && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'concat'    && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'fanout'    && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type)) ||
    (from.type === 'triu'      && ['output', 'matmul', 'add', 'scale', 'transpose', 'unsqueeze', 'squeeze', 'concat', 'fanout', 'custom', 'maskedfill'].includes(to.type)) ||
    (from.type === 'maskedfill'&& ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm', 'custom', 'concat', 'fanout', 'maskedfill'].includes(to.type))
  );
}

/* getLayerOutputLabel uses shapeCache (defined in shapes.js) — safe at call-time */
function getLayerOutputLabel(layerId) {
  const l = layers.find(x => x.id === layerId);
  if (!l) return '?';
  if (l.type === 'input') {
    if (!l.dims || l.dims.length === 0) return '?';
    const prod = l.dims.map(d => resolveVal(d)).reduce((a, b) => a * b, 1);
    return String(prod);
  }
  if (l.type === 'linear' || l.type === 'shared_dense') return String(l.units || '?');
  if (l.type === 'mean') {
    const cached = shapeCache[l.id];
    return cached ? `[${cached.join(',')}]` : '?';
  }
  const cached = shapeCache[layerId];
  return cached ? String(cached[0]) : '?';
}
