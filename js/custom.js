/* ============================================================
   custom.js — Custom composite boxes loaded from .nnb files

   A custom box embeds a whole sub-network (its own layers /
   connections / variables). Shape + parameter propagation runs
   a self-contained evaluator over the subnet (faithful port of
   shapes.js formulas) so the box outputs exactly per its
   internal architecture and its params are counted from it.

   .nnb requirements:
     - exactly ONE input box
     - exactly ONE "terminal" output box (an output node with NO
       outgoing connection) — mandatory
     - extra output boxes are allowed ONLY if they have an
       outgoing connection (internal pass-through)
   ============================================================ */

let customLibrary = []; // [{ name, subnet:{layers,connections,variables} }]

function _loadCustomLibrary() {
  try {
    const raw = localStorage.getItem('nnb_custom_lib');
    if (raw) customLibrary = JSON.parse(raw) || [];
  } catch (_e) { customLibrary = []; }
}
function _saveCustomLibrary() {
  try { localStorage.setItem('nnb_custom_lib', JSON.stringify(customLibrary)); } catch (_e) {}
}

function validateSubnet(data) {
  if (!data || !Array.isArray(data.layers) || !Array.isArray(data.connections))
    return { ok: false, error: 'Not a valid .nnb (missing layers/connections)' };
  const inputs  = data.layers.filter(l => l.type === 'input');
  const outputs = data.layers.filter(l => l.type === 'output');
  if (inputs.length !== 1)
    return { ok: false, error: 'Need exactly 1 input box (found ' + inputs.length + ')' };
  if (outputs.length === 0)
    return { ok: false, error: 'Need at least 1 output box' };
  const hasOut = id => data.connections.some(c => c.from === id);
  const terminals = outputs.filter(o => !hasOut(o.id));
  if (terminals.length !== 1)
    return { ok: false, error: 'Need exactly 1 terminal output (output with no outgoing connection); found ' + terminals.length };
  return { ok: true, inputId: inputs[0].id, terminalId: terminals[0].id };
}

function _scopeResolve(scopeMap, v, depth) {
  depth = depth || 0;
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).trim();
  if (s === '') return 1;
  if (/^-?\d+$/.test(s)) return Math.max(1, parseInt(s, 10));
  if (depth > 12) return 1;
  if (scopeMap.has(s)) return _scopeResolve(scopeMap, scopeMap.get(s), depth + 1);
  try {
    const ctx = Object.assign({}, typeof _MATH_CTX !== 'undefined' ? _MATH_CTX : Math);
    scopeMap.forEach((val, k) => { ctx[k] = _scopeResolve(scopeMap, val, depth + 1); });
    const fn = new Function(...Object.keys(ctx), '"use strict"; return (' + s + ');');
    const r = fn(...Object.values(ctx));
    return (typeof r === 'number' && isFinite(r)) ? Math.max(1, Math.round(r)) : 1;
  } catch (_e) { return 1; }
}

function _buildScope(subnet, varOverrides, extBatch) {
  const m = new Map();
  (subnet.variables || []).forEach(v => {
    if (!v || !v.name) return;
    const raw = (v.formula && String(v.formula).trim()) ? v.formula : v.value;
    m.set(v.name, raw == null ? '1' : raw);
  });
  // Auto-pick: when a subnet var name matches a GLOBAL variable, follow the
  // global's current value (re-read every eval, so changes propagate live).
  if (typeof variables !== 'undefined' && Array.isArray(variables)
      && typeof resolveVal === 'function') {
    for (const gv of variables) {
      if (!gv || !gv.name || !m.has(gv.name) || gv._batch) continue;
      m.set(gv.name, resolveVal(gv.name)); // concrete number from global scope
    }
  }
  // Explicit per-instance overrides win over both subnet defaults and globals.
  if (varOverrides) for (const k in varOverrides) {
    if (varOverrides[k] !== undefined && varOverrides[k] !== '') m.set(k, varOverrides[k]);
  }
  m.set('BATCH', extBatch != null ? extBatch : (m.get('BATCH') || 32));
  return m;
}

