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
    const _dc = connections[connHit];
    const _fl = layers.find(l => l.id === _dc.from);
    const _tl = layers.find(l => l.id === _dc.to);
    const _autoMidWX = (_fl && _tl)
      ? (_fl.x + layerTypes[_fl.type].w / 2 + _tl.x - layerTypes[_tl.type].w / 2) / 2
      : 0;
    connDragStartElbowWX = (_dc.elbowX !== undefined) ? _dc.elbowX : _autoMidWX;
    return;
  }

  // ── try superbox eye button ──
  {
    const [scx, scy] = [e.clientX, e.clientY];
    for (const btn of _sbEyeBtns) {
      const dx = scx - btn.cx, dy = scy - btn.cy;
      if (dx * dx + dy * dy <= btn.r * btn.r * 2.5) {
        const sb = superboxes.find(s => s.id === btn.sbId);
        if (sb) { sb.bgVisible = sb.bgVisible === false ? true : false; saveState(); nodesDirty = true; }
        return;
      }
    }
  }

  // ── try superbox edge (resize) ──
  const sbEdgeHit = hitTestSuperboxEdge(wx, wy);
  if (sbEdgeHit !== null) {
    const sb = superboxes[sbEdgeHit.idx];
    selectedSuperboxId = sb.id;
    selectedLayerId = null; selectedConnIdx = -1;
    sbResizing = true; sbResizeId = sb.id; sbResizeEdge = sbEdgeHit.edge;
    sbResizeStartX = wx; sbResizeStartY = wy;
    sbResizeOrigX = sb.x; sbResizeOrigY = sb.y;
    sbResizeOrigW = sb.w; sbResizeOrigH = sb.h;
    document.body.style.cursor = _SB_EDGE_CURSORS[sbEdgeHit.edge];
    return;
  }

  // ── try superbox body (move) ──
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

  // superbox resize
  if (sbResizing) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const sb = superboxes.find(s => s.id === sbResizeId);
    if (sb) {
      const dx = wx - sbResizeStartX, dy = wy - sbResizeStartY;
      const edge = sbResizeEdge;
      if (edge.includes('e')) sb.w = Math.max(gridSpacing, sbResizeOrigW + dx);
      if (edge.includes('s')) sb.h = Math.max(gridSpacing, sbResizeOrigH + dy);
      if (edge.includes('w')) {
        const nw = Math.max(gridSpacing, sbResizeOrigW - dx);
        sb.x = sbResizeOrigX + sbResizeOrigW - nw; sb.w = nw;
      }
      if (edge.includes('n')) {
        const nh = Math.max(gridSpacing, sbResizeOrigH - dy);
        sb.y = sbResizeOrigY + sbResizeOrigH - nh; sb.h = nh;
      }
    }
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

      // Collect ALL descendant SBs and their layer IDs (avoid double-move:
      // layers inside nested SBs appear in both parent & child layerIds due
      // to membership sync, so we move each thing exactly once).
      const _descSbIds   = new Set();
      const _descLayerIds = new Set();
      const _collectDesc = pid => {
        superboxes.forEach(c => {
          if (c.parentId === pid) {
            _descSbIds.add(c.id);
            c.layerIds.forEach(id => _descLayerIds.add(id));
            _collectDesc(c.id);
          }
        });
      };
      _collectDesc(sb.id);

      // Move direct layers (skip any that live inside a child SB)
      sb.layerIds.forEach(lid => {
        if (_descLayerIds.has(lid)) return;
        const l = layers.find(x => x.id === lid);
        if (l) { l.x += dx; l.y += dy; }
      });
      // Move all descendant SBs
      _descSbIds.forEach(cid => {
        const c = superboxes.find(s => s.id === cid);
        if (c) { c.x += dx; c.y += dy; }
      });
      // Move all layers inside descendant SBs (exactly once)
      _descLayerIds.forEach(lid => {
        const l = layers.find(x => x.id === lid);
        if (l) { l.x += dx; l.y += dy; }
      });

      // Build full set of moved layer IDs for elbowX update
      const _allMovedLayerIds = new Set([...sb.layerIds, ..._descLayerIds]);
      // Shift elbowX for connections where both endpoints moved
      connections.forEach(c => {
        if (c.elbowX !== undefined && _allMovedLayerIds.has(c.from) && _allMovedLayerIds.has(c.to)) {
          c.elbowX += dx;
        }
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
      const _edgeH = hitTestSuperboxEdge(wx, wy);
      if (_edgeH) document.body.style.cursor = _SB_EDGE_CURSORS[_edgeH.edge];
      else document.body.style.cursor = hitTestLayer(wx, wy) ? 'pointer' : 'default';
    }
    return;
  }

  if (connDragIdx !== -1 && !layerDragging && !panDragging) {
    const dx = e.clientX - connDragStartSX;
    if (Math.abs(dx) > 3) {
      connDragging = true;
      connections[connDragIdx].elbowX = connDragStartElbowWX + dx / zoom;
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
        colorIdx: superboxes.length % SUPERBOX_COLORS.length,
        parentId: null  // will be set by syncAll below
      };
      superboxes.push(newSb);
      syncAll(); // recomputes parentId for all SBs + deepest-only layerIds
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
  if (sbResizing) {
    const sb = superboxes.find(s => s.id === sbResizeId);
    if (sb) {
      sb.x = snapToGrid(sb.x); sb.y = snapToGrid(sb.y);
      sb.w = Math.max(gridSpacing, snapToGrid(sb.w));
      sb.h = Math.max(gridSpacing, snapToGrid(sb.h));
    }
    syncAll(); // recompute parentId for all SBs after resize + fix layerIds
    sbResizing = false; sbResizeId = null; sbResizeEdge = null;
    saveState(); nodesDirty = true;
    document.body.style.cursor = 'crosshair';
    return;
  }

  if (sbDragging) {
    const sb = superboxes.find(s => s.id === sbDragId);
    if (sb) {
      // snap superbox origin to grid — same dedup logic as mousemove drag
      const snappedX = snapToGrid(sb.x);
      const snappedY = snapToGrid(sb.y);
      const dx = snappedX - sb.x;
      const dy = snappedY - sb.y;
      sb.x = snappedX; sb.y = snappedY;

      const _snapDescSbIds    = new Set();
      const _snapDescLayerIds = new Set();
      const _collectSnapDesc  = pid => {
        superboxes.forEach(c => {
          if (c.parentId === pid) {
            _snapDescSbIds.add(c.id);
            c.layerIds.forEach(id => _snapDescLayerIds.add(id));
            _collectSnapDesc(c.id);
          }
        });
      };
      _collectSnapDesc(sb.id);

      sb.layerIds.forEach(lid => {
        if (_snapDescLayerIds.has(lid)) return;
        const l = layers.find(x => x.id === lid);
        if (l) { l.x = snapToGrid(l.x + dx); l.y = snapToGrid(l.y + dy); }
      });
      _snapDescSbIds.forEach(cid => {
        const c = superboxes.find(s => s.id === cid);
        if (c) { c.x = snapToGrid(c.x + dx); c.y = snapToGrid(c.y + dy); }
      });
      _snapDescLayerIds.forEach(lid => {
        const l = layers.find(x => x.id === lid);
        if (l) { l.x = snapToGrid(l.x + dx); l.y = snapToGrid(l.y + dy); }
      });

      // Snap elbowX for internal connections
      const _snapAllMoved = new Set([...sb.layerIds, ..._snapDescLayerIds]);
      connections.forEach(c => {
        if (c.elbowX !== undefined && _snapAllMoved.has(c.from) && _snapAllMoved.has(c.to)) {
          c.elbowX = snapToGrid(c.elbowX + dx);
        }
      });

      syncAll(); // recompute all parentId + deepest-only layerIds after drop
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
        dc.elbowX = snapToGrid(dc.elbowX !== undefined ? dc.elbowX : (fl.x + layerTypes[fl.type].w / 2 + tl.x - layerTypes[tl.type].w / 2) / 2);
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

      // Sync superbox membership: layer goes into deepest containing SB only
      syncLayerMembership([layer]);
      saveState();
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

/* --- Membership sync helper: place each layer in deepest containing SB only --- */
function syncLayerMembership(layerList) {
  const sortedSbs = sbsSortedByDepth().reverse(); // deepest first
  for (const l of layerList) {
    const lt = layerTypes[l.type] || { w: 140, h: 70 };
    const lcx = l.x + lt.w / 2, lcy = l.y + lt.h / 2;
    let deepestSb = null;
    for (const sb of sortedSbs) {
      if (lcx >= sb.x && lcx <= sb.x + sb.w && lcy >= sb.y && lcy <= sb.y + sb.h) {
        deepestSb = sb; break;
      }
    }
    for (const sb of superboxes) {
      const idx = sb.layerIds.indexOf(l.id);
      const shouldBeIn = deepestSb !== null && sb.id === deepestSb.id;
      if (shouldBeIn  && idx === -1) sb.layerIds.push(l.id);
      if (!shouldBeIn && idx !== -1) sb.layerIds.splice(idx, 1);
    }
  }
}


/* --- SB hierarchy sync: recompute all parentId from containment geometry --- */
function syncSbParentIds() {
  // For each SB find the tightest (smallest area) OTHER SB that fully contains
  // its center point AND is strictly larger (area > own area) to prevent cycles.
  for (const sb of superboxes) {
    const cx = sb.x + sb.w / 2, cy = sb.y + sb.h / 2;
    let bestParent = null, bestArea = Infinity;
    for (const other of superboxes) {
      if (other.id === sb.id) continue;
      const area = other.w * other.h;
      if (area <= sb.w * sb.h) continue;        // parent must be strictly larger
      if (area >= bestArea) continue;            // want the tightest fit
      if (cx >= other.x && cx <= other.x + other.w &&
          cy >= other.y && cy <= other.y + other.h) {
        bestParent = other.id; bestArea = area;
      }
    }
    sb.parentId = bestParent;
  }
}

/* --- Combined sync: hierarchy then layer ownership ----------------------- */
function syncAll() {
  syncSbParentIds();
  syncLayerMembership(layers);
}

/* --- Superbox copy / paste helpers --- */
function copySuperbox(rootSb) {
  // Collect all descendant superboxes (BFS on parentId)
  const sbIds = new Set([rootSb.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const sb of superboxes) {
      if (!sbIds.has(sb.id) && sbIds.has(sb.parentId)) { sbIds.add(sb.id); changed = true; }
    }
  }
  const sbList = superboxes.filter(s => sbIds.has(s.id));

  // Collect all layer IDs inside any of those superboxes
  const layerIdSet = new Set();
  for (const sb of sbList) sb.layerIds.forEach(id => layerIdSet.add(id));
  const layerList = layers.filter(l => layerIdSet.has(l.id));

  // Internal connections only (both endpoints inside)
  const connList = connections.filter(c => layerIdSet.has(c.from) && layerIdSet.has(c.to));

  copiedSuperbox = {
    rootId: rootSb.id,
    sbs: JSON.parse(JSON.stringify(sbList)),
    layers: JSON.parse(JSON.stringify(layerList)),
    conns: JSON.parse(JSON.stringify(connList)),
  };
  clipboard = null; // clear single-layer clipboard
}

function pasteSuperbox() {
  if (!copiedSuperbox) return;
  const offset = gridSpacing * 2;
  const { rootId, sbs, layers: pLayers, conns: pConns } = copiedSuperbox;

  // Build old→new ID maps
  const sbIdMap = {};
  for (const sb of sbs) sbIdMap[sb.id] = nextId++;
  const layerIdMap = {};
  for (const l of pLayers) layerIdMap[l.id] = nextId++;

  // Find root SB to compute position delta
  const rootSb = sbs.find(s => s.id === rootId);
  const dx = snapToGrid(rootSb.x + offset) - rootSb.x;
  const dy = snapToGrid(rootSb.y + offset) - rootSb.y;

  // Paste superboxes
  const pastedRootSbId = sbIdMap[rootId];
  for (const sb of sbs) {
    const newSb = { ...JSON.parse(JSON.stringify(sb)),
      id: sbIdMap[sb.id],
      x: sb.x + dx, y: sb.y + dy,
      layerIds: sb.layerIds.map(id => layerIdMap[id]).filter(id => id !== undefined),
      parentId: sb.id === rootId ? null : (sb.parentId != null ? sbIdMap[sb.parentId] ?? null : null),
    };
    superboxes.push(newSb);
  }

  // Paste layers
  for (const l of pLayers) {
    const newL = { ...JSON.parse(JSON.stringify(l)),
      id: layerIdMap[l.id],
      x: l.x + dx, y: l.y + dy,
    };
    layers.push(newL);
  }

  // Paste internal connections
  for (const c of pConns) {
    connections.push({ ...JSON.parse(JSON.stringify(c)),
      from: layerIdMap[c.from],
      to:   layerIdMap[c.to],
    });
  }

  selectedSuperboxId = pastedRootSbId;
  selectedLayerId = null;
  saveState();
}

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
