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
        connectStartId   = hit.id;
        connectStartSide = nearestSide(hit, wx, wy); // start from side-centre nearest the click
      } else {
        const fromLayer = layers.find(l => l.id === connectStartId);
        if (fromLayer && canConnect(fromLayer, hit)) {
          connections.push({
            from: connectStartId, to: hit.id,
            fromSide: connectStartSide || 'r',
            toSide:   nearestSide(hit, wx, wy),       // end at side-centre nearest the click
          });
          saveState();
          connectionMode = false;
        }
        connectStartId = null; connectStartSide = null;
      }
      return;
    }
    panDragging = true; panStartX = e.clientX; panStartY = e.clientY; panCamX = camX; panCamY = camY;
    document.body.style.cursor = 'grabbing';
    return;
  }

  // ── select mode: drag to select layers ──
  if (selectMode) {
    const [_swx, _swy] = screenToWorld(e.clientX, e.clientY);
    const _sHit = hitTestLayer(_swx, _swy);
    if (_sHit) {
      if (selectedLayerIds.has(_sHit.id)) selectedLayerIds.delete(_sHit.id);
      else selectedLayerIds.add(_sHit.id);
      nodesDirty = true; return;
    }
    _selectStart   = { wx: _swx, wy: _swy };
    _selectCurrent = { wx: _swx, wy: _swy };
    return;
  }

  // ── draw mode: start superbox rect ──
  if (drawMode) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    _sbDrawStart = { wx: snapToGrid(wx), wy: snapToGrid(wy) };
    _sbDrawCurrent = { wx: snapToGrid(wx), wy: snapToGrid(wy) };
    return;
  }

  // ── delete-button on selected connection (priority over boxes & superboxes) ──
  if (selectedConnIdx >= 0) {
    const selConn = connections[selectedConnIdx];
    if (selConn) {
      const fromL = layers.find(l => l.id === selConn.from);
      const toL   = layers.find(l => l.id === selConn.to);
      if (fromL && toL) {
        const path = buildConnPath(fromL, toL, selConn);
        const midPt = path[1], btnR = Math.max(10, 12 * zoom);
        const dx = e.clientX - (midPt.x + btnR + 4);
        const dy = e.clientY - (midPt.y - btnR - 4);
        if (Math.sqrt(dx * dx + dy * dy) <= btnR) {
          connections.splice(selectedConnIdx, 1); selectedConnIdx = -1; saveState(); return;
        }
      }
    }
  }

  // ── normal mode: try layer first ──
  const [wx, wy] = screenToWorld(e.clientX, e.clientY);
  const hit = hitTestLayer(wx, wy);
  if (hit) {
    if (e.shiftKey) {
      // Shift+click: toggle in multi-selection without starting drag
      if (selectedLayerIds.has(hit.id)) selectedLayerIds.delete(hit.id);
      else selectedLayerIds.add(hit.id);
      nodesDirty = true; return;
    }
    if (selectedLayerIds.size >= 1 && selectedLayerIds.has(hit.id)) {
      // Start group drag
      groupDragging = true;
      groupDragOffX = wx - hit.x; groupDragOffY = wy - hit.y;
      groupDragAnchorOrigX = hit.x; groupDragAnchorOrigY = hit.y;
      groupDragLayers = [...selectedLayerIds].map(id => {
        const l = layers.find(x => x.id === id);
        return l ? { id, origX: l.x, origY: l.y } : null;
      }).filter(Boolean);
      // Fixpoint: collect fully-selected superboxes
      const _gdSbIds = new Set();
      let _gdChanged = true;
      while (_gdChanged) {
        _gdChanged = false;
        for (const sb of superboxes) {
          if (_gdSbIds.has(sb.id)) continue;
          const directLayers = sb.layerIds.filter(id => layers.some(l => l.id === id));
          const childSbs     = superboxes.filter(c => c.parentId === sb.id);
          const hasContent   = directLayers.length > 0 || childSbs.length > 0;
          const layersOk     = directLayers.every(id => selectedLayerIds.has(id));
          const childrenOk   = childSbs.every(c => _gdSbIds.has(c.id));
          if (hasContent && layersOk && childrenOk) { _gdSbIds.add(sb.id); _gdChanged = true; }
        }
      }
      groupDragSbs = superboxes.filter(s => _gdSbIds.has(s.id)).map(s => ({ id: s.id, origX: s.x, origY: s.y }));
      document.body.style.cursor = 'move';
      return;
    }
    // Normal single select — clear multi-selection
    selectedLayerIds.clear();
    selectedLayerId = hit.id; selectedConnIdx = -1;
    layerDragging   = true;   layerDragId     = hit.id;
    layerDragOffX   = wx - hit.x; layerDragOffY = wy - hit.y;
    layerDragOrigX  = hit.x; layerDragOrigY  = hit.y;
    document.body.style.cursor = 'move';
    return;
  }

  // ── try connection hit ──
  const connHit = hitTestConnection(e.clientX, e.clientY, 8);
  if (connHit !== -1) {
    const _chc = connections[connHit];
    if (selectedLayerIds.has(_chc.from) || selectedLayerIds.has(_chc.to)) return;
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
    // Block resize when SB is fully selected (group drag mode)
    if (selectedLayerIds.size > 0) {
      const _rSbIds = new Set();
      let _rCh = true;
      while (_rCh) {
        _rCh = false;
        for (const s of superboxes) {
          if (_rSbIds.has(s.id)) continue;
          const dl = s.layerIds.filter(id => layers.some(l => l.id === id));
          const cs = superboxes.filter(c => c.parentId === s.id);
          if ((dl.length > 0 || cs.length > 0) &&
              dl.every(id => selectedLayerIds.has(id)) &&
              cs.every(c => _rSbIds.has(c.id))) { _rSbIds.add(s.id); _rCh = true; }
        }
      }
      if (_rSbIds.has(sb.id)) return;
    }
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
    // If this SB is fully selected, join group drag so all selected items move together
    if (selectedLayerIds.size > 0) {
      const _gdSbIds = new Set();
      let _gdCh = true;
      while (_gdCh) {
        _gdCh = false;
        for (const s of superboxes) {
          if (_gdSbIds.has(s.id)) continue;
          const dl = s.layerIds.filter(id => layers.some(l => l.id === id));
          const cs = superboxes.filter(c => c.parentId === s.id);
          if ((dl.length > 0 || cs.length > 0) &&
              dl.every(id => selectedLayerIds.has(id)) &&
              cs.every(c => _gdSbIds.has(c.id))) { _gdSbIds.add(s.id); _gdCh = true; }
        }
      }
      if (_gdSbIds.has(sb.id)) {
        groupDragging = true;
        groupDragOffX = wx - sb.x; groupDragOffY = wy - sb.y;
        groupDragAnchorOrigX = sb.x; groupDragAnchorOrigY = sb.y;
        groupDragLayers = [...selectedLayerIds].map(id => {
          const l = layers.find(x => x.id === id);
          return l ? { id, origX: l.x, origY: l.y } : null;
        }).filter(Boolean);
        groupDragSbs = superboxes.filter(s => _gdSbIds.has(s.id)).map(s => ({ id: s.id, origX: s.x, origY: s.y }));
        document.body.style.cursor = 'move';
        return;
      }
    }
    sbDragging = true; sbDragId = sb.id;
    sbDragOffX = wx - sb.x; sbDragOffY = wy - sb.y;
    document.body.style.cursor = 'move';
    return;
  }

  // ── nothing hit: deselect + pan ──
  if (!e.shiftKey) selectedLayerIds.clear();
  selectedConnIdx = -1; selectedLayerId = null; selectedSuperboxId = null; closePropEditor();
  connDragIdx = -1;
  panDragging = true; panStartX = e.clientX; panStartY = e.clientY; panCamX = camX; panCamY = camY;
  document.body.style.cursor = 'grabbing';
});

