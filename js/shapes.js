/* Shape propagation engine — mirrors PyTorch semantics */
let shapeCache = {};
let _dispCache = {}; // per-frame memo for getDisplayShape (cleared with shapeCache)
let _connByTo = new Map(); // c.to -> [conns], rebuilt when graph changes
let _connByFrom = new Map(); // c.from -> [conns], rebuilt when graph changes
let _fanoutInnerMap = new Map(); // fanoutId -> inner layer (geometry), for display side

/* Simple per-layer shape (no graph traversal) — used as fallback */
function getLayerShape(layer) {
  if (layer.type === 'input')  return ['BATCH', ...(layer.dims || [1])];
  if (layer.type === 'linear') return [layer.units || 128];
  return null;
}

/* Full graph-aware shape propagation. Called every frame before draw. */
let _shapesDirty = true; // mark dirty when graph changes; cleared after compute
function computeOutputShapes() {
  if (!_shapesDirty) return; // shapes already up-to-date
  _shapesDirty = false;
  shapeCache = {};
  _dispCache  = {};
  _connByTo   = new Map();
  _connByFrom = new Map();
  const _layerById = new Map();
  for (const l of layers) _layerById.set(l.id, l);
  for (const c of connections) {
    if (!_connByTo.has(c.to)) _connByTo.set(c.to, []);
    _connByTo.get(c.to).push(c);
    if (!_connByFrom.has(c.from)) _connByFrom.set(c.from, []);
    _connByFrom.get(c.from).push(c);
  }
  // Order incoming edges by creation order (seq) so non-commutative
  // multi-input ops resolve correctly (matmul A@B, concat order, …).
  for (const arr of _connByTo.values()) {
    arr.sort((a, b) => ((a.seq != null ? a.seq : 0) - (b.seq != null ? b.seq : 0)));
  }

  /* ── FANOUT containment ──────────────────────────────────────────────
     FANOUT is a container region holding exactly ONE inner box (by
     geometry: inner box centre within the fanout's rectangle). It
     simulates N replicas of that inner box, each receiving the fanout's
     input. The fanout's outgoing edge is expanded to N edges so any
     consumer (CONCAT joins N, ADD sums N, …) sees N inputs.
     PyTorch equivalent (future):
       self.branch = nn.ModuleList([Inner() for _ in range(N)])
       outs = [b(x) for b in self.branch]            # then cat/add/… */
  _fanoutInnerMap = new Map();
  const _innerToFanout = new Map();
  for (const f of layers) {
    if (f.type !== 'fanout') continue;
    const ft = layerTypes.fanout;
    const fw = (f.w || ft.w), fh = (f.h || ft.h);
    const fx0 = f.x - fw / 2, fx1 = f.x + fw / 2;
    const fy0 = f.y - fh / 2, fy1 = f.y + fh / 2;
    // Pick the box with the largest overlap-area with the fanout rect
    // (forgiving: a box only partly dragged in still counts as the inner).
    let inner = null, bestArea = 0;
    for (const l of layers) {
      if (l.id === f.id || l.type === 'fanout') continue;
      const lt = layerTypes[l.type] || { w: 140, h: 70 };
      const lx0 = l.x - lt.w / 2, lx1 = l.x + lt.w / 2;
      const ly0 = l.y - lt.h / 2, ly1 = l.y + lt.h / 2;
      const ox = Math.min(fx1, lx1) - Math.max(fx0, lx0);
      const oy = Math.min(fy1, ly1) - Math.max(fy0, ly0);
      if (ox <= 0 || oy <= 0) continue;
      const area = ox * oy;
      const centreIn = l.x >= fx0 && l.x <= fx1 && l.y >= fy0 && l.y <= fy1;
      // centre-inside always wins over a mere edge clip
      const score = centreIn ? area + 1e9 : area;
      if (score > bestArea) { bestArea = score; inner = l; }
    }
    if (inner) { _fanoutInnerMap.set(f.id, inner); _innerToFanout.set(inner.id, f); }
  }
  // inner box with no real incoming edge → fed by the fanout's input source
  for (const [innerId, f] of _innerToFanout) {
    if ((_connByTo.get(innerId) || []).length > 0) continue;
    const fIn = _connByTo.get(f.id) || [];
    if (fIn.length === 0) continue;
    _connByTo.set(innerId, [{ from: fIn[fIn.length - 1].from, to: innerId, _synthetic: true }]);
  }

  /* Per-layer param count given an explicit input shape (for FANOUT inner). */
  function _inferParams(layer, inShape) {
    if (!inShape || !inShape.length) return 0;
    if (layer.type === 'linear') {
      const units = resolveVal(layer.units || 128);
      const inF   = inShape[inShape.length - 1] || 1;
      return inF * units + (layer.bias !== false ? units : 0);
    }
    if (layer.type === 'conv') {
      const oc = resolveVal(layer.out_channels || 16);
      const gr = resolveVal(layer.groups || 1);
      const ndim = layer.ndim !== undefined ? layer.ndim : 2;
      const cIn = inShape[inShape.length - (ndim + 1)] || 1;
      const rawKs = layer.kernel_size !== undefined ? layer.kernel_size : 3;
      const ksArr = Array.isArray(rawKs) ? rawKs.map(v => resolveVal(v)) : Array(ndim).fill(resolveVal(rawKs));
      const ksP = ksArr.reduce((a, b) => a * b, 1);
      return oc * (cIn / gr) * ksP + oc;
    }
    if (layer.type === 'layernorm' && layer.elementwise_affine !== false) {
      const rawNS = layer.normalized_shape;
      const ns = rawNS !== undefined
        ? (Array.isArray(rawNS) ? rawNS.map(v => resolveVal(v)).reduce((a, b) => a * b, 1) : resolveVal(rawNS))
        : (inShape[inShape.length - 1] || 1);
      return 2 * ns;
    }
    if (layer.type === 'rmsnorm' && layer.elementwise_affine !== false) {
      const rawNS = layer.normalized_shape;
      const ns = rawNS !== undefined
        ? (Array.isArray(rawNS) ? rawNS.map(v => resolveVal(v)).reduce((a, b) => a * b, 1) : resolveVal(rawNS))
        : (inShape[inShape.length - 1] || 1);
      return ns;
    }
    return 0;
  }

  function resolveShape(layerId) {
    if (shapeCache[layerId] !== undefined) return shapeCache[layerId];
    const layer = _layerById.get(layerId);
    if (!layer) return null;

    /* INPUT: shape = [B, ...dims] — batch size B always prepended as dim 0 */
    if (layer.type === 'input') {
      const batchSize = resolveVal('BATCH');
      shapeCache[layerId] = [batchSize, ...(layer.dims ? layer.dims.map(resolveVal) : [1])];
      return shapeCache[layerId];
    }

    /* TRIU: torch.triu(torch.ones(*dims), diagonal). Source node — own dims
       (no batch prepended; it's a mask/constant). bool flag = dtype only. */
    if (layer.type === 'triu') {
      const dd = (layer.dims && layer.dims.length) ? layer.dims.map(resolveVal) : [1, 1];
      shapeCache[layerId] = dd;
      return shapeCache[layerId];
    }

    /* MASKED_FILL: scores.masked_fill(mask, value). Input 0 = scores (shape
       kept), input 1 = mask (broadcast). Output = scores shape. */
    if (layer.type === 'maskedfill') {
      const inc = (_connByTo.get(layerId) || []);
      if (inc.length === 0) { shapeCache[layerId] = null; return null; }
      const sc = resolveShape(inc[0].from);
      shapeCache[layerId] = sc ? [...sc] : null;
      return shapeCache[layerId];
    }

    /* FLATTEN: PyTorch nn.Flatten semantics — default start_dim=1 preserves batch at dim 0.
       end_dim=-1 → flatten all dims from start_dim onward */
    if (layer.type === 'flatten') {
      const incoming = (_connByTo.get(layerId) || []);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      if (!srcShape) { shapeCache[layerId] = null; return null; }
      const n  = srcShape.length;
      if (n <= 1) { shapeCache[layerId] = [...srcShape]; return shapeCache[layerId]; } // only batch dim — nothing to flatten
      const sd = layer.start_dim !== undefined ? layer.start_dim : 1; // default 1: preserve batch dim 0
      const ed = layer.end_dim   !== undefined ? layer.end_dim   : -1;
      const s  = Math.max(1, Math.min(sd < 0 ? n + sd : sd, n - 1)); // never flatten batch (dim 0)
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
      const incoming = (_connByTo.get(layerId) || []);
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
      const incoming = (_connByTo.get(layerId) || []);
      if (incoming.length === 0) { shapeCache[layerId] = [units]; return shapeCache[layerId]; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      if (!srcShape || srcShape.length === 0) { shapeCache[layerId] = [units]; return shapeCache[layerId]; }
      shapeCache[layerId] = [...srcShape.slice(0, -1), units]; // preserve leading dims
      return shapeCache[layerId];
    }

    /* MEAN: torch.mean semantics */
    if (layer.type === 'mean') {
      const incoming = (_connByTo.get(layerId) || []);
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
      const incoming = (_connByTo.get(layerId) || []);
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
      const incoming = (_connByTo.get(layerId) || []);
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
      const incoming = (_connByTo.get(layerId) || []);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      shapeCache[layerId] = srcShape ? [...srcShape] : null;
      return shapeCache[layerId];
    }

    /* ADD: torch.add — element-wise sum of all inputs, shape passthrough.
       All inputs must have identical shapes (PyTorch broadcasting not modelled here). */
    if (layer.type === 'add') {
      const incoming = (_connByTo.get(layerId) || []);
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

    /* BMM: torch.bmm / torch.matmul — batch matrix multiply
       Two inputs required: A (..., n, m) and B (..., m, p) → (..., n, p)
       Last dim of A must equal second-to-last dim of B. */
    if (layer.type === 'matmul') {
      const incoming = (_connByTo.get(layerId) || []);
      if (incoming.length < 2) { shapeCache[layerId] = null; return null; }
      const shapeA = resolveShape(incoming[0].from);
      const shapeB = resolveShape(incoming[1].from);
      if (!shapeA || !shapeB || shapeA.length < 2 || shapeB.length < 2) { shapeCache[layerId] = null; return null; }
      const n = shapeA[shapeA.length - 2];
      const m = shapeA[shapeA.length - 1];
      const m2 = shapeB[shapeB.length - 2];
      const p  = shapeB[shapeB.length - 1];
      if (m !== m2) { shapeCache[layerId] = null; return null; } // inner dims mismatch
      // batch dims: broadcast leading dims
      const batchA = shapeA.slice(0, -2);
      const batchB = shapeB.slice(0, -2);
      const maxBatch = Math.max(batchA.length, batchB.length);
      const padA = [...Array(maxBatch - batchA.length).fill(1), ...batchA];
      const padB = [...Array(maxBatch - batchB.length).fill(1), ...batchB];
      const batchOut = [];
      let ok = true;
      for (let i = 0; i < maxBatch; i++) {
        const da = padA[i], db = padB[i];
        if (da !== 1 && db !== 1 && da !== db) { ok = false; break; }
        batchOut.push(Math.max(da, db));
      }
      if (!ok) { shapeCache[layerId] = null; return null; }
      shapeCache[layerId] = [...batchOut, n, p];
      return shapeCache[layerId];
    }

    /* SCALE: element-wise scalar multiply/divide — shape pass-through */
    if (layer.type === 'scale') {
      const incoming = (_connByTo.get(layerId) || []);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[0].from);
      shapeCache[layerId] = srcShape;
      return srcShape;
    }

    /* TRANSPOSE: torch.transpose(input, dim0, dim1) — swap two dims */
    if (layer.type === 'transpose') {
      const incoming = (_connByTo.get(layerId) || []);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[0].from);
      if (!srcShape) { shapeCache[layerId] = null; return null; }
      const n  = srcShape.length;
      let d0 = layer.dim0 !== undefined ? Number(layer.dim0) : 0;
      let d1 = layer.dim1 !== undefined ? Number(layer.dim1) : 1;
      if (d0 < 0) d0 = n + d0;
      if (d1 < 0) d1 = n + d1;
      if (d0 < 0 || d0 >= n || d1 < 0 || d1 >= n) { shapeCache[layerId] = null; return null; }
      const out = [...srcShape];
      [out[d0], out[d1]] = [out[d1], out[d0]];
      shapeCache[layerId] = out;
      return shapeCache[layerId];
    }

    /* LAYERNORM: nn.LayerNorm — normalizes over last N dims, shape is pass-through */
    if (layer.type === 'layernorm') {
      const incoming = (_connByTo.get(layerId) || []);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      shapeCache[layerId] = srcShape ? [...srcShape] : null;
      return shapeCache[layerId];
    }

    /* RMSNORM: torch.nn.RMSNorm — normalizes each vector by its RMS, shape passthrough */
    if (layer.type === 'rmsnorm') {
      const incoming = (_connByTo.get(layerId) || []);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const srcShape = resolveShape(incoming[incoming.length - 1].from);
      shapeCache[layerId] = srcShape ? [...srcShape] : null;
      return shapeCache[layerId];
    }

    /* CONCAT: torch.cat — join N inputs along `dim`. All inputs must share
       ndim and match on every dim except `dim`; that dim sums. */
    /* FANOUT: container holding one inner box, simulated ×N, stacked into a
       NEW dim. torch: torch.stack([inner(x) for _ in range(N)], dim=1).
       Inserts N at index 1 (right after batch). Inner [B,…] → [B, N, …]. */
    if (layer.type === 'fanout') {
      const inner = _fanoutInnerMap.get(layerId);
      if (!inner) { shapeCache[layerId] = null; return null; }
      const o = resolveShape(inner.id);
      if (!o || o.length === 0) { shapeCache[layerId] = o || null; return shapeCache[layerId]; }
      const N = Math.max(1, resolveVal(layer.n || 2) | 0);
      const out = [o[0], N, ...o.slice(1)]; // [B, N, ...rest]
      shapeCache[layerId] = out;
      return shapeCache[layerId];
    }

        if (layer.type === 'concat') {
      const incoming = (_connByTo.get(layerId) || []);
      if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
      const shapes = incoming.map(c => resolveShape(c.from)).filter(Boolean);
      if (shapes.length === 0) { shapeCache[layerId] = null; return null; }
      const nd = shapes[0].length;
      if (!shapes.every(sh => sh.length === nd)) { shapeCache[layerId] = null; return null; }
      let d = layer.dim !== undefined ? resolveVal(layer.dim) : -1; // torch: join on feature dim, never batch
      if (d < 0) d = nd + d;
      if (d < 0 || d >= nd) { shapeCache[layerId] = null; return null; }
      for (let k = 0; k < nd; k++) {
        if (k === d) continue;
        const v0 = shapes[0][k];
        if (!shapes.every(sh => sh[k] === v0)) { shapeCache[layerId] = null; return null; }
      }
      const out = [...shapes[0]];
      out[d] = shapes.reduce((a, sh) => a + sh[d], 0);
      shapeCache[layerId] = out;
      return shapeCache[layerId];
    }

    /* CUSTOM: composite box — shape & params from embedded subnet */
    if (layer.type === 'custom') {
      const incoming = (_connByTo.get(layerId) || []);
      const srcShape = incoming.length ? resolveShape(incoming[incoming.length - 1].from) : null;
      if (layer.subnet && typeof subnetEval === 'function') {
        const r = subnetEval(layer.subnet, srcShape, layer.varOverrides);
        layer._customParams = r.params || 0;
        layer._customErr    = r.error || null;
        shapeCache[layerId] = r.outShape || null;
        return shapeCache[layerId];
      }
      shapeCache[layerId] = null; return null;
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
  // FANOUT owns its inner box's params exclusively (counted ×N in the
  // post-pass). Exclude inner boxes from per-connection and custom passes.
  const _fanoutInnerIds = new Set([..._fanoutInnerMap.values()].map(x => x.id));
  for (const c of connections) {
    const toLayer   = _layerById.get(c.to);
    const fromShape = shapeCache[c.from];
    if (!toLayer || !fromShape) { c.paramCount = 0; c.paramLabel = ''; c.paramLabelTop = ''; continue; }
    if (_fanoutInnerIds.has(c.to)) { c.paramCount = 0; c.paramLabel = ''; c.paramLabelTop = ''; continue; }
    if (toLayer.type === 'linear') {
      const units       = resolveVal(toLayer.units || 128);
      const inFeatures  = fromShape[fromShape.length - 1] || 1; // last dim = in_features
      const allIncoming = (_connByTo.get(toLayer.id) || []);
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
      const allIncoming = (_connByTo.get(toLayer.id) || []);
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
    } else if (toLayer.type === 'layernorm' && toLayer.elementwise_affine !== false) {
      const allIncoming = (_connByTo.get(toLayer.id) || []);
      const isFirst = allIncoming[0] === c;
      if (isFirst) {
        // normalized_shape: user-set or infer from last dim of incoming shape
        const rawNS  = toLayer.normalized_shape;
        const ns     = rawNS !== undefined
          ? (Array.isArray(rawNS) ? rawNS.map(v => resolveVal(v)).reduce((a, b) => a * b, 1) : resolveVal(rawNS))
          : (fromShape[fromShape.length - 1] || 1);
        c.paramCount    = 2 * ns;
        c.paramLabel    = `γ[${ns}]  β[${ns}]`;
        c.paramLabelTop = `2×${ns}=${(2 * ns).toLocaleString()}`;
        totalParams    += c.paramCount;
      } else { c.paramCount = 0; c.paramLabel = 'shared LN'; c.paramLabelTop = ''; }
    } else if (toLayer.type === 'rmsnorm' && toLayer.elementwise_affine !== false) {
      const allIncoming = (_connByTo.get(toLayer.id) || []);
      const isFirst = allIncoming[0] === c;
      if (isFirst) {
        const rawNS = toLayer.normalized_shape;
        const ns    = rawNS !== undefined
          ? (Array.isArray(rawNS) ? rawNS.map(v => resolveVal(v)).reduce((a, b) => a * b, 1) : resolveVal(rawNS))
          : (fromShape[fromShape.length - 1] || 1);
        c.paramCount    = ns;   // only weight, no bias
        c.paramLabel    = `w[${ns}]`;
        c.paramLabelTop = `${ns.toLocaleString()}`;
        totalParams    += c.paramCount;
      } else { c.paramCount = 0; c.paramLabel = 'shared RMS'; c.paramLabelTop = ''; }
    } else {
      c.paramCount = 0; c.paramLabel = ''; c.paramLabelTop = '';
    }
  }
  for (const l of layers) {
    if (l.type === 'custom' && !_fanoutInnerIds.has(l.id) && typeof l._customParams === 'number') totalParams += l._customParams;
  }
  for (const l of layers) {
    if (l.type !== 'fanout') { continue; }
    const inner = _fanoutInnerMap.get(l.id);
    if (!inner) { l._fanoutParams = 0; l._fanoutInnerType = null; continue; }
    const N   = Math.max(1, resolveVal(l.n || 2) | 0);
    const syn = _connByTo.get(inner.id) || [];
    const inShape = syn.length ? shapeCache[syn[syn.length - 1].from] : null;
    let per = _inferParams(inner, inShape);
    if (per === 0 && inner.type === 'custom' && typeof inner._customParams === 'number') per = inner._customParams;
    const indep = l.independent !== false; // default: distinct params per replica
    l._fanoutParams    = per * (indep ? N : 1); // shared → counted once
    l._fanoutInnerType = inner.type;
    l._fanoutIndep     = indep;
    totalParams += l._fanoutParams;
  }
  window._totalParams = totalParams;
}
