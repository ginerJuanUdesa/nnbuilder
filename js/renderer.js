/* ============================================================
   renderer.js — all canvas drawing functions
   ============================================================ */

let _sbEyeBtns = []; // [{sbId, cx, cy, r}] rebuilt each frame — read by interactions.js

/* --- Grid (cached offscreen canvas) --- */
function buildGrid() {
  const offscreen = document.createElement('canvas');
  offscreen.width = W; offscreen.height = H;
  const octx = offscreen.getContext('2d');
  const [tlx, tly] = screenToWorld(0, 0);
  const [brx, bry] = screenToWorld(W, H);
  const sGX = Math.floor(tlx / gridSpacing) - 1;
  const eGX = Math.ceil(brx  / gridSpacing) + 1;
  const sGY = Math.floor(tly / gridSpacing) - 1;
  const eGY = Math.ceil(bry  / gridSpacing) + 1;
  const white = document.body.classList.contains('white-mode');

  // Single uniform color, single pass — no major/minor distinction, no dots
  const lineColor = white ? 'rgba(60, 120, 200, 0.35)' : 'rgba(80, 160, 255, 0.26)';
  octx.strokeStyle = lineColor; octx.lineWidth = 0.5;
  octx.beginPath();
  for (let gx = sGX; gx <= eGX; gx++) { const [sx] = worldToScreen(gx * gridSpacing, 0); octx.moveTo(sx, 0); octx.lineTo(sx, H); }
  for (let gy = sGY; gy <= eGY; gy++) { const [, sy] = worldToScreen(0, gy * gridSpacing); octx.moveTo(0, sy); octx.lineTo(W, sy); }
  octx.stroke();

  gridCanvas = offscreen;
  gridDirty  = false;
}

/* --- Connection routing --- */
// A box has 4 connection points: the centres of its left/right/top/bottom
// edges. side ∈ 'l' | 'r' | 't' | 'b'. The chosen side is stored per
// connection (conn.fromSide / conn.toSide); legacy connections fall back to
// output→right, input→left.
function sideCenter(layer, side) {
  const t = layerTypes[layer.type], hw = t.w / 2, hh = t.h / 2;
  if (side === 'l') return { x: layer.x - hw, y: layer.y };
  if (side === 't') return { x: layer.x, y: layer.y - hh };
  if (side === 'b') return { x: layer.x, y: layer.y + hh };
  return { x: layer.x + hw, y: layer.y }; // 'r' (default)
}
// Nearest of the 4 side-centres to a world point.
function nearestSide(layer, wx, wy) {
  let best = 'r', bestD = Infinity;
  for (const sd of ['l', 'r', 't', 'b']) {
    const p = sideCenter(layer, sd);
    const d = (wx - p.x) ** 2 + (wy - p.y) ** 2;
    if (d < bestD) { bestD = d; best = sd; }
  }
  return best;
}
function getPortPos(layer, side)      { return sideCenter(layer, side || 'r'); }
function getInputPortPos(layer, side) { return sideCenter(layer, side || 'l'); }

function buildConnPath(fromLayer, toLayer, conn) {
  const out = getPortPos(fromLayer, conn && conn.fromSide);
  const inp = getInputPortPos(toLayer, conn && conn.toSide);
  const [sx1, sy1] = worldToScreen(out.x, out.y);
  const [sx2, sy2] = worldToScreen(inp.x, inp.y);

  // Single elbow (user-placeable via conn.elbowX).
  const midX = (conn && conn.elbowX !== undefined)
    ? (conn.elbowX - camX) * zoom + W / 2   // absolute world X → screen
    : (sx1 + sx2) / 2;                      // auto midpoint
  return [{ x: sx1, y: sy1 }, { x: midX, y: sy1 }, { x: midX, y: sy2 }, { x: sx2, y: sy2 }];
}

function buildConnPreview(fromLayer, mouseSx, mouseSy, side) {
  const out = getPortPos(fromLayer, side);
  const [sx1, sy1] = worldToScreen(out.x, out.y);
  const midX = (sx1 + mouseSx) / 2;
  return [{ x: sx1, y: sy1 }, { x: midX, y: sy1 }, { x: midX, y: mouseSy }, { x: mouseSx, y: mouseSy }];
}

/* Connection gradient: red at the OUTPUT end (from), green at the INPUT end
   (to), white (dark-gray in light mode) through the middle. */
function connGradient(pts, white) {
  const a    = white ? 0.7 : 0.9;
  const p0   = pts[0], p1 = pts[pts.length - 1];
  const g    = nodeCtx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
  const base = white ? `rgba(70, 70, 70, ${a})`  : `rgba(255, 255, 255, ${a})`;
  const red  = white ? `rgba(200, 40, 40, ${a})` : `rgba(255, 95, 95, ${a})`;
  const grn  = white ? `rgba(20, 150, 70, ${a})` : `rgba(90, 255, 150, ${a})`;
  g.addColorStop(0.00, red);   // from end = output of source box
  g.addColorStop(0.22, base);
  g.addColorStop(0.78, base);
  g.addColorStop(1.00, grn);   // to end = input of destination box
  return g;
}

function drawPath(pts, color, glow, width, dash) {
  if (pts.length < 2) return;
  nodeCtx.save();
  nodeCtx.setLineDash(dash || []);
  nodeCtx.strokeStyle = color;
  nodeCtx.lineWidth   = width || 2;
  nodeCtx.lineJoin    = 'round';
  nodeCtx.lineCap     = 'round';
  nodeCtx.beginPath();
  nodeCtx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) nodeCtx.lineTo(pts[i].x, pts[i].y);
  nodeCtx.stroke();
  nodeCtx.restore();
  for (let i = 1; i < pts.length - 1; i++) {
    nodeCtx.beginPath();
    nodeCtx.arc(pts[i].x, pts[i].y, 3, 0, Math.PI * 2);
    nodeCtx.fillStyle = color;
    nodeCtx.fill();
  }
}

