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

  octx.strokeStyle = 'rgba(0, 255, 136, 0.06)'; octx.lineWidth = 0.5; octx.beginPath();
  for (let gx = sGX; gx <= eGX; gx++) { const [sx] = worldToScreen(gx * gridSpacing, 0); octx.moveTo(sx, 0); octx.lineTo(sx, H); }
  for (let gy = sGY; gy <= eGY; gy++) { const [, sy] = worldToScreen(0, gy * gridSpacing); octx.moveTo(0, sy); octx.lineTo(W, sy); }
  octx.stroke();

  octx.strokeStyle = 'rgba(0, 136, 255, 0.15)'; octx.lineWidth = 1; octx.beginPath();
  for (let gx = sGX; gx <= eGX; gx++) { if (gx % majorEvery !== 0) continue; const [sx] = worldToScreen(gx * gridSpacing, 0); octx.moveTo(sx, 0); octx.lineTo(sx, H); }
  for (let gy = sGY; gy <= eGY; gy++) { if (gy % majorEvery !== 0) continue; const [, sy] = worldToScreen(0, gy * gridSpacing); octx.moveTo(0, sy); octx.lineTo(W, sy); }
  octx.stroke();

  const superEvery = majorEvery * 5;
  octx.strokeStyle = 'rgba(0, 136, 255, 0.3)'; octx.lineWidth = 1.5; octx.beginPath();
  for (let gx = sGX; gx <= eGX; gx++) { if (gx % superEvery !== 0) continue; const [sx] = worldToScreen(gx * gridSpacing, 0); octx.moveTo(sx, 0); octx.lineTo(sx, H); }
  for (let gy = sGY; gy <= eGY; gy++) { if (gy % superEvery !== 0) continue; const [, sy] = worldToScreen(0, gy * gridSpacing); octx.moveTo(0, sy); octx.lineTo(W, sy); }
  octx.stroke();

  const dotSize = Math.max(1, 2 * zoom);
  for (let gx = sGX; gx <= eGX; gx++) {
    if (gx % majorEvery !== 0) continue;
    for (let gy = sGY; gy <= eGY; gy++) {
      if (gy % majorEvery !== 0) continue;
      const [sx, sy] = worldToScreen(gx * gridSpacing, gy * gridSpacing);
      const h = hash(gx, gy);
      const alpha = 0.15 + (((h >> 24) & 0xFF) / 255) * 0.35;
      octx.fillStyle = `rgba(0, 255, 136, ${alpha})`;
      octx.fillRect(sx - dotSize / 2, sy - dotSize / 2, dotSize, dotSize);
    }
  }

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
  const pulse      = Math.sin(time * 2 + layer.id) * 0.15 + 0.85;
  const isSelected = layer.id === selectedLayerId;
  const alpha      = isSelected ? 1 : pulse;
  const x = cx - w / 2, y = cy - h / 2;

  nodeCtx.fillStyle = t.bg;
  nodeCtx.fillRect(x, y, w, h);

  const borderColor = isSelected
    ? `rgba(255, 255, 255, ${alpha})`
    : `rgba(${hexToRgb(t.color)}, ${alpha})`;
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
    nodeCtx.fillStyle    = borderColor;
    nodeCtx.textAlign    = 'center';
    nodeCtx.textBaseline = 'middle';
    nodeCtx.fillText(layer.type.toUpperCase(), cx, cy - (zoom > 0.4 ? 6 * zoom : 0));

    if (zoom > 0.4) {
      const subSize = Math.max(7, 9 * zoom);
      nodeCtx.font      = `${subSize}px Courier New`;
      nodeCtx.fillStyle = `rgba(${hexToRgb(t.color)}, ${0.5 * alpha})`;

      if (layer.type === 'input') {
        nodeCtx.fillText((layer.dims || []).join('x') || '?', cx, cy + 10 * zoom);

      } else if (layer.type === 'linear') {
        const inc      = connections.filter(c => c.to === layer.id);
        const srcShape = inc.length > 0 ? shapeCache[inc[0].from] : null;
        const inF      = srcShape ? srcShape[srcShape.length - 1] : '?';
        const prefix   = inc.length > 1 ? `${inc.length}× ` : '';
        const actTag   = layer.activation && layer.activation !== 'none' ? ` · ${layer.activation}` : '';
        nodeCtx.fillText(`${prefix}${inF} → ${layer.units || '?'}${actTag}`, cx, cy + 10 * zoom);

      } else if (layer.type === 'shared_dense') {
        const inc = connections.filter(c => c.to === layer.id);
        const inF = inc.length > 0 ? getLayerOutputLabel(inc[0].from) : '?';
        nodeCtx.fillText(`${inc.length}×[${inF}→${layer.units || '?'}]`, cx, cy + 10 * zoom);

      } else if (layer.type === 'flatten') {
        const outShape = shapeCache[layer.id];
        const sd = layer.start_dim !== undefined ? layer.start_dim : 0;
        const ed = layer.end_dim   !== undefined ? layer.end_dim   : -1;
        nodeCtx.fillText(outShape ? `[${outShape.join(', ')}]` : `${sd} : ${ed}`, cx, cy + 10 * zoom);

      } else if (layer.type === 'mean') {
        const outShape = shapeCache[layer.id];
        const dimStr   = Array.isArray(layer.reduce_dim)
          ? layer.reduce_dim.join(',')
          : (layer.reduce_dim !== undefined ? String(layer.reduce_dim) : '0');
        const kdStr    = layer.keepdim ? ' kd' : '';
        nodeCtx.fillText(
          outShape ? `dim=${dimStr}${kdStr} → [${outShape.join(', ')}]` : `dim=${dimStr}${kdStr}`,
          cx, cy + 10 * zoom
        );

      } else if (layer.type === 'output') {
        const shape = layer.outputShape;
        nodeCtx.fillText(shape ? `shape: [${shape.join(', ')}]` : '[ NO CONNECTION ]', cx, cy + 10 * zoom);
      }
    }
  }

  // port dots
  if (zoom > 0.3) {
    const pr = Math.max(2, 3 * zoom);
    nodeCtx.beginPath(); nodeCtx.arc(x, cy, pr, 0, Math.PI * 2);
    nodeCtx.fillStyle = `rgba(${hexToRgb(t.color)}, ${0.7 * alpha})`; nodeCtx.fill();
    if (layer.type !== 'output') {
      nodeCtx.beginPath(); nodeCtx.arc(x + w, cy, pr, 0, Math.PI * 2);
      nodeCtx.fillStyle = `rgba(${hexToRgb(t.color)}, ${0.7 * alpha})`; nodeCtx.fill();
    }
  }

  // connection count badges
  if (zoom > 0.25) {
    const inCount   = connections.filter(c => c.to   === layer.id).length;
    const outCount  = connections.filter(c => c.from === layer.id).length;
    const badgeSize = Math.max(8, 12 * zoom);
    const badgeY    = y - badgeSize / 2 - 4;
    if (inCount > 0) {
      nodeCtx.beginPath(); nodeCtx.arc(x - badgeSize - 2, badgeY + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
      nodeCtx.fillStyle = `rgba(${hexToRgb('#ff4444')}, ${0.8 * alpha})`; nodeCtx.fill();
      if (zoom > 0.4) {
        nodeCtx.font = `bold ${Math.max(6, 8 * zoom)}px Courier New`; nodeCtx.fillStyle = '#fff';
        nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
        nodeCtx.fillText(inCount, x - badgeSize - 2, badgeY + badgeSize / 2);
      }
    }
    if (outCount > 0 && layer.type !== 'output') {
      nodeCtx.beginPath(); nodeCtx.arc(x + w + badgeSize + 2, badgeY + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
      nodeCtx.fillStyle = `rgba(${hexToRgb('#44ff44')}, ${0.8 * alpha})`; nodeCtx.fill();
      if (zoom > 0.4) {
        nodeCtx.font = `bold ${Math.max(6, 8 * zoom)}px Courier New`; nodeCtx.fillStyle = '#fff';
        nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
        nodeCtx.fillText(outCount, x + w + badgeSize + 2, badgeY + badgeSize / 2);
      }
    }
  }
}

/* --- CSV hologram for INPUT layers --- */
function drawCSVHologram(layer, cx, cy) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = 0.38;

  const cols = 4, dataRows = 3;
  const cellW  = Math.max(28, 44 * zoom), cellH = Math.max(13, 17 * zoom);
  const tableW = cellW * cols, tableH = cellH * (dataRows + 1);
  const boxH   = layerTypes.input.h * zoom;
  const tx     = cx - tableW / 2;
  const ty     = cy - boxH / 2 - tableH - Math.max(8, 14 * zoom);
  const flicker = 0.82 + Math.sin(time * 4.3 + layer.id * 1.7) * 0.09 + Math.sin(time * 11 + layer.id) * 0.04;

  nodeCtx.save(); nodeCtx.shadowColor = '#00ff88'; nodeCtx.shadowBlur = 10 * zoom * flicker;
  nodeCtx.fillStyle   = `rgba(0, 18, 12, ${0.82 * flicker})`; nodeCtx.fillRect(tx, ty, tableW, tableH);
  nodeCtx.fillStyle   = `rgba(0, 255, 136, ${0.07 * flicker})`; nodeCtx.fillRect(tx, ty, tableW, cellH);
  nodeCtx.strokeStyle = `rgba(0, 255, 136, ${0.55 * flicker})`; nodeCtx.lineWidth = 1; nodeCtx.strokeRect(tx, ty, tableW, tableH);
  nodeCtx.restore();

  nodeCtx.strokeStyle = `rgba(0, 255, 136, ${0.13 * flicker})`; nodeCtx.lineWidth = 0.5;
  for (let r = 1; r <= dataRows; r++) { nodeCtx.beginPath(); nodeCtx.moveTo(tx, ty + cellH * r); nodeCtx.lineTo(tx + tableW, ty + cellH * r); nodeCtx.stroke(); }
  for (let c = 1; c < cols; c++)      { nodeCtx.beginPath(); nodeCtx.moveTo(tx + cellW * c, ty); nodeCtx.lineTo(tx + cellW * c, ty + tableH); nodeCtx.stroke(); }

  const fontSize = Math.max(7, 8.5 * zoom);
  nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'middle';
  nodeCtx.font = `bold ${fontSize}px Courier New`;
  for (let c = 0; c < cols; c++) {
    const label = c < cols - 1 ? `f_${c}` : '...';
    nodeCtx.fillStyle = c < cols - 1 ? `rgba(0, 255, 136, ${0.9 * flicker})` : `rgba(0, 255, 136, ${0.35 * flicker})`;
    nodeCtx.fillText(label, tx + cellW * c + cellW / 2, ty + cellH / 2);
  }
  nodeCtx.font = `${fontSize}px Courier New`;
  for (let r = 0; r < dataRows; r++) {
    const rowFade = (0.38 + (dataRows - r) / dataRows * 0.38) * flicker;
    for (let c = 0; c < cols - 1; c++) {
      const v = (hashF(layer.id * 53 + c * 7, r * 13 + 3) * 2 - 1).toFixed(2);
      nodeCtx.fillStyle = `rgba(0, 210, 255, ${rowFade})`;
      nodeCtx.fillText(v, tx + cellW * c + cellW / 2, ty + cellH * (r + 1) + cellH / 2);
    }
    nodeCtx.fillStyle = `rgba(0, 255, 136, ${0.22 * flicker})`;
    nodeCtx.fillText('…', tx + cellW * (cols - 1) + cellW / 2, ty + cellH * (r + 1) + cellH / 2);
  }

  // scanlines
  nodeCtx.save(); nodeCtx.globalAlpha = 0.06 * flicker;
  for (let sy2 = ty; sy2 < ty + tableH; sy2 += 3) { nodeCtx.fillStyle = '#000'; nodeCtx.fillRect(tx, sy2, tableW, 1.2); }
  nodeCtx.restore();

  nodeCtx.font = `${Math.max(6, 7.5 * zoom)}px Courier New`; nodeCtx.textAlign = 'left'; nodeCtx.textBaseline = 'bottom';
  nodeCtx.fillStyle = `rgba(0, 255, 136, ${0.38 * flicker})`; nodeCtx.fillText('data.csv', tx + 2, ty - 2);

  nodeCtx.strokeStyle = `rgba(0, 255, 136, ${0.2 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, ty + tableH); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]); nodeCtx.restore();
}

/* --- Neuron column hologram for LINEAR layers --- */
function drawNeuronHologram(layer, cx, cy, colorRgbOverride) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = 0.38;

  const neuronR  = Math.max(6, 10 * zoom);
  const spacing  = Math.max(22, 34 * zoom);
  const lineLen  = Math.max(18, 28 * zoom);
  const colorRgb = colorRgbOverride || '0, 136, 255';
  const boxH     = layerTypes.linear.h * zoom;
  const topY     = cy - boxH / 2 - Math.max(12, 18 * zoom) - 2 * spacing;
  const flicker  = 0.84 + Math.sin(time * 3.9 + layer.id * 2.3) * 0.08 + Math.sin(time * 10.1 + layer.id * 0.7) * 0.04;
  const ys       = [topY, topY + spacing, topY + spacing * 2];

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
    nodeCtx.fillStyle   = `rgba(0, 18, 45, ${0.9 * flicker})`; nodeCtx.fill();
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.8 * flicker})`; nodeCtx.lineWidth = 1.5; nodeCtx.stroke(); nodeCtx.restore();
    nodeCtx.beginPath(); nodeCtx.arc(cx, ny, neuronR * 0.3, 0, Math.PI * 2);
    nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.6 * flicker})`; nodeCtx.fill();
  }

  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, ys[2] + neuronR + 4); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]); nodeCtx.restore();
}

/* --- Flatten hologram: matrix → 1D strip animation --- */
function drawFlattenHologram(layer, cx, cy) {
  if (zoom < 0.28) return;

  const colorRgb  = '255, 200, 0';
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
      nodeCtx.fillStyle   = hot ? `rgba(${colorRgb}, ${0.5 * flicker})` : `rgba(${colorRgb}, ${0.08 * flicker})`; nodeCtx.fillRect(px, py, cellSize, cellSize);
      nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(hot ? 0.9 : 0.28) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, py, cellSize, cellSize);
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
    nodeCtx.fillStyle   = hot ? `rgba(${colorRgb}, ${0.5 * flicker})` : `rgba(${colorRgb}, ${0.08 * flicker})`; nodeCtx.fillRect(px, stripY, cellSize, cellSize);
    nodeCtx.strokeStyle = `rgba(${colorRgb}, ${(hot ? 0.9 : 0.22) * flicker})`; nodeCtx.lineWidth = 0.5; nodeCtx.strokeRect(px, stripY, cellSize, cellSize);
  }

  nodeCtx.font = `${Math.max(6, 7.5 * zoom)}px Courier New`; nodeCtx.textAlign = 'center'; nodeCtx.textBaseline = 'bottom';
  nodeCtx.fillStyle = `rgba(${colorRgb}, ${0.4 * flicker})`; nodeCtx.fillText('flatten', cx, topY - 3);

  nodeCtx.strokeStyle = `rgba(${colorRgb}, ${0.18 * flicker})`; nodeCtx.lineWidth = 0.5;
  nodeCtx.setLineDash([3, 4]); nodeCtx.beginPath(); nodeCtx.moveTo(cx, stripY + cellSize + 4); nodeCtx.lineTo(cx, cy - boxH / 2); nodeCtx.stroke();
  nodeCtx.setLineDash([]);
}

/* --- Activation curve hologram for LINEAR layers --- */
function drawActivationCurve(layer, cx, cy) {
  if (zoom < 0.3) return;
  const act = layer.activation;
  if (!act || act === 'none') return;

  const colorRgb = '0, 136, 255';
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
  ghostEl.style.display    = 'block';
  ghostEl.style.left       = (sx - w / 2) + 'px';
  ghostEl.style.top        = (sy - h / 2) + 'px';
  ghostEl.style.width      = w + 'px';
  ghostEl.style.height     = h + 'px';
  ghostEl.style.border     = `1.5px dashed ${t.color}`;
  ghostEl.style.borderRadius = '4px';
  ghostEl.style.opacity    = '0.6';
  ghostEl.style.boxShadow  = `0 0 15px ${t.glow}44`;
  ghostEl.style.background = t.bg.replace('0.9', '0.3');
  const fontSize = Math.max(9, 12 * zoom);
  ghostEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:${t.color};font-family:Courier New;font-size:${fontSize}px;font-weight:bold;">${paletteDragType.toUpperCase()}</div>`;
}
function hideGhost() { ghostEl.style.display = 'none'; }

