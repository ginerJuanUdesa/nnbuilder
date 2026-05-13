/* Shape propagation engine — mirrors PyTorch semantics */
let shapeCache = {};

/* Simple per-layer shape (no graph traversal) — used as fallback */
function getLayerShape(layer) {
  if (layer.type === 'input')  return layer.dims || [1];
  if (layer.type === 'linear') return [layer.units || 128];
  return null;
}

/* Full graph-aware shape propagation. Called every frame before draw. */
function computeOutputShapes() {
  shapeCache = {};

  function resolveShape(layerId) {
    if (shapeCache[layerId] !== undefined) return shapeCache[layerId];
    const layer = layers.find(l => l.id === layerId);
    if (!layer) return null;

    /* INPUT: shape = dims (resolved) */
    if (layer.type === 'input') {
      shapeCache[layerId] = layer.dims ? layer.dims.map(resolveVal) : [1];
      return shapeCache[layerId];
    }

    /* FLATTEN: PyTorch nn.Flatten semantics (batch-less: dim 0 here = PyTorch dim 1)
       default start_dim=0, end_dim=-1 → flatten all dims */
    if (layer.type === 'flatten') {
      const incoming = connections.filter(c => c.to === layerId);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      if (!srcShape) { shapeCache[layerId] = null; return null; }
      const n  = srcShape.length;
      const sd = layer.start_dim !== undefined ? layer.start_dim : 0;
      const ed = layer.end_dim   !== undefined ? layer.end_dim   : -1;
      const s  = Math.max(0, Math.min(sd < 0 ? n + sd : sd, n - 1));
      const e  = Math.max(s,  Math.min(ed < 0 ? n + ed : ed, n - 1));
      const flatPart = srcShape.slice(s, e + 1).reduce((a, b) => a * b, 1);
      shapeCache[layerId] = [...srcShape.slice(0, s), flatPart, ...srcShape.slice(e + 1)];
      return shapeCache[layerId];
    }

    /* LINEAR: PyTorch nn.Linear operates on last dim only → (..., in) → (..., out) */
    if (layer.type === 'linear') {
      const units    = resolveVal(layer.units || 128);
      const incoming = connections.filter(c => c.to === layerId);
      if (incoming.length === 0) { shapeCache[layerId] = [units]; return shapeCache[layerId]; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      if (!srcShape || srcShape.length === 0) { shapeCache[layerId] = [units]; return shapeCache[layerId]; }
      shapeCache[layerId] = [...srcShape.slice(0, -1), units]; // preserve leading dims
      return shapeCache[layerId];
    }

    /* MEAN: torch.mean semantics */
    if (layer.type === 'mean') {
      const incoming = connections.filter(c => c.to === layerId);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      if (!srcShape || srcShape.length === 0) { shapeCache[layerId] = null; return null; }
      const rawDim   = layer.reduce_dim !== undefined ? layer.reduce_dim : 0;
      const dimArr   = Array.isArray(rawDim) ? rawDim : [rawDim];
      const n        = srcShape.length;
      const normDims = new Set(dimArr.map(d => d < 0 ? n + d : d));
      const keepdim  = !!layer.keepdim;
      const outShape = [];
      for (let i = 0; i < n; i++) {
        if (normDims.has(i)) { if (keepdim) outShape.push(1); }
        else outShape.push(srcShape[i]);
      }
      shapeCache[layerId] = outShape.length > 0 ? outShape : [1];
      return shapeCache[layerId];
    }

    /* OUTPUT: passthrough */
    if (layer.type === 'output') {
      const incoming = connections.filter(c => c.to === layer.id);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      shapeCache[layerId] = srcShape || null;
      return shapeCache[layerId];
    }

    return null;
  }

  for (const l of layers) {
    if (l.type === 'output') l.outputShape = resolveShape(l.id);
    resolveShape(l.id);
  }

  /* Parameter counting: weight = (out, in), bias = (out,) — matches PyTorch convention */
  let totalParams = 0;
  for (const c of connections) {
    const toLayer   = layers.find(l => l.id === c.to);
    const fromShape = shapeCache[c.from];
    if (!toLayer || !fromShape) { c.paramCount = 0; c.paramLabel = ''; c.paramLabelTop = ''; continue; }
    if (toLayer.type === 'linear') {
      const units       = resolveVal(toLayer.units || 128);
      const inFeatures  = fromShape[fromShape.length - 1] || 1; // last dim = in_features
      const allIncoming = connections.filter(cc => cc.to === toLayer.id);
      const isFirst     = allIncoming[0] === c;
      if (isFirst) {
        const weights   = inFeatures * units;
        const bias      = units;
        c.paramCount    = weights + bias;
        c.paramLabel    = `W[${inFeatures}, ${units}]  b[${units}]`;
        c.paramLabelTop = `${inFeatures}×${units}+${bias}=${(weights + bias).toLocaleString()}`;
        totalParams    += c.paramCount;
      } else {
        c.paramCount = 0; c.paramLabel = 'shared W'; c.paramLabelTop = '';
      }
    } else {
      c.paramCount = 0; c.paramLabel = ''; c.paramLabelTop = '';
    }
  }
  window._totalParams = totalParams;
}
