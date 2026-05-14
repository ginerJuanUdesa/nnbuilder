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

/* Variable resolution — resolves a string name to its numeric value */
function resolveVal(v) {
  if (typeof v === 'number') return v;
  const str = String(v).trim();
  const found = variables.find(vr => vr.name === str);
  if (found) { const n = parseInt(found.value); return isNaN(n) ? 1 : Math.max(1, n); }
  const n = parseInt(str);
  return isNaN(n) ? 1 : Math.max(1, n);
}

/* Spatial queries */
function overlapsAny(wx, wy, excludeId) {
  for (const l of layers) {
    if (l.id === excludeId) continue;
    const t = layerTypes[l.type];
    if (Math.abs(wx - l.x) < t.w && Math.abs(wy - l.y) < t.h) return true;
  }
  return false;
}

function hitTestLayer(wx, wy) {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    const t = layerTypes[l.type];
    const hw = t.w / 2, hh = t.h / 2;
    if (wx >= l.x - hw && wx <= l.x + hw && wy >= l.y - hh && wy <= l.y + hh) return l;
  }
  return null;
}

/* hitTestConnection calls buildConnPath (defined in renderer.js) — safe at call-time */
function hitTestConnection(sx, sy, threshold) {
  const th = threshold || 8;
  for (let i = connections.length - 1; i >= 0; i--) {
    const c = connections[i];
    const fromLayer = layers.find(l => l.id === c.from);
    const toLayer   = layers.find(l => l.id === c.to);
    if (!fromLayer || !toLayer) continue;
    const path = buildConnPath(fromLayer, toLayer);
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
    (from.type === 'input'   && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'softmax', 'add'].includes(to.type)) ||
    (from.type === 'linear'  && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'softmax', 'add'].includes(to.type)) ||
    (from.type === 'mean'    && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'softmax', 'add'].includes(to.type)) ||
    (from.type === 'flatten' && ['linear', 'mean', 'output', 'conv', 'unsqueeze', 'softmax', 'add'].includes(to.type)) ||
    (from.type === 'conv'    && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'softmax', 'add'].includes(to.type)) ||
    (from.type === 'unsqueeze' && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'softmax', 'add'].includes(to.type)) ||
    (from.type === 'softmax'   && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'softmax', 'add'].includes(to.type)) ||
    (from.type === 'add'       && ['linear', 'mean', 'flatten', 'output', 'conv', 'unsqueeze', 'softmax', 'add'].includes(to.type))
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
