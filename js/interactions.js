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
          connectionMode = false;
        }
        connectStartId = null;
      }
      return;
    }
    panDragging = true; panStartX = e.clientX; panStartY = e.clientY; panCamX = camX; panCamY = camY;
    document.body.style.cursor = 'grabbing';
    return;
  }

  // ── draw mode: start superbox rect ──
  if (drawMode) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    _sbDrawStart = { wx: snapToGrid(wx), wy: snapToGrid(wy) };
    _sbDrawCurrent = { wx: snapToGrid(wx), wy: snapToGrid(wy) };
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
  if (connHit !== -1) {
    selectedConnIdx = connHit; selectedLayerId = null; closePropEditor();
    connDragIdx      = connHit;
    connDragStartSX  = e.clientX;
    connDragStartOff = connections[connHit].midXOffset || 0;
    return;
  }

  // ── try superbox ──
  const sbIdx = hitTestSuperbox(wx, wy);
  if (sbIdx !== -1) {
    const sb = superboxes[sbIdx];
    selectedSuperboxId = sb.id;
    selectedLayerId = null; selectedConnIdx = -1;
    sbDragging = true; sbDragId = sb.id;
    sbDragOffX = wx - sb.x; sbDragOffY = wy - sb.y;
    document.body.style.cursor = 'move';
    return;
  }

  // ── nothing hit: deselect + pan ──
  selectedConnIdx = -1; selectedLayerId = null; selectedSuperboxId = null; closePropEditor();
  connDragIdx = -1;
  panDragging = true; panStartX = e.clientX; panStartY = e.clientY; panCamX = camX; panCamY = camY;
  document.body.style.cursor = 'grabbing';
});