/* --- Layer box --- */
function drawLayerBox(layer, cx, cy) {
  const t    = layerTypes[layer.type];
  const w    = t.w * zoom, h = t.h * zoom;
  const pulse      = Math.sin(time * 2 + layer.id) * 0.1 + 0.9;
  const isSelected = layer.id === selectedLayerId;
  const alpha      = isSelected ? 1 : pulse;
  const x = cx - w / 2, y = cy - h / 2;
  const white = document.body.classList.contains('white-mode');

  let tColor = white && t.lightColor ? t.lightColor : t.color;
  let fillStyle = t.bg;
  if (white) {
    const bgMap = {
      input:   'rgba(210, 242, 224, 0.97)',
      linear:  'rgba(210, 228, 255, 0.97)',
      flatten: 'rgba(235, 195,  90, 0.97)',
      output:  'rgba(238, 210, 255, 0.97)',
      mean:    'rgba(255, 228, 200, 0.97)',
      conv:    'rgba(200, 238, 244, 0.97)',
      unsqueeze: 'rgba(248, 220, 238, 0.97)',
      squeeze:   'rgba(238, 220, 255, 0.97)',
      softmax:   'rgba(255, 220, 220, 0.97)',
      add:       'rgba(195, 235, 165, 0.97)',
      matmul:    'rgba(255, 235, 200, 0.97)',
      scale:     'rgba(200, 245, 238, 0.97)',
      transpose:  'rgba(225, 215, 255, 0.97)',
      layernorm:  'rgba(210, 245, 230, 0.97)',
      rmsnorm:  'rgba(200, 235, 252, 0.97)',
      custom:   'rgba(255, 210, 230, 0.97)',
      concat:   'rgba(222, 214, 255, 0.97)',
      fanout:   'rgba(245, 210, 255, 0.97)',
    };
    fillStyle = bgMap[layer.type] || fillStyle;
  }
  // Custom box: override tColor + bg from layer.customColor
  if (layer.type === 'custom' && layer.customColor) {
    const _cc = layer.customColor;
    const _cp = _cc.slice(1).match(/.{2}/g).map(x => parseInt(x, 16));
    if (white) {
      // tColor: darken by 62%
      tColor = '#' + _cp.map(c => Math.round(c * 0.62).toString(16).padStart(2, '0')).join('');
      // bg: pastel — mix with white 77/23
      fillStyle = `rgba(${Math.round(255*0.77+_cp[0]*0.23)}, ${Math.round(255*0.77+_cp[1]*0.23)}, ${Math.round(255*0.77+_cp[2]*0.23)}, 0.97)`;
    } else {
      tColor = _cc;
      // bg: 22% of color channels (dark tint)
      fillStyle = `rgba(${Math.round(_cp[0]*0.22)}, ${Math.round(_cp[1]*0.22)}, ${Math.round(_cp[2]*0.22)}, 0.97)`;
    }
  }
  nodeCtx.fillStyle = fillStyle;
  nodeCtx.fillRect(x, y, w, h);

  const borderColor = isSelected
    ? `rgba(${hexToRgb(tColor)}, ${alpha})`
    : white ? `rgba(${hexToRgb(tColor)}, ${alpha * 0.8})` : `rgba(${hexToRgb(tColor)}, ${Math.max(alpha, 0.85)})`;
  nodeCtx.strokeStyle = borderColor;
  nodeCtx.lineWidth   = isSelected ? 2.5 : 1.5;
  nodeCtx.strokeRect(x, y, w, h);

  // corner brackets
  const cs = Math.min(8, w * 0.12);
  nodeCtx.strokeStyle = borderColor; nodeCtx.lineWidth = 2; nodeCtx.beginPath();
  nodeCtx.moveTo(x, y + cs);         nodeCtx.lineTo(x, y);         nodeCtx.lineTo(x + cs, y);
  nodeCtx.moveTo(x + w - cs, y);     nodeCtx.lineTo(x + w, y);     nodeCtx.lineTo(x + w, y + cs);
  nodeCtx.moveTo(x + w, y + h - cs); nodeCtx.lineTo(x + w, y + h); nodeCtx.lineTo(x + w - cs, y + h);
  nodeCtx.moveTo(x + cs, y + h);     nodeCtx.lineTo(x, y + h);     nodeCtx.lineTo(x, y + h - cs);
  nodeCtx.stroke();

  if (zoom > 0.15) {
    const fontSize = Math.max(9, Math.min(14, 14 * zoom));
    nodeCtx.font         = `bold ${fontSize}px Courier New`;
    nodeCtx.fillStyle    = white ? `rgba(${hexToRgb(tColor)}, ${alpha})` : borderColor;
    nodeCtx.textAlign    = 'center';
    nodeCtx.textBaseline = 'middle';
    const baseLabel = layer.type === 'conv'
      ? `CONV${layer.ndim !== undefined ? layer.ndim : 2}D`
      : layer.type === 'custom'
      ? (layer.customName || 'CUSTOM').toUpperCase()
      : layer.type.toUpperCase();
    const label = layer.name ? `${baseLabel}:${layer.name}` : baseLabel;
    const labelFits = nodeCtx.measureText(label).width <= t.w * zoom - 8;
    const displayLabel = labelFits ? label : baseLabel + (layer.name ? ':' + layer.name.slice(0, Math.max(1, Math.floor((t.w * zoom - 8 - nodeCtx.measureText(baseLabel + ':').width) / (nodeCtx.measureText('m').width)))) + '…' : '');
    if (zoom <= 0.4) {
      nodeCtx.fillText(displayLabel, cx, cy);
    }

    if (zoom > 0.4) {
      const subSize    = Math.max(7, 9 * zoom);
      const subFontStr = `${white ? 'bold ' : ''}${subSize}px Courier New`;
      const boxHalfW   = t.w / 2 * zoom - 6;
      const lineHeight = subSize * 1.25;
      const baseY0     = cy + 10 * zoom;

      // Count how many lines text wraps to (cap 4), using current ctx font
      const countLines = (text, maxW) => {
        nodeCtx.font = subFontStr;
        const words = text.split(' ');
        let line = '', count = 1;
        for (const w of words) {
          const test = line ? line + ' ' + w : w;
          if (nodeCtx.measureText(test).width > maxW && line) { count++; line = w; }
          else line = test;
        }
        return Math.min(count, 4);
      };

      // Shift amount: 0 for ≤2 lines, lineHeight/2 per extra line
      const shiftFor = (lc) => Math.max(0, lc - 2) * lineHeight * 0.5;

      // Draw title at adjusted Y (restores font/fillStyle after)
      const drawTitle = (shift) => {
        nodeCtx.font      = `bold ${fontSize}px Courier New`;
        nodeCtx.fillStyle = white ? `rgba(${hexToRgb(tColor)}, ${alpha})` : borderColor;
        nodeCtx.textAlign    = 'center';
        nodeCtx.textBaseline = 'middle';
        nodeCtx.fillText(displayLabel, cx, cy - 6 * zoom - shift);
        nodeCtx.font      = subFontStr;
        nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, ${0.55 * alpha})`;
      };

      if (layer.type === 'input') {
        const dispDims = getDisplayShape(layer.id);
        const text = dispDims && dispDims.length > 0 ? `[${dispDims.join(', ')}]` : '?';
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'linear') {
        const inc      = (_connByTo.get(layer.id) || []);
        const srcDisp  = inc.length > 0 ? getDisplayShape(inc[0].from) : null;
        const inF      = srcDisp ? srcDisp[srcDisp.length - 1] : '?';
        const prefix   = inc.length > 1 ? `${inc.length}× ` : '';
        const actTag   = layer.activation && layer.activation !== 'none' ? ` · ${layer.activation}` : '';
        const text = `${prefix}${inF} → ${layer.units || '?'}${actTag}`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'shared_dense') {
        const inc = (_connByTo.get(layer.id) || []);
        const inF = inc.length > 0 ? getLayerOutputLabel(inc[0].from) : '?';
        const text = `${inc.length}×[${inF}→${layer.units || '?'}]`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'flatten') {
        const outShape = shapeCache[layer.id];
        const sd = layer.start_dim !== undefined ? layer.start_dim : 0;
        const ed = layer.end_dim   !== undefined ? layer.end_dim   : -1;
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const text = dispShape ? `[${dispShape.join(', ')}]` : `${sd} : ${ed}`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'conv') {
        const outShape = shapeCache[layer.id];
        const oc = layer.out_channels || '?';
        const rawKs = layer.kernel_size;
        const ksStr = Array.isArray(rawKs) ? rawKs.join(', ') : (rawKs || '?');
        const ndim = layer.ndim !== undefined ? layer.ndim : 2;
        const convLabel = `conv${ndim}d`;
        const text = outShape ? `${convLabel} c=${oc} k=${ksStr} → [${outShape.join(',')}]` : `${convLabel} c=${oc} k=${ksStr}`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'mean') {
        const outShape = shapeCache[layer.id];
        const dimStr   = Array.isArray(layer.reduce_dim)
          ? layer.reduce_dim.join(',')
          : (layer.reduce_dim !== undefined ? String(layer.reduce_dim) : '0');
        const kdStr    = layer.keepdim ? ' kd' : '';
        const text = outShape ? `dim=${dimStr}${kdStr} → [${outShape.join(', ')}]` : `dim=${dimStr}${kdStr}`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'add') {
        const inc = (_connByTo.get(layer.id) || []);
        const outShape = shapeCache[layer.id];
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const status = inc.length === 0 ? 'no inputs'
          : !outShape ? 'incompatible shapes!'
          : `${inc.length}× [${dispShape ? dispShape.join(', ') : outShape.join(', ')}]`;
        const shift = shiftFor(countLines(status, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.fillStyle = (!outShape && inc.length > 0) ? '#ff4444' : (white ? tColor : `rgba(${hexToRgb(tColor)}, 0.55)`);
        nodeCtx.measureText(status).width > boxHalfW * 2
          ? wrapText(status, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(status, cx, baseY);

      } else if (layer.type === 'softmax') {
        const outShape = shapeCache[layer.id];
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const dim = layer.dim !== undefined ? layer.dim : -1;
        const text = dispShape ? `dim=${dim} → [${dispShape.join(', ')}]` : `dim=${dim}`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'unsqueeze') {
        const outShape = shapeCache[layer.id];
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const dim = layer.dim !== undefined ? layer.dim : 0;
        const text = dispShape ? `dim=${dim} → [${dispShape.join(', ')}]` : `dim=${dim}`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'squeeze') {
        const outShape = shapeCache[layer.id];
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const dimVal = layer.dim !== undefined && layer.dim !== null && layer.dim !== '' ? layer.dim : 'all';
        const text = dispShape ? `dim=${dimVal} → [${dispShape.join(', ')}]` : `dim=${dimVal}`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'matmul') {
        const inc = (_connByTo.get(layer.id) || []);
        const shA = inc.length > 0 ? getDisplayShape(inc[0].from) : null;
        const shB = inc.length > 1 ? getDisplayShape(inc[1].from) : null;
        const fmtS = s => s ? `[${s.join(', ')}]` : '?';
        const compatible = !!shapeCache[layer.id];
        const status = inc.length < 2 ? 'needs 2 inputs'
          : !compatible ? 'inner dim mismatch!'
          : `${fmtS(shA)} @ ${fmtS(shB)}`;
        const shift = shiftFor(countLines(status, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.fillStyle = (!compatible && inc.length >= 2) ? '#ff4444' : (white ? tColor : `rgba(${hexToRgb(tColor)}, 0.55)`);
        nodeCtx.measureText(status).width > boxHalfW * 2
          ? wrapText(status, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(status, cx, baseY);

      } else if (layer.type === 'scale') {
        const op     = layer.op     || '/';
        const factor = layer.factor !== undefined ? String(layer.factor) : '1';
        const sym    = op === '/' ? '÷' : '×';
        drawTitle(0);
        const baseY = baseY0;
        const scaleFontSize = Math.max(11, 16 * zoom);
        nodeCtx.font = `bold ${scaleFontSize}px Courier New`;
        nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, 0.8)`;
        nodeCtx.fillText(`${sym} ${factor}`, cx, baseY);

      } else if (layer.type === 'transpose') {
        const d0  = layer.dim0 !== undefined ? layer.dim0 : 0;
        const d1  = layer.dim1 !== undefined ? layer.dim1 : 1;
        const out = shapeCache[layer.id];
        const text = out ? `[${getDisplayShape(layer.id).join(', ')}]` : `dim ${d0}↔${d1}`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, 0.65)`;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'layernorm') {
        const rawNS = layer.normalized_shape;
        const nsStr = (rawNS !== undefined && rawNS !== '') ? String(rawNS) : 'last dim';
        const text  = `LN(${nsStr})`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, 0.65)`;
        nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'rmsnorm') {
        const rawNS = layer.normalized_shape;
        const nsStr = (rawNS !== undefined && rawNS !== '') ? String(rawNS) : 'last dim';
        const text  = `RMS(${nsStr})`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, 0.65)`;
        nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'concat') {
        const inc = (_connByTo.get(layer.id) || []);
        const out = getDisplayShape(layer.id);
        const dStr = layer.dim !== undefined ? layer.dim : 0;
        const text = out
          ? `cat dim=${dStr} → [${out.join(', ')}]`
          : `cat dim=${dStr} · ${inc.length} in`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, 0.65)`;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'custom') {
        const oShape = getDisplayShape(layer.id);
        const prm    = (typeof layer._customParams === 'number') ? layer._customParams : null;
        const text   = oShape
          ? `[${oShape.join(', ')}]${prm != null ? ' · ' + prm.toLocaleString() + 'p' : ''}`
          : (layer._customErr ? '⚠ ' + layer._customErr : 'custom');
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, 0.65)`;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'fanout') {
        const nOut = (_connByFrom.get(layer.id) || []).length;
        const inShape = getDisplayShape(layer.id);
        const text = inShape ? `[${inShape.join(', ')}] ×${nOut || '?'}` : `×${nOut || '?'} outputs`;
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, 0.65)`;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);
      } else if (layer.type === 'output') {
        const dispShape = getDisplayShape(layer.id);
        const text = dispShape ? `shape: [${dispShape.join(', ')}]` : '[ NO CONNECTION ]';
        const shift = shiftFor(countLines(text, boxHalfW * 2));
        drawTitle(shift);
        const baseY = baseY0 - shift;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);
      }
    }
  }

  // port dots

  /* --- Helper: measure → wrap text to fit box width --- */
  function wrapText(text, x, y, maxW, fontStr) {
    nodeCtx.font = fontStr;
    const lines = [];
    const words = text.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (nodeCtx.measureText(test).width > maxW && line) {
        lines.push(line); line = w;
      } else { line = test; }
    }
    if (line) lines.push(line);
    const lineHeight = (parseFloat(fontStr.replace(/^[a-z]+\s*/i, "")) || parseFloat(fontStr)) * 1.25;
    lines.forEach((l, i) => nodeCtx.fillText(l, x, y + i * lineHeight));
  }

  if (zoom > 0.3) {
    const pr = Math.max(2, 3 * zoom);
    nodeCtx.beginPath(); nodeCtx.arc(x, cy, pr, 0, Math.PI * 2);
    nodeCtx.fillStyle = white ? `rgba(${hexToRgb(tColor)}, ${0.6 * alpha})` : `rgba(${hexToRgb(tColor)}, ${0.7 * alpha})`; nodeCtx.fill();
    if (layer.type !== 'output') {
      nodeCtx.beginPath(); nodeCtx.arc(x + w, cy, pr, 0, Math.PI * 2);
      nodeCtx.fillStyle = white ? `rgba(${hexToRgb(tColor)}, ${0.6 * alpha})` : `rgba(${hexToRgb(tColor)}, ${0.7 * alpha})`; nodeCtx.fill();
    }
  }

  // connection count badges
  if (zoom > 0.25) {
    const inCount   = (_connByTo.get(layer.id) || []).length;
    const outCount  = (_connByFrom.get(layer.id) || []).length;
    const badgeSize = Math.max(8, 12 * zoom);
    const badgeY    = y - badgeSize / 2 - 4;
    if (inCount > 1) {
      nodeCtx.beginPath(); nodeCtx.arc(x - badgeSize - 2, badgeY + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
      nodeCtx.fillStyle = `rgba(${hexToRgb('#ff4444')}, ${0.8 * alpha})`; nodeCtx.fill();
      if (zoom > 0.4) {
        nodeCtx.font = `bold ${Math.max(6, 8 * zoom)}px Courier New`; nodeCtx.fillStyle = white ? '#222' : '#fff';
        nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
        nodeCtx.fillText(inCount, x - badgeSize - 2, badgeY + badgeSize / 2);
      }
    }
    if (outCount > 1 && layer.type !== 'output') {
      nodeCtx.beginPath(); nodeCtx.arc(x + w + badgeSize + 2, badgeY + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
      nodeCtx.fillStyle = `rgba(${hexToRgb('#44ff44')}, ${0.8 * alpha})`; nodeCtx.fill();
      if (zoom > 0.4) {
        nodeCtx.font = `bold ${Math.max(6, 8 * zoom)}px Courier New`; nodeCtx.fillStyle = white ? '#222' : '#fff';
        nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
        nodeCtx.fillText(outCount, x + w + badgeSize + 2, badgeY + badgeSize / 2);
      }
    }
  }
}

/* --- CSV hologram for INPUT layers --- */
function drawCSVHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const cols = 4, dataRows = 3;
  const cellW  = Math.max(28, 44 * zoom), cellH = Math.max(13, 17 * zoom);
  const tableW = cellW * cols, tableH = cellH * (dataRows + 1);
  const boxH   = layerTypes.input.h * zoom;
  const tx     = cx - tableW / 2;
  const ty     = cy - boxH / 2 - tableH - Math.max(8, 14 * zoom);
  const flicker = 0.82 + Math.sin(time * 4.3 + layer.id * 1.7) * 0.09 + Math.sin(time * 11 + layer.id) * 0.04;

  const g = white ? '80, 180, 100' : '0, 255, 136';
  const bg = white ? `rgba(245, 255, 248, ${0.9 * flicker})` : `rgba(0, 18, 12, ${0.82 * flicker})`;
  const hdrBg = white ? `rgba(80, 180, 100, ${0.06 * flicker})` : `rgba(0, 255, 136, ${0.07 * flicker})`;
  const stroke = white ? `rgba(${g}, ${0.45 * flicker})` : `rgba(0, 255, 136, ${0.55 * flicker})`;

  nodeCtx.save(); nodeCtx.shadowColor = white ? '#50b464' : '#00ff88'; nodeCtx.shadowBlur = 10 * zoom * flicker;
  nodeCtx.fillStyle = bg; nodeCtx.fillRect(tx, ty, tableW, tableH);
  nodeCtx.fillStyle = hdrBg; nodeCtx.fillRect(tx, ty, tableW, cellH);
  nodeCtx.strokeStyle = stroke; nodeCtx.lineWidth = 1; nodeCtx.strokeRect(tx, ty, tableW, tableH);
  nodeCtx.restore();

  nodeCtx.strokeStyle = white ? `rgba(${g}, ${0.1 * flicker})` : `rgba(0, 255, 136, ${0.13 * flicker})`; nodeCtx.lineWidth = 0.5;
  for (let r = 1; r <= dataRows; r++) { nodeCtx.beginPath(); nodeCtx.moveTo(tx, ty + cellH * r); nodeCtx.lineTo(tx + tableW, ty + cellH * r); nodeCtx.stroke(); }
  for (let c = 1; c < cols; c++)      { nodeCtx.beginPath(); nodeCtx.moveTo(tx + cellW * c, ty); nodeCtx.lineTo(tx + cellW * c, ty + tableH); nodeCtx.stroke(); }

  const fontSize = Math.max(7, 8.5 * zoom);
  nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
  nodeCtx.font = `bold ${fontSize}px Courier New`;
  for (let c = 0; c < cols; c++) {
    const label = c < cols - 1 ? `f_${c}` : '...';
    nodeCtx.fillStyle = c < cols - 1 ? `rgba(${g}, ${0.85 * flicker})` : `rgba(${g}, ${0.3 * flicker})`;
    nodeCtx.fillText(label, tx + cellW * c + cellW / 2, ty + cellH / 2);
  }
  nodeCtx.font = `${fontSize}px Courier New`;
  for (let r = 0; r < dataRows; r++) {
    const rowFade = (0.55 + (dataRows - r) / dataRows * 0.33) * flicker;
    for (let c = 0; c < cols - 1; c++) {
      const v = (hashF(layer.id * 53 + c * 7, r * 13 + 3) * 2 - 1).toFixed(2);
      nodeCtx.fillStyle = white ? `rgba(0, 140, 200, ${rowFade})` : `rgba(0, 210, 255, ${rowFade})`;
      nodeCtx.fillText(v, tx + cellW * c + cellW / 2, ty + cellH * (r + 1) + cellH / 2);
    }
    nodeCtx.fillStyle = white ? `rgba(${g}, ${0.4 * flicker})` : `rgba(0, 255, 136, ${0.45 * flicker})`;
    nodeCtx.fillText('…', tx + cellW * (cols - 1) + cellW / 2, ty + cellH * (r + 1) + cellH / 2);
  }

  // scanlines
  if (!white) {
    nodeCtx.save(); nodeCtx.globalAlpha = 0.06 * flicker;
    for (let sy2 = ty; sy2 < ty + tableH; sy2 += 3) { nodeCtx.fillStyle = '#000'; nodeCtx.fillRect(tx, sy2, tableW, 1.2); }
    nodeCtx.restore();
  }

  nodeCtx.font = `${Math.max(6, 7.5 * zoom)}px Courier New`; nodeCtx.textAlign = 'left'; nodeCtx.textBaseline = 'bottom';
  nodeCtx.fillStyle = white ? `rgba(${g}, ${0.35 * flicker})` : `rgba(0, 255, 136, ${0.38 * flicker})`; nodeCtx.fillText('data.csv', tx + 2, ty - 2);

  nodeCtx.strokeStyle = white ? `rgba(${g}, ${0.15 * flicker})` : `rgba(0, 255, 136, ${0.2 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, ty + tableH); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]); nodeCtx.restore();
}

/* --- Neuron column hologram for LINEAR layers --- */
function drawNeuronHologram(layer, cx, cy, white, colorRgbOverride) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const neuronR  = Math.max(6, 10 * zoom);
  const spacing  = Math.max(22, 34 * zoom);
  const lineLen  = Math.max(18, 28 * zoom);
  const colorRgb = colorRgbOverride || (white ? '0, 100, 180' : '0, 136, 255');
  const boxH     = layerTypes.linear.h * zoom;
  const topY     = cy - boxH / 2 - Math.max(12, 18 * zoom) - 2 * spacing;
  const flicker  = 0.84 + Math.sin(time * 3.9 + layer.id * 2.3) * 0.08 + Math.sin(time * 10.1 + layer.id * 0.7) * 0.04;
  const ys       = [topY, topY + spacing, topY + spacing * 2];
  const neuronBg = white ? `rgba(240, 245, 255, ${0.9 * flicker})` : `rgba(0, 40, 90, ${0.9 * flicker})`;

  for (const ny of ys) {
    for (let w = 0; w < 3; w++) {
      nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.16 * flicker})`; nodeCtx.lineWidth = 0.7; nodeCtx.beginPath();
      nodeCtx.moveTo(cx - neuronR - lineLen, ny + (w - 1) * spacing * 0.36); nodeCtx.lineTo(cx - neuronR, ny); nodeCtx.stroke();
    }
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.2 * flicker})`; nodeCtx.lineWidth = 0.7; nodeCtx.beginPath();
    nodeCtx.moveTo(cx + neuronR, ny); nodeCtx.lineTo(cx + neuronR + lineLen, ny); nodeCtx.stroke();
  }
  for (const ny of ys) {
    nodeCtx.save(); nodeCtx.shadowColor = `rgb(${colorRgb})`; nodeCtx.shadowBlur = 14 * zoom * flicker;
    nodeCtx.beginPath(); nodeCtx.arc(cx, ny, neuronR, 0, Math.PI * 2);
    nodeCtx.fillStyle   = neuronBg; nodeCtx.fill();
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.8 * flicker})`; nodeCtx.lineWidth = 1.5; nodeCtx.stroke(); nodeCtx.restore();
    nodeCtx.beginPath(); nodeCtx.arc(cx, ny, neuronR * 0.3, 0, Math.PI * 2);
    nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.6 * flicker})`; nodeCtx.fill();
  }

  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, ys[2] + neuronR + 4); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]); nodeCtx.restore();
}

/* --- Flatten hologram: matrix → 1D strip animation --- */
function drawFlattenHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;

  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb  = white ? '200, 150, 0' : '255, 200, 0';
  const boxH      = layerTypes.flatten.h * zoom;
  const flicker   = 0.84 + Math.sin(time * 4.1 + layer.id * 1.9) * 0.08 + Math.sin(time * 9.7 + layer.id * 0.6) * 0.04;
  const gridCols  = 4, gridRows = 3, totalCells = gridCols * gridRows;
  const cellSize  = Math.max(5, Math.min(11, 8.5 * zoom));
  const cellGap   = Math.max(1.5, 2 * zoom), cellStep = cellSize + cellGap;
  const gridW     = gridCols * cellStep - cellGap, gridH = gridRows * cellStep - cellGap;
  const stripW    = totalCells * cellStep - cellGap;
  const arrowGap  = Math.max(8, 13 * zoom), totalH = gridH + arrowGap + cellSize;
  const topY      = cy - boxH / 2 - Math.max(10, 14 * zoom) - totalH;
  const gridX     = cx - gridW / 2, stripX = cx - stripW / 2, stripY = topY + gridH + arrowGap;
  const scanIdx   = Math.floor(time * 7) % totalCells;

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const idx = r * gridCols + c, hot = idx === scanIdx;
      const px = gridX + c * cellStep, py = topY + r * cellStep;
      nodeCtx.fillStyle   = `rgba(${colorRgb}, ${0.25 * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
      nodeCtx.fillStyle   = hot ? `rgba(${colorRgb}, ${0.35 * flicker})` : `rgba(${colorRgb}, ${0.08 * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
      nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(hot ? 0.85 : 0.45) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, cellSize, cellSize);
    }
  }

  const hotGX = gridX + (scanIdx % gridCols) * cellStep + cellSize / 2;
  const hotGY = topY + Math.floor(scanIdx / gridCols) * cellStep + cellSize;
  const hotSX = stripX + scanIdx * cellStep + cellSize / 2;
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.3 * flicker})`; nodeCtx.lineWidth = 0.7; nodeCtx.setLineDash([2, 3]);
  nodeCtx.beginPath(); nodeCtx.moveTo(hotGX, hotGY); nodeCtx.lineTo(hotGX, (hotGY + stripY) / 2); nodeCtx.lineTo(hotSX, (hotGY + stripY) / 2); nodeCtx.lineTo(hotSX, stripY); nodeCtx.stroke();
  nodeCtx.setLineDash([]);

  for (let i = 0; i < totalCells; i++) {
    const px = stripX + i * cellStep, hot = i === scanIdx;
    nodeCtx.fillStyle   = `rgba(${colorRgb}, ${0.25 * flicker})`; nodeCtx.fillRect(px, stripY, cellSize, cellSize);
    nodeCtx.fillStyle   = hot ? `rgba(${colorRgb}, ${0.35 * flicker})` : `rgba(${colorRgb}, ${0.08 * flicker})`; nodeCtx.fillRect(px, stripY, cellSize, cellSize);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(hot ? 0.85 : 0.45) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, stripY, cellSize, cellSize);
  }

  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, stripY + cellSize + 4); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]);
}

