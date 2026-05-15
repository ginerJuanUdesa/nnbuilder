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

    /* CONV: PyTorch Conv{1,2,3}d semantics
       ndim=1: operates on last-2 dims (C, L_in) → (C_out, L_out)
       ndim=2: operates on last-3 dims (C, H, W) → (C_out, H_out, W_out)
       ndim=3: operates on last-4 dims (C, D, H, W) → (C_out, D_out, H_out, W_out)
       Input: [..., C_in, D_in?, H_in, W_in] → Output: [..., C_out, D_out?, H_out, W_out]

       PyTorch formula per spatial dim:
         out = floor((in + 2*padding - dilation*(kernel_size-1) - 1) / stride + 1)

       kernel_size, stride, padding, dilation can be scalar (broadcast) or tuple (per-dim). */
    if (layer.type === 'conv') {
      const oc    = resolveVal(layer.out_channels || 16);
      const gr    = resolveVal(layer.groups || 1);
      const ndim  = layer.ndim !== undefined ? layer.ndim : 2;
      const incoming = connections.filter(c => c.to === layerId);
      if (incoming.length === 0) { shapeCache[layerId] = [oc]; return shapeCache[layerId]; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      if (!srcShape || srcShape.length === 0) { shapeCache[layerId] = [oc]; return shapeCache[layerId]; }

      /* Prepend leading 1s (batch-like dims) until we have at least ndim+1 dims.
         App input uses no-batch shapes: e.g. [28, 28] for a 28×28 image.
         Conv2d expects (C, H, W) = 3 dims, so [28, 28] becomes [1, 28, 28]. */
      const spatialDims = ndim + 1; // C + spatial
      let paddedShape = [...srcShape];
      while (paddedShape.length < spatialDims) paddedShape.unshift(1);
      const n = paddedShape.length;
      const cIn = paddedShape[n - spatialDims];
      const spatialIn = paddedShape.slice(n - spatialDims + 1, n);
      const leading = n > spatialDims ? paddedShape.slice(0, n - spatialDims) : [];
      if (cIn % gr !== 0) { shapeCache[layerId] = [oc]; return shapeCache[layerId]; }

      /* Resolve per-dimension params: scalar broadcasts, array is per-spatial-dim */
      const rawKs = layer.kernel_size !== undefined ? layer.kernel_size : 3;
      const rawSt = layer.stride       !== undefined ? layer.stride       : 1;
      const rawPd = layer.padding      !== undefined ? layer.padding      : 0;
      const rawDl = layer.dilation     !== undefined ? layer.dilation     : 1;
      const ksArr = Array.isArray(rawKs) ? rawKs.map(v => resolveVal(v)) : Array(ndim).fill(resolveVal(rawKs));
      const stArr = Array.isArray(rawSt) ? rawSt.map(v => resolveVal(v)) : Array(ndim).fill(resolveVal(rawSt));
      const pdArr = Array.isArray(rawPd) ? rawPd.map(v => resolveVal(v)) : Array(ndim).fill(resolveVal(rawPd));
      const dlArr = Array.isArray(rawDl) ? rawDl.map(v => resolveVal(v)) : Array(ndim).fill(resolveVal(rawDl));

      const spatialOut = spatialIn.map((s, i) =>
        Math.floor((s + 2 * pdArr[i] - dlArr[i] * (ksArr[i] - 1) - 1) / stArr[i] + 1)
      );
       shapeCache[layerId] = [...leading, oc, ...spatialOut];
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

    /* UNSQUEEZE: torch.unsqueeze — inserts size-1 dim at position `dim` */
    if (layer.type === 'unsqueeze') {
      const incoming = connections.filter(c => c.to === layerId);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      if (!srcShape) { shapeCache[layerId] = null; return null; }
      const ndim = srcShape.length;
      const dim  = layer.dim !== undefined ? resolveVal(layer.dim) : 0;
      const actualDim = dim < 0 ? ndim + 1 + dim : dim;
      const out = [...srcShape];
      out.splice(Math.max(0, Math.min(actualDim, ndim)), 0, 1);
      shapeCache[layerId] = out;
      return shapeCache[layerId];
    }

    /* SQUEEZE: torch.squeeze — removes size-1 dims.
       dim=null → remove ALL size-1 dims; dim=N → remove dim N only if size==1 */
    if (layer.type === 'squeeze') {
      const incoming = connections.filter(c => c.to === layerId);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      if (!srcShape) { shapeCache[layerId] = null; return null; }
      const rawDim = layer.dim !== undefined && layer.dim !== null && layer.dim !== '' ? resolveVal(layer.dim) : null;
      let out;
      if (rawDim === null || rawDim === undefined) {
        out = srcShape.filter(d => d !== 1);
        if (out.length === 0) out = [1]; // squeeze of all-1s → scalar represented as [1]
      } else {
        const n = srcShape.length;
        const d = rawDim < 0 ? n + rawDim : rawDim;
        out = [...srcShape];
        if (d >= 0 && d < n && srcShape[d] === 1) out.splice(d, 1);
        if (out.length === 0) out = [1];
      }
      shapeCache[layerId] = out;
      return shapeCache[layerId];
    }

    /* SOFTMAX: nn.Softmax(dim) — shape passthrough */
    if (layer.type === 'softmax') {
      const incoming = connections.filter(c => c.to === layerId);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      shapeCache[layerId] = srcShape ? [...srcShape] : null;
      return shapeCache[layerId];
    }

    /* ADD: torch.add — element-wise sum of all inputs, shape passthrough.
       All inputs must have identical shapes (PyTorch broadcasting not modelled here). */
    if (layer.type === 'add') {
      const incoming = connections.filter(c => c.to === layerId);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const shapes = incoming.map(c => resolveShape(c.from)).filter(Boolean);
      if (shapes.length === 0) { shapeCache[layerId] = null; return null; }
      // PyTorch broadcasting: pad leading 1s, output dim = max of each position
      // incompatible if two non-1 dims at same position differ
      const maxNdim = Math.max(...shapes.map(s => s.length));
      const padded  = shapes.map(s => [...Array(maxNdim - s.length).fill(1), ...s]);
      const out = [];
      let compatible = true;
      for (let i = 0; i < maxNdim; i++) {
        const dims    = padded.map(s => s[i]);
        const nonOnes = dims.filter(d => d !== 1);
        if (nonOnes.length > 0 && !nonOnes.every(d => d === nonOnes[0])) { compatible = false; break; }
        out.push(nonOnes.length > 0 ? nonOnes[0] : 1);
      }
      shapeCache[layerId] = compatible ? out : null;
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
        const weights    = inFeatures * units;
        const hasBias    = toLayer.bias !== false;
        const biasCount  = hasBias ? units : 0;
        c.paramCount    = weights + biasCount;
        c.paramLabel    = hasBias ? `W[${inFeatures}, ${units}]  b[${units}]` : `W[${inFeatures}, ${units}]`;
        c.paramLabelTop = hasBias
          ? `${inFeatures}×${units}+${biasCount}=${(weights + biasCount).toLocaleString()}`
          : `${inFeatures}×${units}=${weights.toLocaleString()}`;
        totalParams    += c.paramCount;
      } else {
        c.paramCount = 0; c.paramLabel = 'shared W'; c.paramLabelTop = '';
      }
    } else if (toLayer.type === 'conv') {
      const oc    = resolveVal(toLayer.out_channels || 16);
      const gr    = resolveVal(toLayer.groups || 1);
      const ndim  = toLayer.ndim !== undefined ? toLayer.ndim : 2;
      const spatialDims = ndim + 1; // C + spatial
      const cIn = fromShape[fromShape.length - spatialDims] || 1;
      const allIncoming = connections.filter(cc => cc.to === toLayer.id);
      const isFirst = allIncoming[0] === c;
      if (isFirst) {
        const rawKs = toLayer.kernel_size !== undefined ? toLayer.kernel_size : 3;
        const ksArr = Array.isArray(rawKs) ? rawKs.map(v => resolveVal(v)) : Array(ndim).fill(resolveVal(rawKs));
        const ksProduct = ksArr.reduce((a, b) => a * b, 1);
        const weights = oc * (cIn / gr) * ksProduct;
        const bias    = oc;
        c.paramCount  = weights + bias;
        const ksLabel = ksArr.join(', ');
        c.paramLabel  = `W[${oc}, ${cIn / gr}, ${ksLabel}]  b[${oc}]`;
        c.paramLabelTop = `${weights.toLocaleString()}+${bias}=${(weights + bias).toLocaleString()}`;
        totalParams  += c.paramCount;
      } else {
        c.paramCount = 0; c.paramLabel = 'shared W'; c.paramLabelTop = '';
      }
    } else {
      c.paramCount = 0; c.paramLabel = ''; c.paramLabelTop = '';
    }
  }
  window._totalParams = totalParams;
}