function subnetEval(subnet, extInShape, varOverrides, depth) {
  depth = depth || 0;
  if (depth > 8) return { outShape: null, params: 0, error: 'nested too deep' };
  const v = validateSubnet(subnet);
  if (!v.ok) return { outShape: null, params: 0, error: v.error };

  const extBatch = (extInShape && extInShape.length) ? extInShape[0] : 32;
  const scope = _buildScope(subnet, varOverrides, extBatch);
  const rv = x => _scopeResolve(scope, x, 0);

  const byId = new Map();
  for (const l of subnet.layers) byId.set(l.id, l);
  const byTo = new Map();
  for (const c of subnet.connections) {
    if (!byTo.has(c.to)) byTo.set(c.to, []);
    byTo.get(c.to).push(c);
  }
  const cache = {};
  const inc = id => byTo.get(id) || [];

  function rs(id, stack) {
    if (id in cache) return cache[id];
    if (stack.has(id)) { cache[id] = null; return null; }
    stack.add(id);
    const layer = byId.get(id);
    let out = null;
    if (!layer) { stack.delete(id); cache[id] = null; return null; }
    const T = layer.type;

    if (T === 'input') {
      out = extInShape ? [...extInShape] : null;
    } else if (T === 'custom') {
      const i = inc(id);
      const src = i.length ? rs(i[i.length - 1].from, stack) : null;
      const sub = layer.subnet ? subnetEval(layer.subnet, src, layer.varOverrides, depth + 1) : null;
      out = sub ? sub.outShape : null;
    } else if (T === 'linear') {
      const units = rv(layer.units || 128);
      const i = inc(id);
      const src = i.length ? rs(i[i.length - 1].from, stack) : null;
      out = (src && src.length) ? [...src.slice(0, -1), units] : [units];
    } else if (T === 'conv') {
      const oc = rv(layer.out_channels || 16), gr = rv(layer.groups || 1);
      const ndim = layer.ndim !== undefined ? layer.ndim : 2;
      const i = inc(id);
      const src = i.length ? rs(i[i.length - 1].from, stack) : null;
      if (!src || !src.length) out = [oc];
      else {
        const sp = ndim + 1;
        let p = [...src];
        while (p.length < sp) p.unshift(1);
        const n = p.length, cIn = p[n - sp];
        const spatialIn = p.slice(n - sp + 1, n);
        const lead = n > sp ? p.slice(0, n - sp) : [];
        if (cIn % gr !== 0) out = [oc];
        else {
          const rk = layer.kernel_size !== undefined ? layer.kernel_size : 3;
          const rsd = layer.stride !== undefined ? layer.stride : 1;
          const rp = layer.padding !== undefined ? layer.padding : 0;
          const rd = layer.dilation !== undefined ? layer.dilation : 1;
          const ks = Array.isArray(rk) ? rk.map(rv) : Array(ndim).fill(rv(rk));
          const st = Array.isArray(rsd) ? rsd.map(rv) : Array(ndim).fill(rv(rsd));
          const pd = Array.isArray(rp) ? rp.map(rv) : Array(ndim).fill(rv(rp));
          const dl = Array.isArray(rd) ? rd.map(rv) : Array(ndim).fill(rv(rd));
          const so = spatialIn.map((s, k) => Math.floor((s + 2 * pd[k] - dl[k] * (ks[k] - 1) - 1) / st[k] + 1));
          out = [...lead, oc, ...so];
        }
      }
    } else if (T === 'mean') {
      const i = inc(id);
      const src = i.length ? rs(i[i.length - 1].from, stack) : null;
      if (!src || !src.length) out = null;
      else {
        const rd = layer.reduce_dim !== undefined ? layer.reduce_dim : 0;
        const da = Array.isArray(rd) ? rd : [rd];
        const n = src.length;
        const nd = new Set(da.map(d => d < 0 ? n + d : d));
        const keep = !!layer.keepdim;
        const o = [];
        for (let k = 0; k < n; k++) { if (nd.has(k)) { if (keep) o.push(1); } else o.push(src[k]); }
        out = o.length ? o : [1];
      }
    } else if (T === 'flatten') {
      const i = inc(id);
      const src = i.length ? rs(i[i.length - 1].from, stack) : null;
      if (!src) out = null;
      else {
        const n = src.length;
        const sd = layer.start_dim !== undefined ? layer.start_dim : 1;
        const ed = layer.end_dim !== undefined ? layer.end_dim : -1;
        const s = Math.max(0, Math.min(sd < 0 ? n + sd : sd, n - 1));
        const e = Math.max(s, Math.min(ed < 0 ? n + ed : ed, n - 1));
        const fp = src.slice(s, e + 1).reduce((a, b) => a * b, 1);
        out = [...src.slice(0, s), fp, ...src.slice(e + 1)];
      }
    } else if (T === 'unsqueeze') {
      const i = inc(id);
      const src = i.length ? rs(i[i.length - 1].from, stack) : null;
      if (!src) out = null;
      else {
        const nd = src.length;
        const d = layer.dim !== undefined ? rv(layer.dim) : 0;
        const ad = d < 0 ? nd + 1 + d : d;
        out = [...src]; out.splice(Math.max(0, Math.min(ad, nd)), 0, 1);
      }
    } else if (T === 'squeeze') {
      const i = inc(id);
      const src = i.length ? rs(i[i.length - 1].from, stack) : null;
      if (!src) out = null;
      else {
        const raw = (layer.dim !== undefined && layer.dim !== null && layer.dim !== '') ? rv(layer.dim) : null;
        if (raw == null) { out = src.filter(d => d !== 1); if (!out.length) out = [1]; }
        else {
          const n = src.length, d = raw < 0 ? n + raw : raw;
          out = [...src];
          if (d >= 0 && d < n && src[d] === 1) out.splice(d, 1);
          if (!out.length) out = [1];
        }
      }
    } else if (T === 'softmax' || T === 'scale' || T === 'layernorm' || T === 'rmsnorm' || T === 'output') {
      const i = inc(id);
      const src = i.length ? rs(i[i.length - 1].from, stack) : null;
      out = src ? [...src] : null;
    } else if (T === 'concat') {
      const i = inc(id);
      const shapes = i.map(c => rs(c.from, stack)).filter(Boolean);
      if (!shapes.length) out = null;
      else {
        const nd = shapes[0].length;
        if (!shapes.every(sh => sh.length === nd)) out = null;
        else {
          let d = layer.dim !== undefined ? rv(layer.dim) : -1;
          if (d < 0) d = nd + d;
          if (d < 0 || d >= nd) out = null;
          else {
            let ok = true;
            for (let k = 0; k < nd && ok; k++) {
              if (k === d) continue;
              const v0 = shapes[0][k];
              if (!shapes.every(sh => sh[k] === v0)) ok = false;
            }
            if (!ok) out = null;
            else { out = [...shapes[0]]; out[d] = shapes.reduce((a, sh) => a + sh[d], 0); }
          }
        }
      }
    } else if (T === 'fanout') {
      // FANOUT container: holds one inner box (geometry), simulated xN.
      // Inside a custom subnet we approximate the fanout's *single-replica*
      // output as its input shape passthrough. NOTE: if a shape-changing box
      // (linear/conv) is placed inside a fanout that itself lives inside a
      // custom subnet, this is approximate — the main-canvas engine handles
      // the exact case. Subnet+fanout nesting is an edge case.
      const i = inc(id);
      out = i.length ? rs(i[i.length - 1].from, stack) : null;
      if (out) out = [...out];
    } else if (T === 'add') {
      const i = inc(id);
      const shapes = i.map(c => rs(c.from, stack)).filter(Boolean);
      if (!shapes.length) out = null;
      else {
        const mx = Math.max(...shapes.map(s => s.length));
        const pad = shapes.map(s => [...Array(mx - s.length).fill(1), ...s]);
        const o = []; let ok = true;
        for (let k = 0; k < mx; k++) {
          const ds = pad.map(s => s[k]); const no = ds.filter(d => d !== 1);
          if (no.length && !no.every(d => d === no[0])) { ok = false; break; }
          o.push(no.length ? no[0] : 1);
        }
        out = ok ? o : null;
      }
    } else if (T === 'matmul') {
      const i = inc(id);
      if (i.length < 2) out = null;
      else {
        const A = rs(i[0].from, stack), B = rs(i[1].from, stack);
        if (!A || !B || A.length < 2 || B.length < 2) out = null;
        else {
          const n = A[A.length - 2], m = A[A.length - 1];
          const m2 = B[B.length - 2], p = B[B.length - 1];
          if (m !== m2) out = null;
          else {
            const ba = A.slice(0, -2), bb = B.slice(0, -2);
            const mb = Math.max(ba.length, bb.length);
            const pa = [...Array(mb - ba.length).fill(1), ...ba];
            const pb = [...Array(mb - bb.length).fill(1), ...bb];
            const bo = []; let ok = true;
            for (let k = 0; k < mb; k++) {
              const da = pa[k], db = pb[k];
              if (da !== 1 && db !== 1 && da !== db) { ok = false; break; }
              bo.push(Math.max(da, db));
            }
            out = ok ? [...bo, n, p] : null;
          }
        }
      }
    } else if (T === 'transpose') {
      const i = inc(id);
      const src = i.length ? rs(i[0].from, stack) : null;
      if (!src) out = null;
      else {
        const n = src.length;
        let d0 = layer.dim0 !== undefined ? Number(layer.dim0) : 0;
        let d1 = layer.dim1 !== undefined ? Number(layer.dim1) : 1;
        if (d0 < 0) d0 = n + d0; if (d1 < 0) d1 = n + d1;
        if (d0 < 0 || d0 >= n || d1 < 0 || d1 >= n) out = null;
        else { out = [...src]; const t = out[d0]; out[d0] = out[d1]; out[d1] = t; }
      }
    } else {
      const i = inc(id);
      const src = i.length ? rs(i[i.length - 1].from, stack) : null;
      out = src ? [...src] : null;
    }

    stack.delete(id);
    cache[id] = out;
    return out;
  }

  const outShape = rs(v.terminalId, new Set());

  let params = 0;
  const weightOwner = new Map();
  for (const c of subnet.connections) {
    const to = byId.get(c.to);
    const fromShape = cache[c.from] !== undefined ? cache[c.from] : rs(c.from, new Set());
    if (!to || !fromShape) continue;
    if (!weightOwner.has(c.to)) weightOwner.set(c.to, c);
    if (weightOwner.get(c.to) !== c) continue;
    if (to.type === 'linear') {
      const units = rv(to.units || 128);
      const inF = fromShape[fromShape.length - 1] || 1;
      const bias = to.bias !== false ? units : 0;
      params += inF * units + bias;
    } else if (to.type === 'conv') {
      const oc = rv(to.out_channels || 16), gr = rv(to.groups || 1);
      const ndim = to.ndim !== undefined ? to.ndim : 2;
      const sp = ndim + 1;
      const cIn = fromShape[fromShape.length - sp] || 1;
      const rk = to.kernel_size !== undefined ? to.kernel_size : 3;
      const ks = Array.isArray(rk) ? rk.map(rv) : Array(ndim).fill(rv(rk));
      const kp = ks.reduce((a, b) => a * b, 1);
      params += oc * (cIn / gr) * kp + oc;
    } else if (to.type === 'layernorm' && to.elementwise_affine !== false) {
      const rn = to.normalized_shape;
      const ns = rn !== undefined
        ? (Array.isArray(rn) ? rn.map(rv).reduce((a, b) => a * b, 1) : rv(rn))
        : (fromShape[fromShape.length - 1] || 1);
      params += 2 * ns;
    } else if (to.type === 'rmsnorm' && to.elementwise_affine !== false) {
      const rn = to.normalized_shape;
      const ns = rn !== undefined
        ? (Array.isArray(rn) ? rn.map(rv).reduce((a, b) => a * b, 1) : rv(rn))
        : (fromShape[fromShape.length - 1] || 1);
      params += ns;
    } else if (to.type === 'custom' && to.subnet) {
      const i = inc(to.id);
      const src = i.length ? cache[i[i.length - 1].from] : null;
      const sub = subnetEval(to.subnet, src, to.varOverrides, depth + 1);
      params += sub.params || 0;
    }
  }

  return { outShape: outShape || null, params, error: null };
}