/* --- Mean hologram: 2D tensor collapsing into reduced values --- */
function drawMeanHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;

  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb  = white ? '200, 120, 0' : '255, 140, 0';
  const boxH      = layerTypes.mean.h * zoom;
  const flicker   = 0.84 + Math.sin(time * 4.1 + layer.id * 1.9) * 0.08 + Math.sin(time * 9.7 + layer.id * 0.6) * 0.04;
  const rows      = 3, cols = 2;
  const cellSize  = Math.max(8, Math.min(16, 13 * zoom));
  const cellGap   = Math.max(2, 3 * zoom), cellStep = cellSize + cellGap;
  const gridW     = cols * cellStep - cellGap;
  const outSize   = Math.max(8, Math.min(16, 13 * zoom));
  const gap       = Math.max(18, 28 * zoom);
  const topY      = cy - boxH / 2 - gap - (rows * cellStep - cellGap);
  const gridX     = cx - gridW / 2;

  // 2D tensor grid
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = gridX + c * cellStep, py = topY + r * cellStep;
      nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.25 * flicker})`;
      nodeCtx.fillRect(px, py, cellSize, cellSize);
      const shimmer = 0.08 + 0.06 * Math.sin(time * 2 + r * 1.3 + c * 2.7 + layer.id);
      nodeCtx.fillStyle = `rgba(${colorRgb}, ${shimmer * flicker})`;
      nodeCtx.fillRect(px, py, cellSize, cellSize);
      nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.45 * flicker})`;
      nodeCtx.lineWidth = 0.5;
      nodeCtx.strokeRect(px, py, cellSize, cellSize);
    }
  }

  // Collapse arrows: from each row's cells down to a single reduced cell
  const arrowY = topY + rows * cellStep + 2;
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.35 * flicker})`;
  nodeCtx.lineWidth = 0.6;
  for (let r = 0; r < rows; r++) {
    const rowMid = gridX + (cols - 1) * cellStep / 2 + cellSize / 2;
    const leftX  = gridX;
    const rightX = gridX + (cols - 1) * cellStep + cellSize;
    nodeCtx.beginPath();
    nodeCtx.moveTo(leftX, topY + r * cellStep + cellSize);
    nodeCtx.lineTo(rowMid, arrowY);
    nodeCtx.moveTo(rightX, topY + r * cellStep + cellSize);
    nodeCtx.lineTo(rowMid, arrowY);
    nodeCtx.stroke();
  }

  // Reduced output row (1D — collapsed dimension)
  const outRowY = arrowY;
  const outW     = rows * cellStep - cellGap;
  const outX     = cx - outW / 2;
  const scanRow  = Math.floor(time * 3) % rows;

  for (let r = 0; r < rows; r++) {
    const px = outX + r * cellStep;
    const isHot = r === scanRow;
     nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.25 * flicker})`;
    nodeCtx.fillRect(px, outRowY, outSize, outSize);
    nodeCtx.fillStyle = isHot
      ? `rgba(${colorRgb}, ${0.35 * flicker})`
      : `rgba(${colorRgb}, ${0.08 * flicker})`;
    nodeCtx.fillRect(px, outRowY, outSize, outSize);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(isHot ? 0.8 : 0.45) * flicker})`;
    nodeCtx.lineWidth = 0.5;
    nodeCtx.strokeRect(px, outRowY, outSize, outSize);
  }

  // Label
  // Connector to layer box
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`;
  nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]);
  nodeCtx.beginPath();
  nodeCtx.moveTo(cx, outRowY + outSize + 4);
  nodeCtx.lineTo(cx, cy - boxH / 2);
  nodeCtx.stroke();
  nodeCtx.setLineDash([]);

  nodeCtx.restore();
}

