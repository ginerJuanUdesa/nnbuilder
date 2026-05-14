/* ============================================================
   interactions.js — all mouse / keyboard event handlers
   ============================================================ */

/* --- Palette drag --- */
document.querySelectorAll('.palette-item').forEach(item => {
  item.addEventListener('mousedown', e => {
    e.preventDefault(); e.stopPropagation();
    paletteDragType = item.dataset.type;
    item.classList.add('dragging');
    ghostEl._paletteSource = item;
  });
});

/* --- Mouse down --- */
window.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (paletteDragType) return;
  if (propEditor.contains(e.target)) return;

  mouseDownX = e.clientX; mouseDownY = e.clientY; mouseDownDist = 0;

  // ── connection mode ──
  if (connectionMode) {
    selectedConnIdx = -1;
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const hit = hitTestLayer(wx, wy);
    if (hit) {
      if (connectStartId === null) {
        connectStartId = hit.id;
      } else {
        const fromLayer = layers.find(l => l.id === connectStartId);
        if (fromLayer && canConnect(fromLayer, hit)) {
          connections.push({ from: connectStartId, to: hit.id });
          saveState();
        }
        connectStartId = null;
      }
      return;
    }
    panDragging = true; panStartX = e.clientX; panStartY = e.clientY; panCamX = camX; panCamY = camY;
    document.body.style.cursor = 'grabbing';
    return;
  }

  // ── normal mode: try layer first ──
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);
  const hit = hitTestLayer(wx, wy);
  if (hit) {
    selectedLayerId = hit.id; selectedConnIdx = -1;
    layerDragging   = true;   layerDragId     = hit.id;
    layerDragOffX   = wx - hit.x; layerDragOffY = wy - hit.y;
    layerDragOrigX  = hit.x; layerDragOrigY  = hit.y;
    document.body.style.cursor = 'move';
    return;
  }

  // ── try delete-button on selected connection ──
  if (selectedConnIdx >= 0) {
    const selConn = connections[selectedConnIdx];
    if (selConn) {
      const fromL = layers.find(l => l.id === selConn.from);
      const toL   = layers.find(l => l.id === selConn.to);
      if (fromL && toL) {
        const path = buildConnPath(fromL, toL);
        const midPt = path[1], btnR = Math.max(10, 12 * zoom);
        const dx = e.clientX - (midPt.x + btnR + 4);
        const dy = e.clientY - (midPt.y - btnR - 4);
        if (Math.sqrt(dx * dx + dy * dy) <= btnR) {
          connections.splice(selectedConnIdx, 1); selectedConnIdx = -1; saveState(); return;
        }
      }
    }
  }

  // ── try connection hit ──
  const connHit = hitTestConnection(e.clientX, e.clientY, 8);
  if (connHit !== -1) { selectedConnIdx = connHit; selectedLayerId = null; closePropEditor(); return; }

  // ── nothing hit: deselect + pan ──
  selectedConnIdx = -1; selectedLayerId = null; closePropEditor();
  panDragging = true; panStartX = e.clientX; panStartY = e.clientY; panCamX = camX; panCamY = camY;
  document.body.style.cursor = 'grabbing';
});

/* --- Mouse move --- */
window.addEventListener('mousemove', e => {
  if (paletteDragType) { drawGhost(e.clientX, e.clientY); gridDirty = true; return; }

  if (connectionMode) {
    if (panDragging) {
      camX = panCamX - (e.clientX - panStartX) / zoom;
      camY = panCamY - (e.clientY - panStartY) / zoom;
      gridDirty = true; return;
    }
    connectMouseX = e.clientX; connectMouseY = e.clientY;
    if (connectStartId !== null) {
      const [wx, wy]  = screenToWorld(e.clientX, e.clientY);
      const fromLayer = layers.find(l => l.id === connectStartId);
      const hit       = hitTestLayer(wx, wy);
      document.body.style.cursor = (fromLayer && hit && canConnect(fromLayer, hit)) ? 'pointer' : 'not-allowed';
    } else {
      const [wx, wy] = screenToWorld(e.clientX, e.clientY);
      document.body.style.cursor = hitTestLayer(wx, wy) ? 'pointer' : 'default';
    }
    return;
  }

  if (layerDragging) {
    mouseDownDist = Math.sqrt((e.clientX - mouseDownX) ** 2 + (e.clientY - mouseDownY) ** 2);
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const layer = layers.find(l => l.id === layerDragId);
    if (layer) { layer.x = wx - layerDragOffX; layer.y = wy - layerDragOffY; }
    gridDirty = true; return;
  }

  if (panDragging) {
    camX = panCamX - (e.clientX - panStartX) / zoom;
    camY = panCamY - (e.clientY - panStartY) / zoom;
    gridDirty = true;
  }
});