/* Symbolic shape: like subnetEval but keeps variable-name tokens on dims
   the user named (input dims, linear units, conv out_channels, equal
   concat -> "N×name"). Arithmetic ops resolve to numbers only where a
   number is unavoidable (mirrors utils.js getDisplayShape behaviour). */
function subnetDisplay(subnet, extDispShape, varOverrides, depth) {
  depth = depth || 0;
  if (depth > 8) return null;
  const vd = validateSubnet(subnet);
  if (!vd.ok) return null;
  const extB = (extDispShape && extDispShape.length) ? extDispShape[0] : 32;
  const scope = _buildScope(subnet, varOverrides,
    (typeof extB === 'number') ? extB : 32);
  const rv = x => _scopeResolve(scope, x, 0);          // -> number
  const N  = v => (typeof v === 'number') ? v : rv(v); // dim token -> number
  const tok = x => {                                   // keep var name string
    if (typeof x === 'number') return x;
    const str = String(x == null ? '' : x).trim();
    if (/^-?\d+$/.test(str)) return parseInt(str, 10);
    return str || rv(x);
  };
  const byId = new Map(); for (const l of subnet.layers) byId.set(l.id, l);
  const byTo = new Map();
  for (const c of subnet.connections) { if (!byTo.has(c.to)) byTo.set(c.to, []); byTo.get(c.to).push(c); }
  const inc = id => byTo.get(id) || [];
  const cache = {};

  function ds(id, stack) {
    if (id in cache) return cache[id];
    if (stack.has(id)) { cache[id] = null; return null; }
    stack.add(id);
    const L = byId.get(id); let out = null;
    if (L) {
      const T = L.type, i = inc(id);
      const src = i.length ? ds(i[i.length - 1].from, stack) : null;
      if (T === 'input') {
        out = extDispShape ? [...extDispShape] : null;
      } else if (T === 'linear') {
        out = src ? [...src.slice(0, -1), tok(L.units != null ? L.units : 128)]
                  : [tok(L.units != null ? L.units : 128)];
      } else if (T === 'conv') {
        out = src ? [...src.slice(0, -1), tok(L.out_channels != null ? L.out_channels : 16)] : null;
      } else if (T === 'softmax' || T === 'scale' || T === 'layernorm'
              || T === 'rmsnorm' || T === 'output') {
        out = src ? [...src] : null;
      } else if (T === 'transpose') {
        if (src) {
          const n = src.length;
          let d0 = L.dim0 !== undefined ? Number(L.dim0) : 0;
          let d1 = L.dim1 !== undefined ? Number(L.dim1) : 1;
          if (d0 < 0) d0 = n + d0; if (d1 < 0) d1 = n + d1;
          out = [...src];
          if (d0 >= 0 && d0 < n && d1 >= 0 && d1 < n) { const t = out[d0]; out[d0] = out[d1]; out[d1] = t; }
        }
      } else if (T === 'unsqueeze') {
        if (src) {
          const nd = src.length;
          let d = L.dim !== undefined ? Number(L.dim) : 0;
          const ad = d < 0 ? nd + 1 + d : d;
          out = [...src]; out.splice(Math.max(0, Math.min(ad, nd)), 0, 1);
        }
      } else if (T === 'squeeze') {
        if (src) {
          const raw = (L.dim !== undefined && L.dim !== null && L.dim !== '') ? Number(L.dim) : null;
          if (raw == null) { out = src.filter(v => N(v) !== 1); if (!out.length) out = [1]; }
          else {
            const n = src.length, d = raw < 0 ? n + raw : raw;
            out = [...src];
            if (d >= 0 && d < n && N(src[d]) === 1) out.splice(d, 1);
            if (!out.length) out = [1];
          }
        }
      } else if (T === 'flatten') {
        if (src) {
          const n = src.length;
          const sd = L.start_dim !== undefined ? L.start_dim : 1;
          const ed = L.end_dim !== undefined ? L.end_dim : -1;
          const a = Math.max(0, Math.min(sd < 0 ? n + sd : sd, n - 1));
          const e = Math.max(a, Math.min(ed < 0 ? n + ed : ed, n - 1));
          const seg = src.slice(a, e + 1);
          const prod = seg.every(v => typeof v === 'number')
            ? seg.reduce((x, y) => x * y, 1)
            : seg.join('*');
          out = [...src.slice(0, a), prod, ...src.slice(e + 1)];
        }
      } else if (T === 'mean') {
        if (src) {
          const rd = L.reduce_dim !== undefined ? L.reduce_dim : 0;
          const da = Array.isArray(rd) ? rd : [rd];
          const n = src.length;
          const nd = new Set(da.map(d => d < 0 ? n + d : d));
          const keep = !!L.keepdim, o = [];
          for (let k = 0; k < n; k++) { if (nd.has(k)) { if (keep) o.push(1); } else o.push(src[k]); }
          out = o.length ? o : [1];
        }
      } else if (T === 'add') {
        const sh = i.map(c => ds(c.from, stack)).filter(Boolean);
        out = sh.length ? [...sh[0]] : null; // broadcast: first input's shape
      } else if (T === 'matmul') {
        const A = i.length ? ds(i[0].from, stack) : null;
        const B = i.length > 1 ? ds(i[1].from, stack) : null;
        if (A && B && A.length >= 2 && B.length >= 2)
          out = [...A.slice(0, -2), A[A.length - 2], B[B.length - 1]];
      } else if (T === 'concat') {
        const sh = i.map(c => ds(c.from, stack)).filter(Boolean);
        if (sh.length) {
          const nd = sh[0].length;
          let d = L.dim !== undefined ? Number(L.dim) : 0;
          if (d < 0) d = nd + d;
          if (sh.every(x => x.length === nd) && d >= 0 && d < nd) {
            out = [...sh[0]];
            const col = sh.map(x => x[d]);
            out[d] = (col.length > 1 && col.every(v => v === col[0])) ? `${col.length}×${col[0]}`
                   : col.every(v => typeof v === 'number') ? col.reduce((a, b) => a + b, 0)
                   : col.join('+');
          }
        }
      } else if (T === 'custom') {
        out = L.subnet ? subnetDisplay(L.subnet, src, L.varOverrides, depth + 1) : null;
      } else if (src) {
        out = [...src];
      }
    }
    stack.delete(id);
    cache[id] = out;
    return out;
  }
  return ds(vd.terminalId, new Set());
}