/* --- Conv hologram: feature map grid with kernel overlay --- */
function drawConvHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb  = white ? '0, 140, 160' : '0, 204, 221';
  const boxH      = layerTypes.conv.h * zoom;
  const flicker   = 0.84 + Math.sin(time * 4.1 + layer.id * 1.9) * 0.08 + Math.sin(time * 9.7 + layer.id * 0.6) * 0.04;
  const gridCols  = 6, gridRows = 6;
  const cellSize  = Math.max(7, Math.min(14, 11 * zoom));
  const cellGap   = Math.max(2, 2.5 * zoom), cellStep = cellSize + cellGap;
  const gridW     = gridCols * cellStep - cellGap, gridH = gridRows * cellStep - cellGap;
  const ks        = resolveVal(layer.kernel_size || 3);
  const ksPx      = Math.max(6, Math.min(cellSize * 0.7, ks * 2.5 * zoom));
  const topY      = cy - boxH / 2 - Math.max(10, 14 * zoom) - gridH;
  const gridX     = cx - gridW / 2;
  const scanIdx   = Math.floor(time * 5) % (gridCols * gridRows);
  const scanR     = Math.floor(scanIdx / gridCols);
  const scanC     = scanIdx % gridCols;

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const idx = r * gridCols + c, hot = idx === scanIdx;
      const px = gridX + c * cellStep, py = topY + r * cellStep;
      nodeCtx.fillStyle   = `rgba(${colorRgb}, ${0.25 * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
      nodeCtx.fillStyle   = hot ? `rgba(${colorRgb}, ${0.35 * flicker})` : `rgba(${colorRgb}, ${0.08 * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
      nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(hot ? 0.85 : 0.45) * flicker})`;
      nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, cellSize, cellSize);
    }
  }

  // kernel overlay on hot cell
  const hotGX = gridX + scanC * cellStep + cellSize / 2;
  const hotGY = topY + scanR * cellStep + cellSize / 2;
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.4 * flicker})`;
  nodeCtx.lineWidth = 0.8;
  nodeCtx.strokeRect(hotGX - ksPx / 2, hotGY - ksPx / 2, ksPx, ksPx);
  nodeCtx.beginPath();
  nodeCtx.moveTo(hotGX - ksPx / 2, hotGY); nodeCtx.lineTo(hotGX + ksPx / 2, hotGY);
  nodeCtx.moveTo(hotGX, hotGY - ksPx / 2); nodeCtx.lineTo(hotGX, hotGY + ksPx / 2);
  nodeCtx.stroke();

  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`;
  nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]);
  nodeCtx.beginPath(); nodeCtx.moveTo(cx, topY + gridH + 4); nodeCtx.lineTo(cx, cy - boxH / 2);
  nodeCtx.stroke();
  nodeCtx.setLineDash([]);
  nodeCtx.restore();
}

/* --- Activation curve hologram for LINEAR layers --- */
function drawActivationCurve(layer, cx, cy) {
  if (zoom < 0.3) return;
  const act = layer.activation;
  if (!act || act === 'none') return;

  const white = document.body.classList.contains('white-mode');
  const colorRgb = white ? '0, 100, 180' : '0, 136, 255';
  const flicker  = 0.86 + Math.sin(time * 3.3 + layer.id * 1.7) * 0.08 + Math.sin(time * 7.9 + layer.id * 0.5) * 0.03;
  const boxH     = layerTypes.linear.h * zoom;
  const curveW   = 100 * zoom, curveH = 46 * zoom, gap = 14 * zoom;
  const left     = cx - curveW / 2, top = cy + boxH / 2 + gap;

  let fn;
  if      (act === 'relu')       fn = x => Math.max(0, x);
  else if (act === 'gelu')       fn = x => 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
  else if (act === 'swiglu')     fn = x => x / (1 + Math.exp(-x));
  else if (act === 'sigmoid')    fn = x => 1 / (1 + Math.exp(-x));
  else if (act === 'tanh')       fn = x => Math.tanh(x);
  else if (act === 'leaky_relu') fn = x => x >= 0 ? x : 0.01 * x;
  else if (act === 'elu')        fn = x => x >= 0 ? x : Math.exp(x) - 1;
  else if (act === 'selu')       fn = x => x >= 0 ? 1.0507 * x : 1.0507 * 1.6733 * (Math.exp(x) - 1);
  else if (act === 'softplus')   fn = x => Math.log(1 + Math.exp(x));
  else if (act === 'mish')       fn = x => x * Math.tanh(Math.log(1 + Math.exp(x)));
  else return;

  const xMin = -3, xMax = 3, steps = 80;
  const ys = [];
  for (let i = 0; i <= steps; i++) ys.push(fn(xMin + (xMax - xMin) * i / steps));
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const yPad = (yMax - yMin) * 0.14 || 0.1;
  const yLo  = yMin - yPad, yHi = yMax + yPad, yRng = yHi - yLo;
  const toSX = i => left + (i / steps) * curveW;
  const toSY = y  => top  + curveH - (y - yLo) / yRng * curveH;

  nodeCtx.save();
  nodeCtx.setLineDash([2, 4]); nodeCtx.lineWidth = 0.7;
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`;
  nodeCtx.beginPath(); nodeCtx.moveTo(cx, cy + boxH / 2); nodeCtx.lineTo(cx, top); nodeCtx.stroke();
  nodeCtx.setLineDash([]);

  nodeCtx.shadowColor = `rgba(${colorRgb}, 0.8)`; nodeCtx.shadowBlur = 6;
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.9 * flicker})`; nodeCtx.lineWidth = 1.5;
  nodeCtx.lineJoin    = 'round'; nodeCtx.lineCap = 'round';
  nodeCtx.beginPath();
  for (let i = 0; i <= steps; i++) i === 0 ? nodeCtx.moveTo(toSX(i), toSY(ys[i])) : nodeCtx.lineTo(toSX(i), toSY(ys[i]));
  nodeCtx.stroke();

  nodeCtx.shadowBlur   = 0;
  nodeCtx.font         = `${Math.max(7, 8 * zoom)}px Courier New`;
  nodeCtx.fillStyle    = `rgba(${colorRgb}, ${0.38 * flicker})`;
  nodeCtx.textAlign    = 'center'; nodeCtx.textBaseline = 'top';
  nodeCtx.fillText(act, cx, top + curveH + 3);
  nodeCtx.restore();
}

/* --- Origin marker --- */
function drawOrigin() {
  const [ox, oy] = worldToScreen(0, 0);
  const pulse    = Math.sin(time * 3) * 0.3 + 0.7;
  nodeCtx.beginPath(); nodeCtx.arc(ox, oy, 4 * zoom, 0, Math.PI * 2);
  nodeCtx.strokeStyle = `rgba(255, 50, 50, ${0.5 * pulse})`;
  nodeCtx.lineWidth   = 1.5; nodeCtx.stroke();
}

/* --- Ghost (palette drag preview) --- */
function drawGhost(mx, my) {
  if (!paletteDragType) return;
  const t  = layerTypes[paletteDragType];
  const w  = t.w * zoom, h = t.h * zoom;
  const [wx, wy] = screenToWorld(mx, my);
  const [sx, sy] = worldToScreen(snapToGrid(wx), snapToGrid(wy));
  const white = document.body.classList.contains('white-mode');
  ghostEl.style.display    = 'block';
  ghostEl.style.left       = (sx - w / 2) + 'px';
  ghostEl.style.top        = (sy - h / 2) + 'px';
  ghostEl.style.width      = w + 'px';
  ghostEl.style.height     = h + 'px';
  ghostEl.style.border     = `1.5px dashed ${white ? t.color : t.color}`;
  ghostEl.style.borderRadius = '4px';
  ghostEl.style.opacity    = '0.6';
  ghostEl.style.boxShadow  = white ? '0 0 10px rgba(0,0,0,0.1)' : `0 0 15px ${t.glow}44`;
  ghostEl.style.background = white ? `rgba(${hexToRgb(t.color)}, 0.06)` : t.bg.replace('0.9', '0.3');
  const fontSize = Math.max(9, 12 * zoom);
  ghostEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:${t.color};font-family:Courier New;font-size:${fontSize}px;font-weight:bold;">${paletteDragType.toUpperCase()}</div>`;
}
function hideGhost() { ghostEl.style.display = 'none'; }


/* --- Unsqueeze hologram: flat strip gains a new bracket dimension --- */
function drawUnsqueezeHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '176, 32, 112' : '224, 96, 160';
  const boxH     = layerTypes.unsqueeze.h * zoom;
  const flicker  = 0.84 + Math.sin(time * 3.7 + layer.id * 2.1) * 0.08 + Math.sin(time * 8.9 + layer.id * 0.5) * 0.04;
  const cols     = 6;
  const cellSize = Math.max(5, Math.min(11, 8.5 * zoom));
  const cellGap  = Math.max(1.5, 2 * zoom), cellStep = cellSize + cellGap;
  const stripW   = cols * cellStep - cellGap;
  const bracketH = Math.max(6, 9 * zoom);
  const gap      = Math.max(8, 12 * zoom);
  const totalH   = bracketH + cellGap + cellSize;
  const topY     = cy - boxH / 2 - gap - totalH;
  const stripX   = cx - stripW / 2;
  const scanIdx  = Math.floor(time * 6) % cols;

  // bracket row (the new dim=1)
  const bracketY = topY;
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.55 * flicker})`; nodeCtx.lineWidth = 1;
  nodeCtx.strokeRect(stripX - 2, bracketY, stripW + 4, bracketH);
  const fontSize = Math.max(6, 7 * zoom);
  nodeCtx.font = `${fontSize}px Courier New`; nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.5 * flicker})`;
  nodeCtx.fillText('1', cx, bracketY + bracketH / 2);

  // original 1D strip
  const rowY = topY + bracketH + cellGap;
  for (let i = 0; i < cols; i++) {
    const px = stripX + i * cellStep, hot = i === scanIdx;
    nodeCtx.fillStyle   = `rgba(${colorRgb}, ${0.25 * flicker})`; nodeCtx.fillRect(px, rowY, cellSize, cellSize);
    nodeCtx.fillStyle   = hot ? `rgba(${colorRgb}, ${0.4 * flicker})` : `rgba(${colorRgb}, ${0.08 * flicker})`; nodeCtx.fillRect(px, rowY, cellSize, cellSize);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(hot ? 0.85 : 0.4) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, rowY, cellSize, cellSize);
  }

  // connector
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, rowY + cellSize + 4); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]); nodeCtx.restore();
}

/* --- Squeeze hologram: 2D grid collapses a dim-1 row/col into flat strip --- */
function drawSqueezeHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '128, 48, 192' : '200, 122, 240';
  const boxH     = layerTypes.squeeze.h * zoom;
  const flicker  = 0.84 + Math.sin(time * 3.3 + layer.id * 1.9) * 0.08 + Math.sin(time * 8.5 + layer.id * 0.6) * 0.04;
  const cols = 6, rows = 2;
  const cellSize = Math.max(5, Math.min(10, 8 * zoom));
  const cellGap  = Math.max(1.5, 2 * zoom), cellStep = cellSize + cellGap;
  const gridW    = cols * cellStep - cellGap;
  const gridH    = rows * cellStep - cellGap;
  const gap      = Math.max(8, 12 * zoom);
  // show: top row is size-1 (being squeezed), bottom row is data
  const topY  = cy - boxH / 2 - gap - gridH - cellStep;
  const scanIdx = Math.floor(time * 5) % cols;

  // top dim-1 row (gets squeezed, rendered dimmer with strikethrough-ish)
  for (let c = 0; c < cols; c++) {
    const px = cx - gridW / 2 + c * cellStep, py = topY;
    const hot = c === scanIdx;
    nodeCtx.fillStyle = `rgba(${colorRgb}, ${(hot ? 0.35 : 0.1) * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(hot ? 0.6 : 0.22) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, cellSize, cellSize);
  }
  // dim label "1" centred on that row
  const fontSize = Math.max(6, 7 * zoom);
  nodeCtx.font = `${fontSize}px Courier New`; nodeCtx.textAlign = 'right'; nodeCtx.textBaseline = 'middle';
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.45 * flicker})`;
  nodeCtx.fillText('1', cx - gridW / 2 - 4, topY + cellSize / 2);
  nodeCtx.textAlign = 'center';

  // main data row below
  const dataY = topY + cellStep;
  for (let c = 0; c < cols; c++) {
    const px = cx - gridW / 2 + c * cellStep, hot = c === scanIdx;
    nodeCtx.fillStyle = `rgba(${colorRgb}, ${(hot ? 0.5 : 0.18) * flicker})`; nodeCtx.fillRect(px, dataY, cellSize, cellSize);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(hot ? 0.9 : 0.45) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, dataY, cellSize, cellSize);
  }

  // arrow suggesting collapse
  const arrowFromY = topY - 5;
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.3 * flicker})`; nodeCtx.lineWidth = 1;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, dataY + cellSize + 4); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]); nodeCtx.restore();
}

/* --- Softmax hologram: bar chart normalising to probability distribution --- */
function drawSoftmaxHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '204, 17, 17' : '255, 51, 51';
  const boxH     = layerTypes.softmax.h * zoom;
  const flicker  = 0.84 + Math.sin(time * 3.5 + layer.id * 1.8) * 0.08 + Math.sin(time * 9.2 + layer.id * 0.7) * 0.04;
  const bars     = 5;
  const barW     = Math.max(5, Math.min(12, 9 * zoom));
  const barGap   = Math.max(2, 3 * zoom);
  const barStep  = barW + barGap;
  const maxH     = Math.max(20, 32 * zoom);
  const totalW   = bars * barStep - barGap;
  const gap      = Math.max(8, 12 * zoom);
  const baseY    = cy - boxH / 2 - gap;
  const leftX    = cx - totalW / 2;

  // raw logits (pseudo-random, animated shimmer)
  const logits = Array.from({length: bars}, (_, i) =>
    0.3 + 0.7 * hashF(layer.id * 17 + i * 7, 0) + 0.12 * Math.sin(time * 1.8 + i * 1.4 + layer.id)
  );
  // softmax
  const expL  = logits.map(x => Math.exp(x * 2));
  const sumE  = expL.reduce((a, b) => a + b, 0);
  const probs = expL.map(e => e / sumE);

  // draw bars (heights = softmax probs)
  const t = Math.abs(Math.sin(time * 0.6 + layer.id)); // slow morph
  for (let i = 0; i < bars; i++) {
    const h   = probs[i] * maxH;
    const px  = leftX + i * barStep;
    const py  = baseY - h;
    nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.fillRect(px, py, barW, h);
    nodeCtx.fillStyle = `rgba(${colorRgb}, ${(0.35 + probs[i] * 0.45) * flicker})`; nodeCtx.fillRect(px, py, barW, h);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.55 * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, barW, h);
  }

  // sum=1 label
  const fontSize = Math.max(6, 7 * zoom);
  nodeCtx.font = `${fontSize}px Courier New`; nodeCtx.textAlign = 'right'; nodeCtx.textBaseline = 'bottom';
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.35 * flicker})`;
  nodeCtx.fillText('Σ=1', leftX + totalW, baseY - maxH - 2);

  // connector
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, baseY); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]); nodeCtx.restore();
}

