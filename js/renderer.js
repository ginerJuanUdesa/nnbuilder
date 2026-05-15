/* ============================================================
   renderer.js — all canvas drawing functions
   ============================================================ */

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
function getPortPos(layer) {
  return { x: layer.x + layerTypes[layer.type].w / 2, y: layer.y };
}
function getInputPortPos(layer) {
  return { x: layer.x - layerTypes[layer.type].w / 2, y: layer.y };
}

function buildConnPath(fromLayer, toLayer) {
  const out = getPortPos(fromLayer);
  const inp = getInputPortPos(toLayer);
  const [sx1, sy1] = worldToScreen(out.x, out.y);
  const [sx2, sy2] = worldToScreen(inp.x, inp.y);
  const midX = (sx1 + sx2) / 2;
  return [{ x: sx1, y: sy1 }, { x: midX, y: sy1 }, { x: midX, y: sy2 }, { x: sx2, y: sy2 }];
}

function buildConnPreview(fromLayer, mouseSx, mouseSy) {
  const out = getPortPos(fromLayer);
  const [sx1, sy1] = worldToScreen(out.x, out.y);
  const midX = (sx1 + mouseSx) / 2;
  return [{ x: sx1, y: sy1 }, { x: midX, y: sy1 }, { x: midX, y: mouseSy }, { x: mouseSx, y: mouseSy }];
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

  const tColor = white && t.lightColor ? t.lightColor : t.color;
  let fillStyle = t.bg;
  if (white) {
    const bgMap = {
      input:   'rgba(210, 242, 224, 0.97)',
      linear:  'rgba(210, 228, 255, 0.97)',
      flatten: 'rgba(255, 242, 195, 0.97)',
      output:  'rgba(238, 210, 255, 0.97)',
      mean:    'rgba(255, 228, 200, 0.97)',
      conv:    'rgba(200, 238, 244, 0.97)',
      unsqueeze: 'rgba(248, 220, 238, 0.97)',
      squeeze:   'rgba(238, 220, 255, 0.97)',
      softmax:   'rgba(255, 220, 220, 0.97)',
      add:       'rgba(230, 255, 210, 0.97)',
      bmm:       'rgba(255, 235, 200, 0.97)',
    };
    fillStyle = bgMap[layer.type] || fillStyle;
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
      : layer.type.toUpperCase();
    const label = layer.name ? `${baseLabel}:${layer.name}` : baseLabel;
    const labelFits = nodeCtx.measureText(label).width <= t.w * zoom - 8;
    const displayLabel = labelFits ? label : baseLabel + (layer.name ? ':' + layer.name.slice(0, Math.max(1, Math.floor((t.w * zoom - 8 - nodeCtx.measureText(baseLabel + ':').width) / (nodeCtx.measureText('m').width)))) + '…' : '');
    nodeCtx.fillText(displayLabel, cx, cy - (zoom > 0.4 ? 6 * zoom : 0));

    if (zoom > 0.4) {
      const subSize = Math.max(7, 9 * zoom);
      const subFontStr = `${white ? 'bold ' : ''}${subSize}px Courier New`;
      nodeCtx.font      = subFontStr;
      nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, ${0.55 * alpha})`;

      const boxHalfW = t.w / 2 * zoom - 6; // 6px padding on each side
      const baseY = cy + 10 * zoom;

      if (layer.type === 'input') {
        const dispDims = getDisplayShape(layer.id);
        const text = dispDims && dispDims.length > 0 ? `[${dispDims.join(', ')}]` : '?';
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'linear') {
        const inc      = connections.filter(c => c.to === layer.id);
        const srcDisp  = inc.length > 0 ? getDisplayShape(inc[0].from) : null;
        const inF      = srcDisp ? srcDisp[srcDisp.length - 1] : '?';
        const prefix   = inc.length > 1 ? `${inc.length}× ` : '';
        const actTag   = layer.activation && layer.activation !== 'none' ? ` · ${layer.activation}` : '';
        const text = `${prefix}${inF} → ${layer.units || '?'}${actTag}`;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'shared_dense') {
        const inc = connections.filter(c => c.to === layer.id);
        const inF = inc.length > 0 ? getLayerOutputLabel(inc[0].from) : '?';
        const text = `${inc.length}×[${inF}→${layer.units || '?'}]`;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'flatten') {
        const outShape = shapeCache[layer.id];
        const sd = layer.start_dim !== undefined ? layer.start_dim : 0;
        const ed = layer.end_dim   !== undefined ? layer.end_dim   : -1;
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const text = dispShape ? `[${dispShape.join(', ')}]` : `${sd} : ${ed}`;
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
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'add') {
        const inc = connections.filter(cc => cc.to === layer.id);
        const outShape = shapeCache[layer.id];
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const status = inc.length === 0 ? 'no inputs'
          : !outShape ? 'incompatible shapes!'
          : `${inc.length}× [${dispShape ? dispShape.join(', ') : outShape.join(', ')}]`;
        nodeCtx.fillStyle = (!outShape && inc.length > 0) ? '#ff4444' : (white ? tColor : `rgba(${hexToRgb(tColor)}, 0.55)`);
        nodeCtx.measureText(status).width > boxHalfW * 2
          ? wrapText(status, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(status, cx, baseY);

      } else if (layer.type === 'softmax') {
        const outShape = shapeCache[layer.id];
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const dim = layer.dim !== undefined ? layer.dim : -1;
        const text = dispShape ? `dim=${dim} → [${dispShape.join(', ')}]` : `dim=${dim}`;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'unsqueeze') {
        const outShape = shapeCache[layer.id];
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const dim = layer.dim !== undefined ? layer.dim : 0;
        const text = dispShape ? `dim=${dim} → [${dispShape.join(', ')}]` : `dim=${dim}`;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'squeeze') {
        const outShape = shapeCache[layer.id];
        const dispShape = outShape ? getDisplayShape(layer.id) : null;
        const dimVal = layer.dim !== undefined && layer.dim !== null && layer.dim !== '' ? layer.dim : 'all';
        const text = dispShape ? `dim=${dimVal} → [${dispShape.join(', ')}]` : `dim=${dimVal}`;
        nodeCtx.measureText(text).width > boxHalfW * 2
          ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(text, cx, baseY);

      } else if (layer.type === 'bmm') {
        const inc = connections.filter(cc => cc.to === layer.id);
        const dispShape = getDisplayShape(layer.id);
        const shA = inc.length > 0 ? getDisplayShape(inc[0].from) : null;
        const shB = inc.length > 1 ? getDisplayShape(inc[1].from) : null;
        const fmtS = s => s ? `[${s.join(', ')}]` : '?';
        const compatible = !!shapeCache[layer.id];
        const status = inc.length < 2 ? 'needs 2 inputs'
          : !compatible ? 'inner dim mismatch!'
          : `${fmtS(shA)} @ ${fmtS(shB)}`;
        nodeCtx.fillStyle = (!compatible && inc.length >= 2) ? '#ff4444' : (white ? tColor : `rgba(${hexToRgb(tColor)}, 0.55)`);
        nodeCtx.measureText(status).width > boxHalfW * 2
          ? wrapText(status, cx, baseY, boxHalfW * 2, subFontStr)
          : nodeCtx.fillText(status, cx, baseY);

      } else if (layer.type === 'output') {
        const dispShape = getDisplayShape(layer.id);
        const text = dispShape ? `shape: [${dispShape.join(', ')}]` : '[ NO CONNECTION ]';
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
    const inCount   = connections.filter(c => c.to   === layer.id).length;
    const outCount  = connections.filter(c => c.from === layer.id).length;
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
  if (!superboxes.length && !(drawMode && _sbDrawStart && _sbDrawCurrent)) return;
  for (let i = 0; i < superboxes.length; i++) {
    const sb = superboxes[i];
    const color = SUPERBOX_COLORS[sb.colorIdx % SUPERBOX_COLORS.length];
    const [sx, sy] = worldToScreen(sb.x, sb.y);
    const sw = sb.w * zoom, sh = sb.h * zoom;
    const isSelected = sb.id === selectedSuperboxId;

    // fill
    nodeCtx.save();
    nodeCtx.globalAlpha = white ? 0.07 : 0.08;
    nodeCtx.fillStyle = color;
    nodeCtx.fillRect(sx, sy, sw, sh);
    nodeCtx.restore();

    // border
    nodeCtx.save();
    nodeCtx.globalAlpha = isSelected ? 0.9 : 0.45;
    nodeCtx.strokeStyle = color;
    nodeCtx.lineWidth = isSelected ? 2 : 1;
    if (!isSelected) nodeCtx.setLineDash([6, 4]);
    nodeCtx.strokeRect(sx, sy, sw, sh);
    nodeCtx.setLineDash([]);
    nodeCtx.restore();

    // name label (top-left)
    if (sb.name && zoom > 0.3) {
      const fontSize = Math.max(20, 39 * zoom);
      nodeCtx.save();
      nodeCtx.globalAlpha = isSelected ? 0.95 : 0.65;
      nodeCtx.font = `bold ${fontSize}px Courier New`;
      nodeCtx.fillStyle = color;
      nodeCtx.textAlign = 'left';
      nodeCtx.textBaseline = 'bottom';
      nodeCtx.fillText(sb.name, sx + 6, sy - 3);
      nodeCtx.restore();
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
}

/* --- BMM hologram: two tall matrices with @ symbol → result --- */
function drawBmmHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? '192, 96, 0' : '255, 149, 0';
  const boxH     = layerTypes.bmm.h * zoom;
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

  // draw connections
  for (let ci = 0; ci < connections.length; ci++) {
    const c         = connections[ci];
    const fromLayer = layers.find(l => l.id === c.from);
    const toLayer   = layers.find(l => l.id === c.to);
    if (!fromLayer || !toLayer) continue;

    const path       = buildConnPath(fromLayer, toLayer);
    const ft         = layerTypes[fromLayer.type];
    const isSelected = ci === selectedConnIdx;
    const connAlpha  = white ? 0.75 : 0.4;
    const col        = isSelected ? (white ? 'rgba(0,0,0,0.9)' : 'rgba(255, 255, 255, 0.9)') : `rgba(${hexToRgb(white ? ft.lightColor || ft.color : ft.color)}, ${connAlpha})`;
    drawPath(path, col, isSelected ? '#ffffff' : ft.color, isSelected ? 3.5 : 2);

    if (c.paramLabel && zoom > 0.3) {
      const midPt    = { x: path[1].x, y: (path[1].y + path[2].y) / 2 };
      const fontSize = Math.max(8, Math.min(11, 10 * zoom));
      nodeCtx.font = `${fontSize}px Courier New`; nodeCtx.textAlign = 'center';
      const paramColor = document.body.classList.contains('white-mode') ? '#b89000' : '#ffc800';
      const paramColorDim = document.body.classList.contains('white-mode') ? 'rgba(180, 140, 0, 0.6)' : 'rgba(255, 200, 0, 0.6)';
      if (c.paramLabelTop) {
        nodeCtx.textBaseline = 'bottom'; nodeCtx.fillStyle = paramColor;
        nodeCtx.fillText(c.paramLabelTop, midPt.x, midPt.y - 10);
      }
      nodeCtx.textBaseline = 'top'; nodeCtx.fillStyle = paramColorDim;
      nodeCtx.fillText(c.paramLabel, midPt.x, midPt.y + 14);
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
    }
  }

  // draw superboxes (below layers)
  drawSuperboxes(white);

  // draw superbox collapsed fills when zoomed out (before layers so they're under)
  const SB_COLLAPSE_ZOOM = 0.35;
  if (zoom < SB_COLLAPSE_ZOOM) {
    for (const sb of superboxes) {
      const color = SUPERBOX_COLORS[sb.colorIdx % SUPERBOX_COLORS.length];
      const [sx, sy] = worldToScreen(sb.x, sb.y);
      const sw = sb.w * zoom, sh = sb.h * zoom;
      nodeCtx.save();
      nodeCtx.globalAlpha = white ? 0.22 : 0.18;
      nodeCtx.fillStyle = color;
      nodeCtx.fillRect(sx, sy, sw, sh);
      nodeCtx.globalAlpha = 0.7;
      nodeCtx.strokeStyle = color;
      nodeCtx.lineWidth = 1.5;
      nodeCtx.strokeRect(sx, sy, sw, sh);
      if (sb.name) {
        const fs = Math.max(8, 11 * zoom);
        nodeCtx.font = `bold ${fs}px Courier New`;
        nodeCtx.fillStyle = color;
        nodeCtx.globalAlpha = 0.9;
        nodeCtx.textAlign = 'center';
        nodeCtx.textBaseline = 'middle';
        nodeCtx.fillText(sb.name, sx + sw / 2, sy + sh / 2);
      }
      nodeCtx.restore();
    }
  }

  // draw layers + holograms
  for (const l of layers) {
    const [sx, sy]   = worldToScreen(l.x, l.y);
    const isConnected = connections.some(c => c.from === l.id || c.to === l.id);
    const inSuperbox  = superboxes.some(sb => sb.layerIds.includes(l.id));
    // when zoomed out, hide layers inside superboxes (show collapsed superbox instead)
    if (inSuperbox && zoom < SB_COLLAPSE_ZOOM) continue;

    if (l.type === 'input'   && isConnected && !isHologramBlocked(l) && !inSuperbox) drawCSVHologram(l, sx, sy, white);
    if (l.type === 'linear'  && isConnected && !isHologramBlocked(l) && !inSuperbox) drawNeuronHologram(l, sx, sy, white);
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
    if (l.type === 'flatten'  && isConnected && !isHologramBlocked(l) && !inSuperbox) drawFlattenHologram(l, sx, sy, white);
    if (l.type === 'mean'     && isConnected && !isHologramBlocked(l) && !inSuperbox) drawMeanHologram(l, sx, sy, white);
    if (l.type === 'conv'     && isConnected && !isHologramBlocked(l) && !inSuperbox) drawConvHologram(l, sx, sy, white);
    if (l.type === 'unsqueeze' && isConnected && !isHologramBlocked(l) && !inSuperbox) drawUnsqueezeHologram(l, sx, sy, white);
    if (l.type === 'squeeze'   && isConnected && !isHologramBlocked(l) && !inSuperbox) drawSqueezeHologram(l, sx, sy, white);
    if (l.type === 'softmax'   && isConnected && !isHologramBlocked(l) && !inSuperbox) drawSoftmaxHologram(l, sx, sy, white);
    if (l.type === 'add'       && isConnected && !isHologramBlocked(l) && !inSuperbox) drawAddHologram(l, sx, sy, white);
    if (l.type === 'bmm'       && isConnected && !isHologramBlocked(l) && !inSuperbox) drawBmmHologram(l, sx, sy, white);

    drawLayerBox(l, sx, sy);

    // connect-mode highlight ring
    if (l.id === connectStartId) {
      const t = layerTypes[l.type];
      const w = t.w * zoom, h = t.h * zoom;
      const pulse = Math.sin(time * 6) * 0.3 + 0.7;
      const tColorRing = white && t.lightColor ? t.lightColor : t.color;
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
      const path = buildConnPreview(fromLayer, connectMouseX, connectMouseY);
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