/* --- Mouse move --- */
window.addEventListener('mousemove', e => {
  lastMouseSX = e.clientX; lastMouseSY = e.clientY;
  if (paletteDragType) { drawGhost(e.clientX, e.clientY); gridDirty = true; return; }

  // If mouse button was released outside the window, cancel any stuck drag
  // states. Do NOT return — connection-mode aiming and hover cursor updates
  // happen on buttonless mousemove and must still run below.
  if (e.buttons === 0 && (groupDragging || layerDragging || sbDragging ||
                          sbResizing || connDragging || panDragging)) {
    if (groupDragging) { groupDragging = false; groupDragLayers = []; groupDragSbs = []; nodesDirty = true; }
    layerDragging = false; layerDragId = null;
    sbDragging = false; sbDragId = null;
    sbResizing = false; sbResizeId = null;
    connDragging = false; connDragIdx = -1;
    panDragging = false;
    document.body.style.cursor = 'default';
    // fall through to normal hover/preview handling
  }

  if (drawMode && _sbDrawStart) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    _sbDrawCurrent = { wx: snapToGrid(wx), wy: snapToGrid(wy) };
    nodesDirty = true; return;
  }

  // select mode live rect
  if (selectMode && _selectStart) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    _selectCurrent = { wx: wx, wy: wy };
    nodesDirty = true; return;
  }

  // group drag
  if (groupDragging) {
    const [wx, wy] = screenToWorld(e.clientX, e.clientY);
    const groupIdSet = new Set(groupDragLayers.map(g => g.id));
    // Compute delta: where anchor layer should be now minus its original position
    const ddx = (wx - groupDragOffX) - groupDragAnchorOrigX;
    const ddy = (wy - groupDragOffY) - groupDragAnchorOrigY;
    // Get anchor's current pos before move (for elbowX incremental update)
    const _anchorL = layers.find(l => l.id === groupDragLayers[0]?.id);
    const _prevAX = _anchorL ? _anchorL.x : 0;
    const _prevAY = _anchorL ? _anchorL.y : 0;
    for (const { id, origX, origY } of groupDragLayers) {
      const l = layers.find(x => x.id === id);
      if (l) { l.x = origX + ddx; l.y = origY + ddy; }
    }
    for (const { id, origX, origY } of groupDragSbs) {
      const sb = superboxes.find(s => s.id === id);
      if (sb) { sb.x = origX + ddx; sb.y = origY + ddy; }
    }
    const _curAX = _anchorL ? _anchorL.x : 0;
    const _frameDx = _curAX - _prevAX;
    connections.forEach(c => {
      if (c.elbowX !== undefined && groupIdSet.has(c.from) && groupIdSet.has(c.to)) {
        c.elbowX += _frameDx;
      }
    });
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

  // finalize select rect
  if (selectMode && _selectStart && _selectCurrent) {
    const x1 = Math.min(_selectStart.wx, _selectCurrent.wx);
    const y1 = Math.min(_selectStart.wy, _selectCurrent.wy);
    const x2 = Math.max(_selectStart.wx, _selectCurrent.wx);
    const y2 = Math.max(_selectStart.wy, _selectCurrent.wy);
    if (x2 - x1 >= 3 && y2 - y1 >= 3) {
      selectedLayerIds.clear();
      layers.forEach(l => {
        if (l.x >= x1 && l.x <= x2 && l.y >= y1 && l.y <= y2) selectedLayerIds.add(l.id);
      });
    }
    _selectStart = null; _selectCurrent = null;
    selectMode = false;
    document.body.style.cursor = 'default';
    nodesDirty = true; syncStripButtons(); return;
  }

  // finalize group drag
  if (groupDragging) {
    const groupIdSet = new Set(groupDragLayers.map(g => g.id));
    // Snap all layers to grid; compute snap delta from first layer
    let snapDx = 0;
    if (groupDragLayers.length > 0) {
      const _fl = layers.find(l => l.id === groupDragLayers[0].id);
      if (_fl) { snapDx = snapToGrid(_fl.x) - _fl.x; }
    }
    for (const { id } of groupDragLayers) {
      const l = layers.find(x => x.id === id);
      if (l) { l.x = snapToGrid(l.x); l.y = snapToGrid(l.y); }
    }
    connections.forEach(c => {
      if (c.elbowX !== undefined && groupIdSet.has(c.from) && groupIdSet.has(c.to)) {
        c.elbowX = snapToGrid(c.elbowX + snapDx);
      }
    });
    for (const { id } of groupDragSbs) {
      const sb = superboxes.find(s => s.id === id);
      if (sb) { sb.x = snapToGrid(sb.x); sb.y = snapToGrid(sb.y); }
    }
    groupDragging = false; groupDragLayers = []; groupDragSbs = [];
    document.body.style.cursor = 'default';
    saveState(); nodesDirty = true; return;
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
  if (connectionMode) { connectionMode = false; connectStartId = null; connectStartSide = null; syncStripButtons(); return; }
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
function pasteMulti() {
  if (!multiClipboard || multiClipboard.layers.length === 0) return;
  const { layers: pLayers, conns: pConns, sbs: pSbs = [] } = multiClipboard;

  // Build old→new ID maps
  const layerIdMap = {};
  for (const l of pLayers) layerIdMap[l.id] = nextId++;
  const sbIdMap = {};
  for (const sb of pSbs) sbIdMap[sb.id] = nextId++;

  // Center pasted group on cursor.
  // l.x / l.y are the layer CENTRES (hitTest uses l.x ± hw), so use them directly.
  const xs = pLayers.map(l => l.x);
  const ys = pLayers.map(l => l.y);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const [mwx, mwy] = screenToWorld(lastMouseSX, lastMouseSY);
  const dx = snapToGrid(mwx - centerX);
  const dy = snapToGrid(mwy - centerY);

  // Paste layers
  const newIdSet = new Set();
  for (const l of pLayers) {
    const newL = { ...JSON.parse(JSON.stringify(l)), id: layerIdMap[l.id], x: l.x + dx, y: l.y + dy };
    layers.push(newL);
    newIdSet.add(newL.id);
  }

  // Paste internal connections with elbowX offset
  for (const c of pConns) {
    const nc = { ...JSON.parse(JSON.stringify(c)), from: layerIdMap[c.from], to: layerIdMap[c.to] };
    if (nc.elbowX !== undefined) nc.elbowX += dx;
    connections.push(nc);
  }

  // Paste superboxes — remap IDs, do NOT call syncAll() to avoid merging
  // pasted hierarchy with originals via spatial containment reassignment.
  for (const sb of pSbs) {
    const newSb = { ...JSON.parse(JSON.stringify(sb)),
      id:       sbIdMap[sb.id],
      x:        sb.x + dx,
      y:        sb.y + dy,
      layerIds: sb.layerIds.map(id => layerIdMap[id]).filter(id => id !== undefined),
      parentId: sb.parentId != null ? (sbIdMap[sb.parentId] ?? null) : null,
    };
    superboxes.push(newSb);
  }

  selectedLayerIds = new Set(newIdSet);
  selectedLayerId = null; selectedSuperboxId = null;
  saveState(); nodesDirty = true;
}

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

  // Copied layers = every layer whose CENTRE lies inside the root superbox
  // (geometric, not layerIds bookkeeping — survives stale membership).
  const _inGroup = l => {
    const lt  = layerTypes[l.type] || { w: 140, h: 70 };
    const lcx = l.x + lt.w / 2, lcy = l.y + lt.h / 2;
    return lcx >= rootSb.x && lcx <= rootSb.x + rootSb.w &&
           lcy >= rootSb.y && lcy <= rootSb.y + rootSb.h;
  };
  const layerList  = layers.filter(_inGroup);
  const layerIdSet = new Set(layerList.map(l => l.id));

  // Keep only connections whose BOTH endpoints are copied layers.
  // Connections to non-copied boxes are dropped.
  const connList = connections.filter(c => layerIdSet.has(c.from) && layerIdSet.has(c.to));

  copiedSuperbox = {
    rootId: rootSb.id,
    sbs: JSON.parse(JSON.stringify(sbList)),
    layers: JSON.parse(JSON.stringify(layerList)),
    conns: JSON.parse(JSON.stringify(connList)),
  };
  clipboard = null; // clear single-layer clipboard
  _clipSave();
}

function pasteSuperbox() {
  if (!copiedSuperbox) return;
  const { rootId, sbs, layers: pLayers, conns: pConns } = copiedSuperbox;

  // Build old→new ID maps
  const sbIdMap = {};
  for (const sb of sbs) sbIdMap[sb.id] = nextId++;
  const layerIdMap = {};
  for (const l of pLayers) layerIdMap[l.id] = nextId++;

  // Center the copied root superbox on the current cursor position
  const rootSb = sbs.find(s => s.id === rootId);
  const [mwx, mwy] = screenToWorld(lastMouseSX, lastMouseSY);
  const dx = snapToGrid(mwx - rootSb.w / 2) - rootSb.x;
  const dy = snapToGrid(mwy - rootSb.h / 2) - rootSb.y;

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

  // Paste internal connections (offset elbowX by the same dx as layers/SBs)
  for (const c of pConns) {
    const nc = { ...JSON.parse(JSON.stringify(c)),
      from: layerIdMap[c.from],
      to:   layerIdMap[c.to],
    };
    if (nc.elbowX !== undefined) nc.elbowX += dx;
    connections.push(nc);
  }

  // Do NOT call syncAll() — pasted SBs already have correct parentId (from
  // sbIdMap remap) and layerIds (from layerIdMap remap). syncSbParentIds()
  // would reassign parentIds by spatial containment and merge the pasted
  // hierarchy into the original when paste lands nearby.
  nodesDirty = true;
  selectedSuperboxId = pastedRootSbId;
  selectedLayerId = null;
  saveState();
}

/* --- Cross-tab clipboard via localStorage --- */
function _clipSave() {
  try {
    localStorage.setItem('nnb_clipboard', JSON.stringify({
      clipboard: clipboard,
      multiClipboard: multiClipboard,
      copiedSuperbox: copiedSuperbox,
    }));
  } catch (_e) {}
}
function _clipLoad() {
  // Only load from localStorage when in-memory is empty (another tab wrote it)
  if (clipboard || multiClipboard || copiedSuperbox) return;
  try {
    const raw = localStorage.getItem('nnb_clipboard');
    if (!raw) return;
    const d = JSON.parse(raw);
    clipboard      = d.clipboard      || null;
    multiClipboard = d.multiClipboard || null;
    copiedSuperbox = d.copiedSuperbox || null;
  } catch (_e) {}
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
    if (propEditor.contains(document.activeElement)) return;
    // Multi-select copy: highest priority
    if (selectedLayerIds.size > 0) {
      const layerList = layers.filter(l => selectedLayerIds.has(l.id));
      const connList  = connections.filter(c => selectedLayerIds.has(c.from) && selectedLayerIds.has(c.to));

      // Collect superboxes whose direct layers are ALL selected AND whose
      // direct child SBs are ALL also included. Iterate to fixpoint so nested
      // groups propagate upward correctly.
      const includedSbIds = new Set();
      let sbChanged = true;
      while (sbChanged) {
        sbChanged = false;
        for (const sb of superboxes) {
          if (includedSbIds.has(sb.id)) continue;
          const directLayers = sb.layerIds.filter(id => layers.some(l => l.id === id));
          const childSbs     = superboxes.filter(c => c.parentId === sb.id);
          const hasContent   = directLayers.length > 0 || childSbs.length > 0;
          const layersOk     = directLayers.every(id => selectedLayerIds.has(id));
          const childrenOk   = childSbs.every(c => includedSbIds.has(c.id));
          if (hasContent && layersOk && childrenOk) { includedSbIds.add(sb.id); sbChanged = true; }
        }
      }
      const sbList = superboxes.filter(s => includedSbIds.has(s.id));

      multiClipboard = {
        layers: JSON.parse(JSON.stringify(layerList)),
        conns:  JSON.parse(JSON.stringify(connList)),
        sbs:    JSON.parse(JSON.stringify(sbList)),
      };
      clipboard = null; copiedSuperbox = null;
      _clipSave();
      return;
    }
    if (selectedSuperboxId !== null) {
      const sb = superboxes.find(s => s.id === selectedSuperboxId);
      if (sb) { copySuperbox(sb); return; }
    }
    if (selectedLayerId !== null) {
      const src = layers.find(l => l.id === selectedLayerId);
      if (src) { clipboard = JSON.parse(JSON.stringify(src)); multiClipboard = null; _clipSave(); }
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    if (propEditor.contains(document.activeElement)) return;
    _clipLoad(); // pull from localStorage if another tab wrote it
    if (multiClipboard) { pasteMulti(); return; }
    if (copiedSuperbox) { pasteSuperbox(); return; }
    if (!clipboard) return;
    const _ct = layerTypes[clipboard.type] || { w: 140, h: 70 };
    const [mwx, mwy] = screenToWorld(lastMouseSX, lastMouseSY);
    let nx = snapToGrid(mwx - _ct.w / 2), ny = snapToGrid(mwy - _ct.h / 2);
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
    if (connectionMode) { connectionMode = false; connectStartId = null; connectStartSide = null; }
    if (selectMode) { selectMode = false; _selectStart = null; _selectCurrent = null; document.body.style.cursor = 'default'; syncStripButtons(); }
    selectedLayerIds.clear();
    selectedConnIdx = -1;
    return;
  }
  if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey
      && document.activeElement.tagName !== 'INPUT'
      && document.activeElement.tagName !== 'TEXTAREA') {
    connectionMode = !connectionMode; connectStartId = null; connectStartSide = null; nodesDirty = true; closePropEditor(); syncStripButtons();
    return;
  }
  if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.metaKey
      && document.activeElement.tagName !== 'INPUT'
      && document.activeElement.tagName !== 'TEXTAREA') {
    selectMode = !selectMode;
    if (selectMode) { connectionMode = false; connectStartId = null; connectStartSide = null; drawMode = false; _sbDrawStart = null; _sbDrawCurrent = null; }
    _selectStart = null; _selectCurrent = null;
    if (!selectMode) selectedLayerIds.clear();
    document.body.style.cursor = selectMode ? 'crosshair' : 'default';
    nodesDirty = true; syncStripButtons(); return;
  }
  if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey
      && document.activeElement.tagName !== 'INPUT'
      && document.activeElement.tagName !== 'TEXTAREA') {
    drawMode = !drawMode;
    if (drawMode) { connectionMode = false; connectStartId = null; connectStartSide = null; }
    _sbDrawStart = null; _sbDrawCurrent = null;
    document.body.style.cursor = drawMode ? 'crosshair' : 'default';
    nodesDirty = true; syncStripButtons();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    // Multi-select delete: highest priority
    if (selectedLayerIds.size > 0 && !propEditor.contains(document.activeElement)) {
      const toDelete = new Set(selectedLayerIds);
      // Also delete fully-selected superboxes (same fixpoint as Ctrl+C)
      const deleteSbIds = new Set();
      let sbChanged = true;
      while (sbChanged) {
        sbChanged = false;
        for (const sb of superboxes) {
          if (deleteSbIds.has(sb.id)) continue;
          const existingLayers = sb.layerIds.filter(id => layers.some(l => l.id === id));
          const childSbs = superboxes.filter(c => c.parentId === sb.id);
          const hasContent = existingLayers.length > 0 || childSbs.length > 0;
          const layersOk = existingLayers.every(id => toDelete.has(id));
          const childrenOk = childSbs.every(c => deleteSbIds.has(c.id));
          if (hasContent && layersOk && childrenOk) { deleteSbIds.add(sb.id); sbChanged = true; }
        }
      }
      layers.splice(0, layers.length, ...layers.filter(l => !toDelete.has(l.id)));
      connections.splice(0, connections.length, ...connections.filter(c => !toDelete.has(c.from) && !toDelete.has(c.to)));
      superboxes.splice(0, superboxes.length, ...superboxes.filter(sb => !deleteSbIds.has(sb.id)));
      superboxes.forEach(sb => { sb.layerIds = sb.layerIds.filter(id => !toDelete.has(id)); });
      selectedLayerIds.clear(); selectedLayerId = null;
      closePropEditor(); saveState(); return;
    }
    if (selectedSuperboxId !== null && !propEditor.contains(document.activeElement)) {
      const idx = superboxes.findIndex(s => s.id === selectedSuperboxId);
      if (idx !== -1) { superboxes.splice(idx, 1); selectedSuperboxId = null; syncAll(); saveState(); }
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