/* --- Add hologram: two grids + result grid with + symbol --- */
function drawAddHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '90, 138, 0' : '170, 255, 0';
  const boxH     = layerTypes.add.h * zoom;
  const flicker  = 0.84 + Math.sin(time * 4.0 + layer.id * 1.6) * 0.08 + Math.sin(time * 9.5 + layer.id * 0.8) * 0.04;
  const rows = 3, cols = 3;
  const cellSize = Math.max(5, Math.min(10, 8 * zoom));
  const cellGap  = Math.max(1.5, 2 * zoom), cellStep = cellSize + cellGap;
  const gridW    = cols * cellStep - cellGap, gridH = rows * cellStep - cellGap;
  const gap      = Math.max(6, 9 * zoom);
  const symW     = Math.max(8, 12 * zoom);
  const totalW   = gridW * 2 + symW * 2 + gridW; // A + B = C
  const topY     = cy - boxH / 2 - Math.max(10, 14 * zoom) - gridH;
  const aX       = cx - totalW / 2;
  const bX       = aX + gridW + symW;
  const cX       = bX + gridW + symW;
  const midY     = topY + gridH / 2;
  const scanIdx  = Math.floor(time * 5) % (rows * cols);

  function drawGrid(ox, hot) {
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const idx = r * cols + cc, isHot = idx === hot;
        const px = ox + cc * cellStep, py = topY + r * cellStep;
        nodeCtx.fillStyle   = `rgba(${colorRgb}, ${0.22 * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
        nodeCtx.fillStyle   = isHot ? `rgba(${colorRgb}, ${0.4 * flicker})` : `rgba(${colorRgb}, ${0.06 * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
        nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(isHot ? 0.9 : 0.4) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, cellSize, cellSize);
      }
    }
  }
  drawGrid(aX, scanIdx);
  drawGrid(bX, scanIdx);
  drawGrid(cX, scanIdx); // result highlighted too

  // + and = symbols
  const fontSize = Math.max(8, 11 * zoom);
  nodeCtx.font = `bold ${fontSize}px Courier New`; nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.7 * flicker})`;
  nodeCtx.fillText('+', aX + gridW + symW / 2, midY);
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.5 * flicker})`;
  nodeCtx.fillText('=', bX + gridW + symW / 2, midY);

  // connector
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, topY + gridH + 4); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]); nodeCtx.restore();
}

/* --- Superboxes (groups): filled rect + dashed border + name label --- */
function drawSuperboxes(white) {
  _sbEyeBtns = []; // reset each frame
  if (!superboxes.length && !(drawMode && _sbDrawStart && _sbDrawCurrent)
      && !(selectMode && _selectStart && _selectCurrent)) return;

  // O(s) maps: avoid O(s^2*log s) sbsSortedByDepth + O(s) superboxes.filter per SB
  const _lChildMap = new Map();  // sbId -> child SBs[]
  const _lParentMap = new Map(); // sbId -> parentId
  for (const sb of superboxes) {
    if (!_lChildMap.has(sb.id)) _lChildMap.set(sb.id, []);
    if (sb.parentId) {
      if (!_lChildMap.has(sb.parentId)) _lChildMap.set(sb.parentId, []);
      _lChildMap.get(sb.parentId).push(sb);
      _lParentMap.set(sb.id, sb.parentId);
    }
  }
  // Depth: O(depth) per SB using parent map (depth typically 1-2, not s)
  const _lDepthMap = new Map();
  const _lDepth = id => {
    if (_lDepthMap.has(id)) return _lDepthMap.get(id);
    let d = 0, cur = id;
    while (_lParentMap.has(cur)) { cur = _lParentMap.get(cur); if (++d > 30) break; }
    _lDepthMap.set(id, d);
    return d;
  };
  // Pre-compute depths, sort shallower-first (O(s log s) with O(1) comparator)
  const _sbByDepth = [...superboxes].sort((a, b) => _lDepth(a.id) - _lDepth(b.id));
  // Layer-id set for O(1) membership check in _sbFullySel
  const _layerIdSet = new Set(layers.map(l => l.id));

  for (let i = 0; i < _sbByDepth.length; i++) {
    const sb = _sbByDepth[i];
    const _sbPalette = white ? SUPERBOX_COLORS_LIGHT : SUPERBOX_COLORS;
    const color = _sbPalette[sb.colorIdx % _sbPalette.length];
    const [sx, sy] = worldToScreen(sb.x, sb.y);
    const sw = sb.w * zoom, sh = sb.h * zoom;

    // Viewport cull: skip SBs entirely off-screen (small margin for labels above)
    const _sbM = 60;
    if (sx + sw + _sbM < 0 || sx - _sbM > W || sy + sh + _sbM < 0 || sy - _sbM > H) continue;

    const isSelected = sb.id === selectedSuperboxId;
    // _sbFullySel: O(children) per node using pre-built child map + O(1) id set
    const _sbFullySel = (s) => {
      if (typeof selectedLayerIds === 'undefined' || selectedLayerIds.size === 0) return false;
      const existingLayers = s.layerIds.filter(id => _layerIdSet.has(id));
      const childSbs = _lChildMap.get(s.id) || [];
      if (existingLayers.length === 0 && childSbs.length === 0) return false;
      return existingLayers.every(id => selectedLayerIds.has(id)) &&
             childSbs.every(c => _sbFullySel(c));
    };
    const isMultiSelected = _sbFullySel(sb);

    // fill (skipped when bgVisible === false)
    if (sb.bgVisible !== false) {
      nodeCtx.save();
      nodeCtx.globalAlpha = white ? 0.07 : 0.08;
      nodeCtx.fillStyle = color;
      nodeCtx.fillRect(sx, sy, sw, sh);
      nodeCtx.restore();
    }

    // border
    nodeCtx.save();
    nodeCtx.globalAlpha = isSelected ? 0.9 : 0.45;
    nodeCtx.strokeStyle = color;
    nodeCtx.lineWidth = isSelected ? 2 : 1;
    if (!isSelected) nodeCtx.setLineDash([6, 4]);
    nodeCtx.strokeRect(sx, sy, sw, sh);
    nodeCtx.setLineDash([]);
    nodeCtx.restore();

    // multi-select highlight: pulsing blue border when fully selected
    if (isMultiSelected) {
      const _msPulse = 0.55 + 0.45 * Math.sin(time * 5.5 + sb.id * 0.9);
      nodeCtx.save();
      nodeCtx.strokeStyle = white
        ? `rgba(3, 105, 161, ${_msPulse})`
        : `rgba(56, 189, 248, ${_msPulse})`;
      nodeCtx.lineWidth = 2.5;
      nodeCtx.setLineDash([4, 3]);
      nodeCtx.strokeRect(sx - 4, sy - 4, sw + 8, sh + 8);
      nodeCtx.setLineDash([]);
      nodeCtx.restore();
    }

    // name label + eye button (top-left, indented by depth)
    {
      const depth    = _lDepth(sb.id);
      const fontSize = Math.max(11, (39 - depth * 5) * zoom);
      const indent   = depth * Math.max(8, 10 * zoom);
      const eyeR     = Math.max(5, fontSize * 0.45);
      const labelAlpha = isSelected ? 0.95 : 0.65;

      // measure name width to position eye after it
      nodeCtx.font = `bold ${fontSize}px Courier New`;
      const nameW  = sb.name ? nodeCtx.measureText(sb.name).width : 0;
      const labelX = sx + 6 + indent;
      const labelY = sy - 3;
      const eyeCX  = labelX + nameW + (sb.name ? eyeR * 1.5 : eyeR * 0.5);
      const eyeCY  = labelY - fontSize * 0.38;

      // store hit area for interactions.js
      _sbEyeBtns.push({ sbId: sb.id, cx: eyeCX, cy: eyeCY, r: eyeR });

      // nested groups hide name+eye at zoom <= 0.1 (top-level groups always show)
      if (!(sb.parentId && zoom <= 0.1)) {
        if (sb.name) {
          nodeCtx.save();
          nodeCtx.globalAlpha = labelAlpha;
          nodeCtx.fillStyle = color;
          nodeCtx.textAlign = 'left';
          nodeCtx.textBaseline = 'bottom';
          nodeCtx.fillText(sb.name, labelX, labelY);
          nodeCtx.restore();
        }

        // draw eye icon
        const eyeVisible = sb.bgVisible !== false;
        nodeCtx.save();
        nodeCtx.globalAlpha = labelAlpha * (eyeVisible ? 1 : 0.55);
        nodeCtx.strokeStyle = color;
        nodeCtx.fillStyle   = color;
        nodeCtx.lineWidth   = Math.max(1, eyeR * 0.28);
        // outer ellipse (eye whites)
        nodeCtx.beginPath();
        nodeCtx.ellipse(eyeCX, eyeCY, eyeR, eyeR * 0.6, 0, 0, Math.PI * 2);
        nodeCtx.stroke();
        // pupil
        nodeCtx.beginPath();
        nodeCtx.arc(eyeCX, eyeCY, eyeR * 0.3, 0, Math.PI * 2);
        nodeCtx.fill();
        if (!eyeVisible) {
          // strikethrough
          nodeCtx.beginPath();
          nodeCtx.moveTo(eyeCX - eyeR * 0.85, eyeCY + eyeR * 0.55);
          nodeCtx.lineTo(eyeCX + eyeR * 0.85, eyeCY - eyeR * 0.55);
          nodeCtx.stroke();
        }
        nodeCtx.restore();
      }
    }
  }

  // live draw rect while in draw mode
  if (drawMode && _sbDrawStart && _sbDrawCurrent) {
    const [ax, ay] = worldToScreen(_sbDrawStart.wx, _sbDrawStart.wy);
    const [bx, by] = worldToScreen(_sbDrawCurrent.wx, _sbDrawCurrent.wy);
    nodeCtx.save();
    nodeCtx.globalAlpha = 0.12;
    nodeCtx.fillStyle = '#ffffff';
    nodeCtx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    nodeCtx.globalAlpha = 0.8;
    nodeCtx.strokeStyle = '#ffffff';
    nodeCtx.lineWidth = 1.5;
    nodeCtx.setLineDash([5, 4]);
    nodeCtx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    nodeCtx.setLineDash([]);
    nodeCtx.restore();
  }

  // live select rect while in select mode
  if (selectMode && _selectStart && _selectCurrent) {
    const [ax, ay] = worldToScreen(_selectStart.wx, _selectStart.wy);
    const [bx, by] = worldToScreen(_selectCurrent.wx, _selectCurrent.wy);
    nodeCtx.save();
    nodeCtx.globalAlpha = 0.10;
    nodeCtx.fillStyle = '#38bdf8';
    nodeCtx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    nodeCtx.globalAlpha = 0.85;
    nodeCtx.strokeStyle = '#38bdf8';
    nodeCtx.lineWidth = 1.5;
    nodeCtx.setLineDash([5, 4]);
    nodeCtx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    nodeCtx.setLineDash([]);
    nodeCtx.restore();
  }
}