/* --- Main draw: clear → shapes → connections → holograms → boxes --- */
function draw() {
  nodeCtx.clearRect(0, 0, W, H);
  computeOutputShapes();
  drawOrigin();

  // draw connections
  for (let ci = 0; ci < connections.length; ci++) {
    const c         = connections[ci];
    const fromLayer = layers.find(l => l.id === c.from);
    const toLayer   = layers.find(l => l.id === c.to);
    if (!fromLayer || !toLayer) continue;

    const path       = buildConnPath(fromLayer, toLayer);
    const ft         = layerTypes[fromLayer.type];
    const isSelected = ci === selectedConnIdx;
    const col        = isSelected ? 'rgba(255, 255, 255, 0.9)' : `rgba(${hexToRgb(ft.color)}, 0.4)`;
    drawPath(path, col, isSelected ? '#ffffff' : ft.color, isSelected ? 3.5 : 2);

    if (c.paramLabel && zoom > 0.3) {
      const midPt    = path[1];
      const fontSize = Math.max(8, Math.min(11, 10 * zoom));
      nodeCtx.font = `${fontSize}px Courier New`; nodeCtx.textAlign = 'center';
      if (c.paramLabelTop) {
        nodeCtx.textBaseline = 'bottom'; nodeCtx.fillStyle = '#ffc800';
        nodeCtx.fillText(c.paramLabelTop, midPt.x, midPt.y - 10);
      }
      nodeCtx.textBaseline = 'top'; nodeCtx.fillStyle = 'rgba(255, 200, 0, 0.6)';
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

  // draw layers + holograms
  for (const l of layers) {
    const [sx, sy]   = worldToScreen(l.x, l.y);
    const isConnected = connections.some(c => c.from === l.id || c.to === l.id);

    if (l.type === 'input'   && isConnected && !isHologramBlocked(l)) drawCSVHologram(l, sx, sy);
    if (l.type === 'linear'  && isConnected && !isHologramBlocked(l)) drawNeuronHologram(l, sx, sy);
    if (l.type === 'linear'  && l.activation && l.activation !== 'none') {
      const lt          = layerTypes.linear;
      const layerBottom = l.y + lt.h / 2;
      const curveBlocked = layers.some(other => {
        if (other.id === l.id) return false;
        const ot = layerTypes[other.type]; if (!ot) return false;
        return Math.abs(other.x - l.x) < (lt.w + ot.w) / 2
          && other.y - ot.h / 2 > layerBottom
          && other.y - ot.h / 2 < layerBottom + 75;
      });
      if (!curveBlocked) drawActivationCurve(l, sx, sy);
    }
    if (l.type === 'flatten' && isConnected && !isHologramBlocked(l)) drawFlattenHologram(l, sx, sy);

    drawLayerBox(l, sx, sy);

    // connect-mode highlight ring
    if (l.id === connectStartId) {
      const t = layerTypes[l.type];
      const w = t.w * zoom, h = t.h * zoom;
      const pulse = Math.sin(time * 6) * 0.3 + 0.7;
      nodeCtx.strokeStyle = `rgba(${hexToRgb(t.color)}, ${pulse})`;
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