/* ── Dominant color of a subnet ───────────────────────────────────────────
   1. If subnet has superboxes: color of the largest one (SUPERBOX_COLORS).
   2. Otherwise: color of the most frequent non-structural layer type.      */
function _computeCustomColor(subnet) {
  const sbs = subnet.superboxes || [];
  if (sbs.length > 0) {
    let best = null, bestCnt = -1;
    for (const sb of sbs) {
      const cnt = (sb.layerIds || []).length;
      if (cnt > bestCnt) { bestCnt = cnt; best = sb; }
    }
    if (best !== null && typeof SUPERBOX_COLORS !== 'undefined') {
      return SUPERBOX_COLORS[(best.colorIdx ?? 0) % SUPERBOX_COLORS.length];
    }
  }
  const freq = {};
  for (const l of (subnet.layers || [])) {
    if (l.type === 'input' || l.type === 'output') continue;
    freq[l.type] = (freq[l.type] || 0) + 1;
  }
  let topType = null, topCnt = 0;
  for (const [tp, cnt] of Object.entries(freq)) {
    if (cnt > topCnt) { topCnt = cnt; topType = tp; }
  }
  if (topType && typeof layerTypes !== 'undefined' && layerTypes[topType]) {
    return layerTypes[topType].color;
  }
  return '#ff5fa2'; // fallback
}