/* --- BMM hologram: two tall matrices with @ symbol → result --- */
function drawTransposeHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '102, 68, 204' : '170, 136, 255';
  const boxH     = layerTypes.transpose.h * zoom;
  const flicker  = 0.84 + Math.sin(time * 2.9 + layer.id * 1.4) * 0.09 + Math.sin(time * 8.1 + layer.id * 0.5) * 0.04;
  const rows = 3, cols = 4; // input: rows×cols
  const cellSize = Math.max(4, Math.min(8, 6.5 * zoom));
  const cellGap  = Math.max(1, 1.5 * zoom), cellStep = cellSize + cellGap;
  const gridAW   = cols * cellStep - cellGap, gridAH = rows * cellStep - cellGap;
  const gridBW   = rows * cellStep - cellGap, gridBH = cols * cellStep - cellGap; // transposed
  const symW     = Math.max(10, 14 * zoom);
  const totalW   = gridAW + symW + gridBW;
  const gap      = Math.max(8, 11 * zoom);
  const topY     = cy - boxH / 2 - gap - Math.max(gridAH, gridBH);
  const aX       = cx - totalW / 2;
  const bX       = aX + gridAW + symW;
  // animate: highlight diagonal sweep
  const diagT    = (time * 2) % (rows + cols);

  function drawGrid(ox, oy, r, c, transposed) {
    for (let ri = 0; ri < r; ri++) {
      for (let ci = 0; ci < c; ci++) {
        const px = ox + ci * cellStep, py = oy + ri * cellStep;
        const srcR = transposed ? ci : ri, srcC = transposed ? ri : ci;
        const onDiag = Math.abs(srcR - srcC - diagT + rows) < 1.2;
        const base = hashF(srcR * 13 + layer.id, srcC * 7 + layer.id) * 0.25 + 0.1;
        nodeCtx.fillStyle   = `rgba(${colorRgb}, ${(onDiag ? base + 0.35 : base) * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
        nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(onDiag ? 0.75 : 0.35) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, cellSize, cellSize);
      }
    }
  }

  const midAY = topY + (Math.max(gridAH, gridBH) - gridAH) / 2;
  const midBY = topY + (Math.max(gridAH, gridBH) - gridBH) / 2;
  drawGrid(aX, midAY, rows, cols, false);
  drawGrid(bX, midBY, cols, rows, true);

  const fontSize = Math.max(8, 11 * zoom);
  nodeCtx.font = `bold ${fontSize}px Courier New`; nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
  const midY = topY + Math.max(gridAH, gridBH) / 2;
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.85 * flicker})`;
  nodeCtx.fillText('T', aX + gridAW + symW / 2, midY);

  nodeCtx.restore();
}


function drawRMSNormHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '3, 105, 161' : '56, 189, 248';
  const boxH     = layerTypes.rmsnorm.h * zoom;
  const flicker  = 0.84 + Math.sin(time * 2.6 + layer.id * 1.4) * 0.09 + Math.sin(time * 6.5 + layer.id * 0.8) * 0.04;
  const gap      = Math.max(8, 11 * zoom);
  const barW     = Math.max(3, 4.5 * zoom);
  const barGap   = Math.max(1.5, 2 * zoom);
  const nBars    = 5;
  const rawHeights = [0.45, 0.85, 0.60, 1.0, 0.30]; // arbitrary "raw" vector
  const totalBarW  = nBars * barW + (nBars - 1) * barGap;
  const maxBarH    = Math.max(18, 26 * zoom);
  const arrowGap   = Math.max(7, 10 * zoom);
  const arrowLen   = Math.max(8, 12 * zoom);
  const totalW     = totalBarW * 2 + arrowLen + arrowGap * 2;
  const lx0        = cx - totalW / 2;   // left group left edge
  const rx0        = lx0 + totalBarW + arrowLen + arrowGap * 2; // right group left edge
  const baseY      = cy - boxH / 2 - gap;

  // Pulse: animate each bar on the right (normalized) to uniform height with flicker
  const rms = Math.sqrt(rawHeights.reduce((s, v) => s + v * v, 0) / rawHeights.length);
  const normHeights = rawHeights.map(v => v / rms * 0.65); // ~uniform after RMS norm

  // LEFT: raw bars (varying heights)
  for (let i = 0; i < nBars; i++) {
    const bx = lx0 + i * (barW + barGap);
    const bh = rawHeights[i] * maxBarH;
    nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.35 * flicker})`;
    nodeCtx.fillRect(bx, baseY - bh, barW, bh);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.65 * flicker})`;
    nodeCtx.lineWidth = Math.max(0.5, 0.8 * zoom);
    nodeCtx.strokeRect(bx, baseY - bh, barW, bh);
  }

  // Arrow →
  const ax = lx0 + totalBarW + arrowGap;
  const ay = baseY - maxBarH * 0.5;
  const ar = Math.max(3, 3.5 * zoom);
  nodeCtx.beginPath();
  nodeCtx.moveTo(ax, ay); nodeCtx.lineTo(ax + arrowLen, ay);
  nodeCtx.moveTo(ax + arrowLen, ay); nodeCtx.lineTo(ax + arrowLen - ar, ay - ar * 0.55);
  nodeCtx.moveTo(ax + arrowLen, ay); nodeCtx.lineTo(ax + arrowLen - ar, ay + ar * 0.55);
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.55 * flicker})`;
  nodeCtx.lineWidth = Math.max(1, 1.3 * zoom); nodeCtx.stroke();

  // RIGHT: normalized bars (all ~same height, pulsing slightly)
  const normPulse = 0.9 + 0.1 * Math.sin(time * 4.0 + layer.id * 1.1);
  for (let i = 0; i < nBars; i++) {
    const bx = rx0 + i * (barW + barGap);
    const bh = normHeights[i] * maxBarH * normPulse;
    nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.45 * flicker})`;
    nodeCtx.fillRect(bx, baseY - bh, barW, bh);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.9 * flicker})`;
    nodeCtx.lineWidth = Math.max(0.5, 0.8 * zoom);
    nodeCtx.strokeRect(bx, baseY - bh, barW, bh);
  }

  // "÷RMS" label
  const fs = Math.max(6, 8 * zoom);
  nodeCtx.font = `${fs}px Courier New`; nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'bottom';
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.65 * flicker})`;
  nodeCtx.fillText('÷RMS', cx, baseY - maxBarH - Math.max(2, 3 * zoom));

  nodeCtx.restore();
}

function drawLayerNormHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '10, 122, 80' : '52, 211, 153';
  const boxH     = layerTypes.layernorm.h * zoom;
  const flicker  = 0.84 + Math.sin(time * 2.8 + layer.id * 1.3) * 0.09 + Math.sin(time * 7.0 + layer.id * 0.7) * 0.04;
  const gap      = Math.max(8, 11 * zoom);
  const curveW   = Math.max(40, 56 * zoom);
  const curveH   = Math.max(16, 22 * zoom);
  const topY     = cy - boxH / 2 - gap - curveH - Math.max(8, 10 * zoom);
  const arrowGap = Math.max(6, 8 * zoom);
  const totalW   = curveW * 2 + arrowGap * 2 + Math.max(8, 10 * zoom);
  const lx       = cx - totalW / 2;  // left curve center
  const rx       = lx + curveW + arrowGap * 2 + Math.max(8, 10 * zoom);  // right curve center
  const midY     = topY + curveH / 2;

  // Draw a curve using points (skewed/ragged left = raw, bell right = normalized)
  const pts = 24;

  // Left: jagged / skewed distribution
  nodeCtx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const t2 = i / pts;
    const xp = lx - curveW / 2 + t2 * curveW;
    // skewed: leans left, asymmetric
    const g  = Math.exp(-Math.pow((t2 - 0.35) * 3.5, 2)) * 0.9
              + Math.exp(-Math.pow((t2 - 0.65) * 5, 2)) * 0.3;
    const yp = midY + curveH / 2 - g * curveH;
    i === 0 ? nodeCtx.moveTo(xp, yp) : nodeCtx.lineTo(xp, yp);
  }
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.5 * flicker})`;
  nodeCtx.lineWidth = Math.max(1, 1.5 * zoom); nodeCtx.stroke();
  // fill under
  nodeCtx.lineTo(lx + curveW / 2, midY + curveH / 2);
  nodeCtx.lineTo(lx - curveW / 2, midY + curveH / 2);
  nodeCtx.closePath();
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.12 * flicker})`; nodeCtx.fill();

  // Arrow →
  const ax = lx + curveW / 2 + 2, ay = midY;
  nodeCtx.beginPath();
  nodeCtx.moveTo(ax, ay); nodeCtx.lineTo(ax + arrowGap, ay);
  const ar = Math.max(3, 3.5 * zoom);
  nodeCtx.moveTo(ax + arrowGap, ay); nodeCtx.lineTo(ax + arrowGap - ar, ay - ar * 0.55);
  nodeCtx.moveTo(ax + arrowGap, ay); nodeCtx.lineTo(ax + arrowGap - ar, ay + ar * 0.55);
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.55 * flicker})`;
  nodeCtx.lineWidth = Math.max(1, 1.3 * zoom); nodeCtx.stroke();

  // Right: symmetric Gaussian
  nodeCtx.beginPath();
  for (let i = 0; i <= pts; i++) {
    const t2 = i / pts;
    const xp = rx - curveW / 2 + t2 * curveW;
    const g  = Math.exp(-Math.pow((t2 - 0.5) * 4, 2));
    const yp = midY + curveH / 2 - g * curveH;
    i === 0 ? nodeCtx.moveTo(xp, yp) : nodeCtx.lineTo(xp, yp);
  }
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.85 * flicker})`;
  nodeCtx.lineWidth = Math.max(1, 1.5 * zoom); nodeCtx.stroke();
  nodeCtx.lineTo(rx + curveW / 2, midY + curveH / 2);
  nodeCtx.lineTo(rx - curveW / 2, midY + curveH / 2);
  nodeCtx.closePath();
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.fill();

  // μ=0 σ=1 label under right bell
  const fs = Math.max(6, 8 * zoom);
  nodeCtx.font = `${fs}px Courier New`; nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'top';
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.6 * flicker})`;
  nodeCtx.fillText('μ=0  σ=1', rx, midY + curveH / 2 + 2);

  nodeCtx.restore();
}
function drawFanoutHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '130, 0, 160' : '217, 70, 239';
  const boxH   = layerTypes.fanout.h * zoom;
  const flicker = 0.84 + Math.sin(time * 3.1 + layer.id * 1.6) * 0.09
                       + Math.sin(time * 7.8 + layer.id * 0.7) * 0.04;
  const N = Math.max(1, (_connByFrom.get(layer.id) || []).length);
  const gap = Math.max(8, 11 * zoom);

  const inW  = Math.max(10, 14 * zoom), inH = Math.max(4, 6 * zoom);
  const fanH = Math.max(18, 26 * zoom);
  const outW = Math.max(7, 10 * zoom), outH = inH;
  const outGap = Math.max(3, 4 * zoom);
  const show = Math.min(N, 5);
  const rowW = show * (outW + outGap) - outGap;
  const totalH = inH + fanH + outH;
  const topY = cy - boxH / 2 - gap - totalH;

  // input rect
  nodeCtx.fillStyle   = `rgba(${colorRgb}, ${0.28 * flicker})`;
  nodeCtx.fillRect(cx - inW / 2, topY, inW, inH);
  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.75 * flicker})`;
  nodeCtx.lineWidth = 0.8; nodeCtx.strokeRect(cx - inW / 2, topY, inW, inH);

  // fan lines + output rects
  const srcY  = topY + inH;
  const dstY  = srcY + fanH;
  const ox0   = cx - rowW / 2 + outW / 2;
  for (let i = 0; i < show; i++) {
    const ox = ox0 + i * (outW + outGap);
    nodeCtx.beginPath();
    nodeCtx.moveTo(cx, srcY);
    nodeCtx.lineTo(ox, dstY);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.45 * flicker})`;
    nodeCtx.lineWidth = 0.8; nodeCtx.stroke();
    nodeCtx.fillStyle   = `rgba(${colorRgb}, ${0.22 * flicker})`;
    nodeCtx.fillRect(ox - outW / 2, dstY, outW, outH);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.60 * flicker})`;
    nodeCtx.strokeRect(ox - outW / 2, dstY, outW, outH);
  }

  // ×N label when N > 5
  if (N > 5) {
    const fs = Math.max(6, 8 * zoom);
    nodeCtx.font = `bold ${fs}px Courier New`; nodeCtx.textAlign = 'left'; nodeCtx.textBaseline = 'middle';
    nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.7 * flicker})`;
    nodeCtx.fillText(`×${N}`, cx + rowW / 2 + 3, dstY + outH / 2);
  }

  nodeCtx.restore();
}
function drawScaleHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '0, 153, 136' : '68, 255, 204';
  const boxH     = layerTypes.scale.h * zoom;
  const flicker  = 0.84 + Math.sin(time * 3.2 + layer.id * 1.7) * 0.09 + Math.sin(time * 7.5 + layer.id * 0.6) * 0.04;
  const pulse    = 0.5 + 0.5 * Math.sin(time * 2.5 + layer.id * 0.9);
  const rows = 3, cols = 4;
  const cellSize = Math.max(4, Math.min(8, 6.5 * zoom));
  const cellGap  = Math.max(1, 1.5 * zoom), cellStep = cellSize + cellGap;
  const gridW    = cols * cellStep - cellGap;
  const gridH    = rows * cellStep - cellGap;
  const symW     = Math.max(12, 18 * zoom);
  const totalW   = gridW + symW + gridW;
  const gap      = Math.max(8, 11 * zoom);
  const topY     = cy - boxH / 2 - gap - gridH;
  const aX       = cx - totalW / 2;
  const bX       = aX + gridW + symW;
  const op       = layer.op || '/';
  const factor   = layer.factor !== undefined ? String(layer.factor) : '1';

  // Input matrix
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = aX + c * cellStep, py = topY + r * cellStep;
      const v = hashF(r * 17 + layer.id, c * 31 + layer.id);
      const intensity = 0.2 + v * 0.3;
      nodeCtx.fillStyle   = `rgba(${colorRgb}, ${intensity * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
      nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.4 * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, cellSize, cellSize);
    }
  }

  // Output matrix (brightness pulsed to show scaling effect)
  const scaleMult = op === '*' ? (0.5 + pulse * 1.0) : (1.5 - pulse * 0.8);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = bX + c * cellStep, py = topY + r * cellStep;
      const v = hashF(r * 17 + layer.id, c * 31 + layer.id);
      const intensity = Math.min(0.85, (0.2 + v * 0.3) * scaleMult);
      nodeCtx.fillStyle   = `rgba(${colorRgb}, ${intensity * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
      nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.55 * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, cellSize, cellSize);
    }
  }

  // Symbol + factor in middle
  const fontSize = Math.max(8, 11 * zoom);
  nodeCtx.font = `bold ${fontSize}px Courier New`; nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
  const midY = topY + gridH / 2;
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.9 * flicker})`;
  const sym = op === '/' ? '÷' : '×';
  nodeCtx.fillText(`${sym}${factor}`, aX + gridW + symW / 2, midY);

  nodeCtx.restore();
}

function drawMatmulHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '192, 96, 0' : '255, 149, 0';
  const boxH     = layerTypes.matmul.h * zoom;
  const flicker  = 0.84 + Math.sin(time * 3.8 + layer.id * 2.3) * 0.08 + Math.sin(time * 9.0 + layer.id * 0.4) * 0.04;
  const rowsA = 4, colsA = 3; // A: (n, m)
  const rowsB = 3, colsB = 4; // B: (m, p) — colsA === rowsB
  const rowsC = 4, colsC = 4; // C: (n, p)
  const cellSize = Math.max(4, Math.min(8, 6.5 * zoom));
  const cellGap  = Math.max(1, 1.5 * zoom), cellStep = cellSize + cellGap;
  const gridAW = colsA * cellStep - cellGap, gridAH = rowsA * cellStep - cellGap;
  const gridBW = colsB * cellStep - cellGap, gridBH = rowsB * cellStep - cellGap;
  const gridCW = colsC * cellStep - cellGap, gridCH = rowsC * cellStep - cellGap;
  const symW   = Math.max(10, 14 * zoom);
  const totalW = gridAW + symW + gridBW + symW + gridCW;
  const gap    = Math.max(8, 11 * zoom);
  const topY   = cy - boxH / 2 - gap - Math.max(gridAH, gridBH, gridCH);
  const aX     = cx - totalW / 2;
  const bX     = aX + gridAW + symW;
  const cX     = bX + gridBW + symW;
  const scanRow = Math.floor(time * 4) % rowsA;
  const scanCol = Math.floor(time * 4) % colsB;

  function drawMat(ox, topY2, rows, cols, hiRow, hiCol) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = ox + c * cellStep, py = topY2 + r * cellStep;
        const hot = r === hiRow || c === hiCol;
        nodeCtx.fillStyle   = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
        if (hot) { nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.32 * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize); }
        nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(hot ? 0.75 : 0.35) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, cellSize, cellSize);
      }
    }
  }
  const midA = topY + (Math.max(gridAH, gridBH, gridCH) - gridAH) / 2;
  const midB = topY + (Math.max(gridAH, gridBH, gridCH) - gridBH) / 2;
  const midC = topY + (Math.max(gridAH, gridBH, gridCH) - gridCH) / 2;
  drawMat(aX, midA, rowsA, colsA, scanRow, -1);
  drawMat(bX, midB, rowsB, colsB, -1, scanCol);
  drawMat(cX, midC, rowsC, colsC, scanRow, scanCol);

  const fontSize = Math.max(8, 11 * zoom);
  nodeCtx.font = `bold ${fontSize}px Courier New`; nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
  const midY = topY + Math.max(gridAH, gridBH, gridCH) / 2;
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.8 * flicker})`;
  nodeCtx.fillText('@', aX + gridAW + symW / 2, midY);
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.55 * flicker})`;
  nodeCtx.fillText('=', bX + gridBW + symW / 2, midY);

  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, topY + Math.max(gridAH, gridBH, gridCH) + 4); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]); nodeCtx.restore();
}