/* --- Mouse up --- */
window.addEventListener('mouseup', e => {
  if (e.button !== 0) return;

  if (paletteDragType) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const swx = snapToGrid(wx), swy = snapToGrid(wy);
    if (!overlapsAny(swx, swy, null)) {
      layers.push({
        id:          nextId++,
        type:        paletteDragType,
        x:           swx,
        y:           swy,
        dims:        paletteDragType === 'input'   ? [28, 28] : undefined,
        units:       paletteDragType === 'linear'  ? 128      : undefined,
        reduce_dim:  paletteDragType === 'mean'    ? 0        : undefined,
        keepdim:     paletteDragType === 'mean'    ? false    : undefined,
        start_dim:   paletteDragType === 'flatten' ? 0        : undefined,
        end_dim:     paletteDragType === 'flatten' ? -1       : undefined,
        out_channels: paletteDragType === 'conv'  ? 16       : undefined,
        kernel_size:  paletteDragType === 'conv'  ? 3        : undefined,
        stride:       paletteDragType === 'conv'  ? 1        : undefined,
        padding:      paletteDragType === 'conv'  ? 0        : undefined,
        dilation:     paletteDragType === 'conv'  ? 1        : undefined,
        groups:       paletteDragType === 'conv'  ? 1        : undefined,
        outputShape: paletteDragType === 'output'  ? null     : undefined,
      });
      selectedLayerId = layers[layers.length - 1].id;
      saveState();
    }
    paletteDragType = null; hideGhost();
    if (ghostEl._paletteSource) ghostEl._paletteSource.classList.remove('dragging');
    ghostEl._paletteSource = null; document.body.style.cursor = 'crosshair'; gridDirty = true;
    return;
  }

  if (layerDragging) {
    const layer = layers.find(l => l.id === layerDragId);
    if (layer) {
      const snappedX = snapToGrid(layer.x), snappedY = snapToGrid(layer.y);
      if (overlapsAny(snappedX, snappedY, layer.id)) { layer.x = layerDragOrigX; layer.y = layerDragOrigY; }
      else { layer.x = snappedX; layer.y = snappedY; }
    }
    layerDragging = false; layerDragId = null; document.body.style.cursor = 'crosshair'; gridDirty = true;
    return;
  }

  if (panDragging) {
    panDragging = false; selectedConnIdx = -1; document.body.style.cursor = 'crosshair'; gridDirty = true;
  }
});

/* --- Double-click to open property editor --- */
window.addEventListener('dblclick', e => {
  if (propEditor.contains(e.target)) return;
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);
  const hit = hitTestLayer(wx, wy);
  if (hit) openPropEditor(hit);
});

/* --- Zoom via scroll wheel --- */
window.addEventListener('wheel', e => {
  e.preventDefault();
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);
  const factor   = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  zoom = Math.max(0.05, Math.min(50, zoom * factor));
  camX = wx - (e.clientX - W / 2) / zoom;
  camY = wy - (e.clientY - H / 2) / zoom;
  gridDirty = true;
}, { passive: false });

/* --- Right-click: exit connect mode / delete connection / teleport --- */
window.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (connectionMode) { connectionMode = false; connectStartId = null; return; }
  const connIdx = hitTestConnection(e.clientX, e.clientY);
  if (connIdx !== -1) { connections.splice(connIdx, 1); selectedConnIdx = -1; saveState(); return; }
  selectedConnIdx = -1;
  // teleport: right-clicked world point becomes new camera center
  camX = (e.clientX - W / 2) / zoom + camX;
  camY = (e.clientY - H / 2) / zoom + camY;
  gridDirty = true;
});

/* --- Keyboard: copy / paste --- */
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    if (selectedLayerId !== null && !propEditor.contains(document.activeElement)) {
      const src = layers.find(l => l.id === selectedLayerId);
      if (src) clipboard = JSON.parse(JSON.stringify(src));
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    if (!clipboard || propEditor.contains(document.activeElement)) return;
    const offset = gridSpacing * 2;
    let nx = snapToGrid(clipboard.x + offset), ny = snapToGrid(clipboard.y + offset);
    while (overlapsAny(nx, ny, null)) ny += gridSpacing;
    const newLayer = { ...JSON.parse(JSON.stringify(clipboard)), id: nextId++, x: nx, y: ny };
    layers.push(newLayer); selectedLayerId = newLayer.id; saveState();
    return;
  }
});

/* --- Keyboard: escape / connect mode / delete --- */
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closePropEditor();
    if (connectionMode) { connectionMode = false; connectStartId = null; }
    selectedConnIdx = -1;
    return;
  }
  if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey
      && document.activeElement.tagName !== 'INPUT'
      && document.activeElement.tagName !== 'TEXTAREA') {
    connectionMode = !connectionMode; connectStartId = null; nodesDirty = true; closePropEditor();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedConnIdx >= 0) {
      connections.splice(selectedConnIdx, 1); selectedConnIdx = -1; saveState();
    } else if (selectedLayerId !== null && !propEditor.contains(document.activeElement)) {
      const idx = layers.findIndex(l => l.id === selectedLayerId);
      if (idx !== -1) {
        const delId = selectedLayerId;
        layers.splice(idx, 1);
        connections.splice(0, connections.length, ...connections.filter(c => c.from !== delId && c.to !== delId));
        selectedLayerId = null; closePropEditor(); saveState();
      }
    }
  }
});