function renderCustomPalette() {
  const wrap = document.getElementById('custom-items');
  if (!wrap) return;
  wrap.innerHTML = '';
  customLibrary.forEach((entry, idx) => {
    const item = document.createElement('div');
    item.className = 'palette-item type-custom';
    item.dataset.type = 'custom';
    item.dataset.customIdx = String(idx);
    const nLayers = (entry.subnet.layers || []).length;
    item.innerHTML =
      '<div class="name">' + entry.name + '</div>' +
      '<div class="desc">' + nLayers + ' layers · custom</div>' +
      '<span class="custom-del" title="Remove from palette">×</span>';
    if (entry.color) {
      item.style.borderColor = entry.color + '66';
      const _nameEl = item.querySelector('.name');
      if (_nameEl) _nameEl.style.color = entry.color;
    }
    item.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      if (e.target.classList.contains('custom-del')) {
        customLibrary.splice(idx, 1); _saveCustomLibrary(); renderCustomPalette();
        return;
      }
      paletteDragType = 'custom';
      paletteCustomIdx = idx;
      item.classList.add('dragging');
      ghostEl._paletteSource = item;
    });
    wrap.appendChild(item);
  });
}

function loadCustomNnb() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.nnb,application/json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        (data.layers || []).forEach(l => {
          if (l.type === 'dense') l.type = 'linear';
          if (l.type === 'bmm')   l.type = 'matmul';
        });
        const vd = validateSubnet(data);
        if (!vd.ok) { alert('Invalid custom .nnb: ' + vd.error); return; }
        const name = (file.name || 'custom').replace(/\.nnb$/i, '');
        const subnet = {
          layers:      data.layers || [],
          connections: data.connections || [],
          variables:   data.variables || [],
          superboxes:  data.superboxes || [],
        };
        const color = _computeCustomColor(subnet);
        const existing = customLibrary.findIndex(c => c.name === name);
        if (existing >= 0) customLibrary[existing] = { name, subnet, color };
        else customLibrary.push({ name, subnet, color });
        _saveCustomLibrary();
        renderCustomPalette();
      } catch (err) {
        alert('Failed to load .nnb: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

_loadCustomLibrary();
document.addEventListener('DOMContentLoaded', () => {
  renderCustomPalette();
  const btn = document.getElementById('custom-load-btn');
  if (btn) btn.addEventListener('click', loadCustomNnb);
});