/* --- Main draw: clear → shapes → connections → holograms → boxes --- */
function draw() {
  nodeCtx.clearRect(0, 0, W, H);
  computeOutputShapes();
  drawOrigin();
  const white = document.body.classList.contains('white-mode');
  // Region-based connection hiding via clip.
  // Leaf superboxes collapse at zoom <= 0.5; supersuperboxes (those containing
  // child superboxes) collapse at zoom <= 0.25. We punch ONLY the outermost
  // collapsed superbox in each branch: descend the tree, and the first box
  // that is collapsed becomes a single even-odd hole (we do not recurse into
  // it). Holes are spatially disjoint, so even-odd never re-reveals a nested
  // box. Result: a leaf SB hides its interior connections at 0.5; the segments
  // BETWEEN child SBs (which the leaf SBs did not hide) stay visible until the
  // enclosing supersuperbox collapses at 0.25.
  // Pre-compute superbox flags once (avoid O(s²) repeated lookups)
  const _sbChildMap  = new Map(); // sbId → child SBs
  const _sbParentMap = new Map(); // sbId → parent SB
  const _sbLayerMap  = new Map(); // layerId → shallowest containing SB
  for (const sb of superboxes) {
    if (!_sbChildMap.has(sb.id)) _sbChildMap.set(sb.id, []);
    if (sb.parentId) {
      if (!_sbChildMap.has(sb.parentId)) _sbChildMap.set(sb.parentId, []);
      _sbChildMap.get(sb.parentId).push(sb);
      _sbParentMap.set(sb.id, sb.parentId);
    }
    for (const lid of sb.layerIds) {
      if (!_sbLayerMap.has(lid)) _sbLayerMap.set(lid, sb);
    }
  }
  const _isSuper   = sb => (_sbChildMap.get(sb.id) || []).length > 0;
  const _threshold = sb => _isSuper(sb) ? 0.25 : 0.5;
  const _collapsedHoles = [];
  const _visitSb = sb => {
    if (zoom <= _threshold(sb)) { _collapsedHoles.push(sb); return; }
    for (const ch of _sbChildMap.get(sb.id) || []) _visitSb(ch);
  };
  for (const sb of superboxes) if (!sb.parentId) _visitSb(sb);
  const _sbCollapsed = _collapsedHoles.length > 0;
  // Pre-compute collapsed SB id set for O(1) lookup
  const _collapsedSbIds = new Set(_collapsedHoles.map(s => s.id));
  // A layer is hidden iff any superbox in its ancestry chain is collapsed.
  const _layerHiddenMap = new Map();
  const _layerHidden = lid => {
    if (_layerHiddenMap.has(lid)) return _layerHiddenMap.get(lid);
    let s = _sbLayerMap.get(lid);
    let hidden = false;
    while (s && !hidden) {
      if (_collapsedSbIds.has(s.id)) hidden = true;
      const pid = _sbParentMap.get(s.id);
      s = pid ? superboxes.find(x => x.id === pid) : null;
    }
    _layerHiddenMap.set(lid, hidden);
    return hidden;
  };

  // Layer-by-id map: O(1) lookup instead of O(n) layers.find per connection
  const _layerById = new Map();
  for (const _l of layers) _layerById.set(_l.id, _l);

  /* Two-pass connection drawing:
     Pass 1 — WITH clip: cross-boundary conns.
               Clip hides inside-group segments; between/outside segments visible.
     Pass 2 — NO clip:   both-visible conns.
               Always fully drawn even if Bezier curves through a group rect.
     Special: both-hidden in DIFFERENT collapsed groups → pass 1 (middle segment shown). */
  // Walk up ancestry to find the collapsed SB responsible for hiding a layer
  const _collapsedAncestor = lid => {
    let s = _sbLayerMap.get(lid);
    while (s) {
      if (_collapsedSbIds.has(s.id)) return s.id;
      const pid = _sbParentMap.get(s.id);
      s = pid ? superboxes.find(x => x.id === pid) : null;
    }
    return null;
  };
  const _crossBoundary = [], _fullyVisible = [];
  for (let ci = 0; ci < connections.length; ci++) {
    const c = connections[ci];
    const fl = _layerById.get(c.from), tl = _layerById.get(c.to);
    if (!fl || !tl) continue;
    const fH = _layerHidden(c.from), tH = _layerHidden(c.to);
    if (fH && tH) {
      // Both hidden: skip only if same collapsed ancestor (whole conn inside one group)
      if (_collapsedAncestor(c.from) !== _collapsedAncestor(c.to)) _crossBoundary.push(ci);
      continue;
    }
    if (fH || tH) _crossBoundary.push(ci); else _fullyVisible.push(ci);
  }

  function _drawConnBatch(indices, clipped) {
    if (indices.length === 0) return;
    if (clipped && _sbCollapsed) {
      nodeCtx.save();
      nodeCtx.beginPath();
      nodeCtx.rect(-1, -1, nodeCanvas.width + 2, nodeCanvas.height + 2);
      for (const sb of _collapsedHoles) {
        const [_sx, _sy] = worldToScreen(sb.x, sb.y);
        nodeCtx.rect(_sx, _sy, sb.w * zoom, sb.h * zoom);
      }
      nodeCtx.clip('evenodd');
    }
    for (const ci of indices) {
      const c         = connections[ci];
      const fromLayer = _layerById.get(c.from);
      const toLayer   = _layerById.get(c.to);
      // Viewport cull (selected conn always drawn so handles stay reachable)
      if (ci !== selectedConnIdx) {
        const [_fx, _fy] = worldToScreen(fromLayer.x, fromLayer.y);
        const [_tx, _ty] = worldToScreen(toLayer.x, toLayer.y);
        const _cm = 120;
        const _minX = Math.min(_fx, _tx) - _cm, _maxX = Math.max(_fx, _tx) + _cm;
        const _minY = Math.min(_fy, _ty) - _cm, _maxY = Math.max(_fy, _ty) + _cm;
        if (_maxX < 0 || _minX > W || _maxY < 0 || _minY > H) continue;
      }
      const path       = buildConnPath(fromLayer, toLayer, c);
      const ft         = layerTypes[fromLayer.type];
      const isSelected = ci === selectedConnIdx;
      const col        = isSelected ? (white ? 'rgba(0,0,0,0.9)' : 'rgba(255, 255, 255, 0.9)') : connGradient(path, white);
      drawPath(path, col, isSelected ? '#ffffff' : ft.color, isSelected ? 3.5 : 2);

      const _eitherInSB = _layerHidden(c.from) || _layerHidden(c.to);
      if (c.paramLabel && zoom > 0.3 && !_eitherInSB) {
        const midPt    = { x: path[1].x, y: (path[1].y + path[2].y) / 2 };
        const fontSize = Math.max(8, Math.min(11, 10 * zoom));
        nodeCtx.font = `${fontSize}px Courier New`; nodeCtx.textAlign = 'center';
        const paramColor = document.body.classList.contains('white-mode') ? '#b89000' : '#ffc800';
        const paramColorDim = document.body.classList.contains('white-mode') ? 'rgba(180, 140, 0, 0.6)' : 'rgba(255, 200, 0, 0.6)';
        if (c.paramLabelTop) {
          nodeCtx.textBaseline = 'bottom'; nodeCtx.fillStyle = paramColor;
          nodeCtx.fillText(c.paramLabelTop, midPt.x, midPt.y - 2);
        }
        nodeCtx.textBaseline = 'top'; nodeCtx.fillStyle = paramColorDim;
        nodeCtx.fillText(c.paramLabel, midPt.x, midPt.y + 2);
      }

      if (isSelected) {
        const midPt = path[1], btnR = Math.max(10, 12 * zoom);
        const bx = midPt.x + btnR + 4, by = midPt.y - btnR - 4;
        nodeCtx.beginPath(); nodeCtx.arc(bx, by, btnR, 0, Math.PI * 2);
        nodeCtx.fillStyle = 'rgba(255, 50, 50, 0.85)'; nodeCtx.fill();
        nodeCtx.strokeStyle = '#ff5050'; nodeCtx.lineWidth = 2; nodeCtx.stroke();
        nodeCtx.strokeStyle = '#fff'; nodeCtx.lineWidth = 2; nodeCtx.beginPath();
        nodeCtx.moveTo(bx - btnR * 0.4, by - btnR * 0.4); nodeCtx.lineTo(bx + btnR * 0.4, by + btnR * 0.4);
        nodeCtx.moveTo(bx + btnR * 0.4, by - btnR * 0.4); nodeCtx.lineTo(bx - btnR * 0.4, by + btnR * 0.4);
        nodeCtx.stroke();
        // ↔ drag handle
        const hx = path[1].x, hy = (path[1].y + path[2].y) / 2;
        const hr = Math.max(5, 6 * zoom);
        nodeCtx.beginPath(); nodeCtx.arc(hx, hy, hr, 0, Math.PI * 2);
        nodeCtx.fillStyle = white ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)'; nodeCtx.fill();
        nodeCtx.strokeStyle = white ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)';
        nodeCtx.lineWidth = 1.5; nodeCtx.stroke();
        const ar = Math.max(3, 3.5 * zoom);
        nodeCtx.strokeStyle = white ? 'rgba(0,0,0,0.8)' : '#fff';
        nodeCtx.lineWidth = 1.5; nodeCtx.beginPath();
        nodeCtx.moveTo(hx - ar * 2, hy); nodeCtx.lineTo(hx - ar, hy - ar * 0.6);
        nodeCtx.moveTo(hx - ar * 2, hy); nodeCtx.lineTo(hx - ar, hy + ar * 0.6);
        nodeCtx.moveTo(hx + ar * 2, hy); nodeCtx.lineTo(hx + ar, hy - ar * 0.6);
        nodeCtx.moveTo(hx + ar * 2, hy); nodeCtx.lineTo(hx + ar, hy + ar * 0.6);
        nodeCtx.stroke();
      }
    }
    if (clipped && _sbCollapsed) nodeCtx.restore();
  }

  _drawConnBatch(_crossBoundary, true);   // clipped — cross-boundary
  _drawConnBatch(_fullyVisible, false);   // unclipped — both endpoints visible


  // draw superboxes (below layers)
  drawSuperboxes(white);

  // draw collapsed fills for the outermost collapsed superboxes (under layers)
  if (_sbCollapsed) {
    for (const sb of _collapsedHoles) {
      const _colPal = white ? SUPERBOX_COLORS_LIGHT : SUPERBOX_COLORS;
      const color = _colPal[sb.colorIdx % _colPal.length];
      const [sx, sy] = worldToScreen(sb.x, sb.y);
      const sw = sb.w * zoom, sh = sb.h * zoom;
      nodeCtx.save();
      nodeCtx.globalAlpha = white ? 0.30 : 0.18;
      nodeCtx.fillStyle = color;
      nodeCtx.fillRect(sx, sy, sw, sh);
      nodeCtx.globalAlpha = 0.7;
      nodeCtx.strokeStyle = color;
      nodeCtx.lineWidth = 1.5;
      nodeCtx.strokeRect(sx, sy, sw, sh);
      nodeCtx.restore();
    }
  }

  // Pre-compute per-layer lookups once (O(n+m) total instead of O(n*m) per layer)
  const _connectedIds = new Set();
  for (const c of connections) { _connectedIds.add(c.from); _connectedIds.add(c.to); }
  // _inSuperboxIds: reuse _sbLayerMap from setup above (already populated)
  // Hologram-blocked set. Skip entirely at zoom<0.28: all hologram fns
  // guard 'if (zoom < 0.28) return' so blocked status is irrelevant.
  const _hologramBlockedIds = new Set();
  if (zoom >= 0.28) for (const layer of layers) {
    const t = layerTypes[layer.type]; if (!t) continue;
    // skip off-screen layers — hologram never drawn, blocked status irrelevant
    const [_hx, _hy] = worldToScreen(layer.x, layer.y);
    const _hm = Math.max(150, 200 * zoom);
    if (_hx + t.w * zoom / 2 + _hm < 0 || _hx - t.w * zoom / 2 - _hm > W ||
        _hy + t.h * zoom / 2 + _hm < 0 || _hy - t.h * zoom / 2 - _hm > H) continue;
    const boxTop = layer.y - t.h / 2;
    for (const other of layers) {
      if (other.id === layer.id) continue;
      const ot = layerTypes[other.type]; if (!ot) continue;
      const xOverlap = Math.abs(other.x - layer.x) < (t.w + ot.w) / 2;
      const yOverlap = other.y + ot.h / 2 > boxTop - 100 && other.y - ot.h / 2 < boxTop;
      if (xOverlap && yOverlap) { _hologramBlockedIds.add(layer.id); break; }
    }
  }

  // draw layers + holograms
  for (const l of layers) {
    const lt_dims     = layerTypes[l.type] || { w: 140, h: 70 };
    const [sx, sy]   = worldToScreen(l.x, l.y);

    // Viewport cull: skip layers entirely off-screen (with margin for holograms)
    const _margin = Math.max(150, 200 * zoom);
    if (sx + lt_dims.w * zoom / 2 + _margin < 0 || sx - lt_dims.w * zoom / 2 - _margin > W ||
        sy + lt_dims.h * zoom / 2 + _margin < 0 || sy - lt_dims.h * zoom / 2 - _margin > H) continue;

    const isConnected = _connectedIds.has(l.id);
    const inSuperbox  = _sbLayerMap.has(l.id);
    // hide layer when any superbox in its ancestry chain is collapsed
    if (inSuperbox && _layerHidden(l.id)) continue;

    if (l.type === 'input'   && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawCSVHologram(l, sx, sy, white);
    if (l.type === 'linear'  && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawNeuronHologram(l, sx, sy, white);
    if (l.type === 'linear'  && l.activation && l.activation !== 'none' && !inSuperbox) {
      const lt          = layerTypes.linear;
      const layerBottom = l.y + lt.h / 2;
      const curveBlocked = layers.some(other => {
        if (other.id === l.id) return false;
        const ot = layerTypes[other.type]; if (!ot) return false;
        return Math.abs(other.x - l.x) < (lt.w + ot.w) / 2
          && other.y - ot.h / 2 > layerBottom
          && other.y - ot.h / 2 < layerBottom + 75;
      });
      if (!curveBlocked) drawActivationCurve(l, sx, sy, white);
    }
    if (l.type === 'flatten'  && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawFlattenHologram(l, sx, sy, white);
    if (l.type === 'mean'     && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawMeanHologram(l, sx, sy, white);
    if (l.type === 'conv'     && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawConvHologram(l, sx, sy, white);
    if (l.type === 'unsqueeze' && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawUnsqueezeHologram(l, sx, sy, white);
    if (l.type === 'squeeze'   && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawSqueezeHologram(l, sx, sy, white);
    if (l.type === 'softmax'   && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawSoftmaxHologram(l, sx, sy, white);
    if (l.type === 'add'       && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawAddHologram(l, sx, sy, white);
    if (l.type === 'matmul'       && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawMatmulHologram(l, sx, sy, white);
    if (l.type === 'scale'     && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawScaleHologram(l, sx, sy, white);
    if (l.type === 'transpose' && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawTransposeHologram(l, sx, sy, white);
    if (l.type === 'layernorm' && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawLayerNormHologram(l, sx, sy, white);
    if (l.type === 'rmsnorm'   && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawRMSNormHologram(l, sx, sy, white);
    if (l.type === 'fanout'    && isConnected && !_hologramBlockedIds.has(l.id) && !inSuperbox) drawFanoutHologram(l, sx, sy, white);

    drawLayerBox(l, sx, sy);

    // multi-select highlight ring
    if (typeof selectedLayerIds !== 'undefined' && selectedLayerIds.has(l.id)) {
      const _mst = layerTypes[l.type];
      const _msw = _mst.w * zoom, _msh = _mst.h * zoom;
      const _msPulse = 0.55 + 0.45 * Math.sin(time * 5.5 + l.id * 0.9);
      nodeCtx.save();
      nodeCtx.strokeStyle = white
        ? `rgba(3, 105, 161, ${_msPulse})`
        : `rgba(56, 189, 248, ${_msPulse})`;
      nodeCtx.lineWidth = 2.5;
      nodeCtx.setLineDash([4, 3]);
      nodeCtx.strokeRect(sx - _msw / 2 - 4, sy - _msh / 2 - 4, _msw + 8, _msh + 8);
      nodeCtx.setLineDash([]);
      nodeCtx.restore();
    }

    // connect-mode highlight ring
    if (l.id === connectStartId) {
      const t = layerTypes[l.type];
      const w = t.w * zoom, h = t.h * zoom;
      const pulse = Math.sin(time * 6) * 0.3 + 0.7;
      let tColorRing = white && t.lightColor ? t.lightColor : t.color;
      if (l.type === 'custom' && l.customColor) {
        const _rcp = l.customColor.slice(1).match(/.{2}/g).map(x => parseInt(x, 16));
        tColorRing = white
          ? '#' + _rcp.map(c => Math.round(c * 0.62).toString(16).padStart(2, '0')).join('')
          : l.customColor;
      }
      const ringColor = white ? `rgba(${hexToRgb(tColorRing)}, ${pulse * 0.7})` : `rgba(${hexToRgb(tColorRing)}, ${pulse})`;
      nodeCtx.strokeStyle = ringColor;
      nodeCtx.lineWidth   = 3; nodeCtx.setLineDash([4, 4]);
      nodeCtx.strokeRect(sx - w / 2 - 6, sy - h / 2 - 6, w + 12, h + 12);
      nodeCtx.setLineDash([]);
    }
  }

  // connect-mode preview wire
  if (connectionMode && connectStartId !== null) {
    const fromLayer = layers.find(l => l.id === connectStartId);
    if (fromLayer) {
      const path = buildConnPreview(fromLayer, connectMouseX, connectMouseY, connectStartSide);
      const ft   = layerTypes[fromLayer.type];
      drawPath(path, `rgba(${hexToRgb(ft.color)}, 0.7)`, ft.color, 2, [6, 4]);
    }
  }

  // HUD updates
  document.getElementById('pos').textContent    = `${Math.round(camX)}, ${Math.round(camY)}`;
  document.getElementById('zoom').textContent   = `${zoom.toFixed(2)}x`;
  document.getElementById('sector').textContent = `${Math.floor(camX / (gridSpacing * majorEvery * 5))}-${Math.floor(camY / (gridSpacing * majorEvery * 5))}`;
  document.getElementById('lc').textContent     = layers.length;
  document.getElementById('conn-mode').style.display = connectionMode ? 'block' : 'none';
  document.getElementById('params').textContent = (window._totalParams || 0).toLocaleString();
  if (!connectionMode) document.body.style.cursor = 'crosshair';
}