/* --- Mouse move --- */
window.addEventListener('mousemove', e => {
  if (paletteDragType) { drawGhost(e.clientX, e.clientY); gridDirty = true; return; }

  // draw mode live preview
  if (drawMode && _sbDrawStart) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    _sbDrawCurrent = { wx: snapToGrid(wx), wy: snapToGrid(wy) };
    nodesDirty = true; return;
  }

  // superbox drag
  if (sbDragging) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const sb = superboxes.find(s => s.id === sbDragId);
    if (sb) {
      const dx = wx - sbDragOffX - sb.x;
      const dy = wy - sbDragOffY - sb.y;
      sb.x += dx; sb.y += dy;
      // move all contained layers
      sb.layerIds.forEach(lid => {
        const l = layers.find(x => x.id === lid);
        if (l) { l.x += dx; l.y += dy; }
      });
    }
    nodesDirty = true; return;
  }

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

  if (connDragIdx !== -1 && !layerDragging && !panDragging) {
    const dx = e.clientX - connDragStartSX;
    if (Math.abs(dx) > 3) {
      connDragging = true;
      connections[connDragIdx].midXOffset = connDragStartOff + dx / zoom;
      nodesDirty = true;
      document.body.style.cursor = 'ew-resize';
      return;
    }
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

  // finalize superbox draw
  if (drawMode && _sbDrawStart && _sbDrawCurrent) {
    const sx1 = snapToGrid(Math.min(_sbDrawStart.wx, _sbDrawCurrent.wx));
    const sy1 = snapToGrid(Math.min(_sbDrawStart.wy, _sbDrawCurrent.wy));
    const sx2 = snapToGrid(Math.max(_sbDrawStart.wx, _sbDrawCurrent.wx));
    const sy2 = snapToGrid(Math.max(_sbDrawStart.wy, _sbDrawCurrent.wy));
    // enforce minimum 2×gridSpacing in each dimension
    const x1 = sx1, y1 = sy1;
    const x2 = Math.max(sx2, sx1 + gridSpacing * 2);
    const y2 = Math.max(sy2, sy1 + gridSpacing * 2);
    // width/height already multiples of gridSpacing (both endpoints snapped)
    if (x2 - x1 >= gridSpacing * 2 && y2 - y1 >= gridSpacing * 2) {
      const enclosed = layers.filter(l => {
        return l.x >= x1 && l.x <= x2 && l.y >= y1 && l.y <= y2;
      });
      const newSb = {
        id: nextId++,
        name: '',
        x: x1, y: y1, w: x2 - x1, h: y2 - y1,
        layerIds: enclosed.map(l => l.id),
        colorIdx: superboxes.length % SUPERBOX_COLORS.length
      };
      superboxes.push(newSb);
      selectedSuperboxId = newSb.id;
      selectedLayerId = null;
      saveState();
      // immediately open name editor
      openSuperboxEditor(newSb);
    }
    drawMode = false;
    document.body.style.cursor = 'default';
    _sbDrawStart = null; _sbDrawCurrent = null;
    nodesDirty = true;
    return;
  }

  // end superbox drag
  if (sbDragging) {
    const sb = superboxes.find(s => s.id === sbDragId);
    if (sb) {
      // snap superbox origin to grid, apply same delta to contained layers
      const snappedX = snapToGrid(sb.x);
      const snappedY = snapToGrid(sb.y);
      const dx = snappedX - sb.x;
      const dy = snappedY - sb.y;
      sb.x = snappedX; sb.y = snappedY;
      sb.layerIds.forEach(lid => {
        const l = layers.find(x => x.id === lid);
        if (l) { l.x = snapToGrid(l.x + dx); l.y = snapToGrid(l.y + dy); }
      });
    }
    sbDragging = false; sbDragId = null;
    document.body.style.cursor = drawMode ? 'crosshair' : 'default';
    saveState(); nodesDirty = true; return;
  }

  if (connDragging) {
    // Snap elbow X to grid on drop
    const dc = connections[connDragIdx];
    if (dc) {
      const fl = layers.find(l => l.id === dc.from);
      const tl = layers.find(l => l.id === dc.to);
      if (fl && tl) {
        const autoMidX = (fl.x + layerTypes[fl.type].w / 2 + tl.x - layerTypes[tl.type].w / 2) / 2;
        const absMidX  = autoMidX + (dc.midXOffset || 0);
        dc.midXOffset  = snapToGrid(absMidX) - autoMidX;
      }
    }
    connDragging = false; connDragIdx = -1;
    saveState(); nodesDirty = true;
    document.body.style.cursor = 'default';
    return;
  }
  connDragIdx = -1;

  if (layerDragging) {
    const layer = layers.find(l => l.id === layerDragId);
    if (layer) {
      const snappedX = snapToGrid(layer.x), snappedY = snapToGrid(layer.y);
      if (overlapsAny(snappedX, snappedY, layer.id)) { layer.x = layerDragOrigX; layer.y = layerDragOrigY; }
      else { layer.x = snappedX; layer.y = snappedY; }

      // Sync superbox membership based on final position
      const t   = layerTypes[layer.type] || { w: 140, h: 70 };
      const cx  = layer.x + t.w / 2;
      const cy  = layer.y + t.h / 2;
      let membershipChanged = false;
      for (const sb of superboxes) {
        const inside = cx >= sb.x && cx <= sb.x + sb.w && cy >= sb.y && cy <= sb.y + sb.h;
        const idx    = sb.layerIds.indexOf(layer.id);
        if (inside && idx === -1)  { sb.layerIds.push(layer.id); membershipChanged = true; }
        if (!inside && idx !== -1) { sb.layerIds.splice(idx, 1); membershipChanged = true; }
      }
      if (membershipChanged) saveState();
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
  if (hit) { openPropEditor(hit); return; }
  const sbIdx = hitTestSuperbox(wx, wy);
  if (sbIdx !== -1) openSuperboxEditor(superboxes[sbIdx]);
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
  connDragging = false; connDragIdx = -1;
  if (connectionMode) { connectionMode = false; connectStartId = null; syncStripButtons(); return; }
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
  // ── undo / redo ──
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    e.preventDefault(); undo(); return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    e.preventDefault(); redo(); return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    if (selectedSuperboxId !== null && !propEditor.contains(document.activeElement)) {
      const sb = superboxes.find(s => s.id === selectedSuperboxId);
      if (sb) { copySuperbox(sb); return; }
    }
    if (selectedLayerId !== null && !propEditor.contains(document.activeElement)) {
      const src = layers.find(l => l.id === selectedLayerId);
      if (src) clipboard = JSON.parse(JSON.stringify(src));
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    if (copiedSuperbox && !propEditor.contains(document.activeElement)) {
      pasteSuperbox(); return;
    }
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
    connectionMode = !connectionMode; connectStartId = null; nodesDirty = true; closePropEditor(); syncStripButtons();
    return;
  }
  if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey
      && document.activeElement.tagName !== 'INPUT'
      && document.activeElement.tagName !== 'TEXTAREA') {
    drawMode = !drawMode;
    if (drawMode) { connectionMode = false; connectStartId = null; }
    _sbDrawStart = null; _sbDrawCurrent = null;
    document.body.style.cursor = drawMode ? 'crosshair' : 'default';
    nodesDirty = true; syncStripButtons();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedSuperboxId !== null && !propEditor.contains(document.activeElement)) {
      const idx = superboxes.findIndex(s => s.id === selectedSuperboxId);
      if (idx !== -1) { superboxes.splice(idx, 1); selectedSuperboxId = null; saveState(); }
      return;
    }
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

/* Palette group toggle */
document.querySelectorAll('.palette-group-header').forEach(header => {
  header.addEventListener('click', () => {
    header.classList.toggle('open');
    header.nextElementSibling.classList.toggle('open');
  });
});

/* Palette search */
(function() {
  const searchInp = document.getElementById('palette-search');
  // remember which groups were open before search
  let preSearchOpen = null;

  searchInp.addEventListener('input', () => {
    const q = searchInp.value.trim().toLowerCase();
    const groups = document.querySelectorAll('.palette-group');

    if (!q) {
      // restore pre-search state
      groups.forEach(group => {
        group.style.display = '';
        const header = group.querySelector('.palette-group-header');
        const items  = group.querySelector('.palette-group-items');
        const wasOpen = preSearchOpen ? preSearchOpen.get(group) : false;
        items.querySelectorAll('.palette-item').forEach(item => item.style.display = '');
        if (wasOpen) { header.classList.add('open'); items.classList.add('open'); }
        else         { header.classList.remove('open'); items.classList.remove('open'); }
      });
      preSearchOpen = null;
      return;
    }

    // save state on first keystroke
    if (!preSearchOpen) {
      preSearchOpen = new Map();
      groups.forEach(g => preSearchOpen.set(g, g.querySelector('.palette-group-header').classList.contains('open')));
    }

    groups.forEach(group => {
      const header = group.querySelector('.palette-group-header');
      const items  = group.querySelector('.palette-group-items');
      const allItems = items.querySelectorAll('.palette-item');
      let anyMatch = false;
      allItems.forEach(item => {
        const name = (item.querySelector('.name')?.textContent || '').toLowerCase();
        const desc = (item.querySelector('.desc')?.textContent || '').toLowerCase();
        const match = name.includes(q) || desc.includes(q);
        item.style.display = match ? '' : 'none';
        if (match) anyMatch = true;
      });
      if (anyMatch) {
        group.style.display = '';
        header.classList.add('open');
        items.classList.add('open');
      } else {
        group.style.display = 'none';
      }
    });
  });
})();
