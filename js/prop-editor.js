/* Property editor — doubles as the shape inspector */
const propEditor = document.getElementById('prop-editor');
const peTitle    = document.getElementById('pe-title');
const peBody     = document.getElementById('pe-body');
const peClose    = document.getElementById('pe-close');

function openPropEditor(layer) {
  const t = layerTypes[layer.type];
  const displayName = layer.type === 'conv'
    ? `CONV${layer.ndim !== undefined ? layer.ndim : 2}D`
    : layer.type.toUpperCase();
  peTitle.textContent = displayName + ' LAYER';
  peTitle.style.color = t.color;
  peTitle.style.textShadow = `0 0 6px ${t.color}`;
  propEditor.style.setProperty('--pe-color', t.color);
  propEditor.style.setProperty('--pe-rgb', hexToRgb(t.color));
  peBody.innerHTML = '';

  /* --- INPUT --- */
  if (layer.type === 'input') {
    if (!layer.dims) layer.dims = [28, 28];
    const dimsContainer = document.createElement('div');
    dimsContainer.id = 'pe-dims-container';

    function renderDims() {
      dimsContainer.innerHTML = '';
      layer.dims.forEach((d, i) => {
        const row   = document.createElement('div'); row.className = 'pe-dim-row';
        const label = document.createElement('span'); label.className = 'pe-dim-label'; label.textContent = `D${i + 1}`;
        const inp   = document.createElement('input'); inp.className = 'pe-input'; inp.type = 'text'; inp.value = d;
        inp.addEventListener('change', () => {
          const raw = inp.value.trim();
          layer.dims[i] = (raw !== '' && !isNaN(raw)) ? Math.max(1, parseInt(raw) || 1) : raw;
          saveState();
        });
        row.appendChild(label); row.appendChild(inp);
        if (layer.dims.length > 1) {
          const rm = document.createElement('span'); rm.className = 'pe-dim-remove'; rm.textContent = '×';
          rm.addEventListener('click', () => { layer.dims.splice(i, 1); saveState(); openPropEditor(layer); });
          row.appendChild(rm);
        }
        dimsContainer.appendChild(row);
      });
      const addBtn = document.createElement('div'); addBtn.className = 'pe-add-btn'; addBtn.textContent = '+ ADD DIM';
      addBtn.addEventListener('click', () => { layer.dims.push(1); saveState(); openPropEditor(layer); });
      dimsContainer.appendChild(addBtn);
    }
    renderDims();
    peBody.appendChild(dimsContainer);
    setTimeout(() => { const first = dimsContainer.querySelector('.pe-input'); if (first) first.focus(); }, 50);

  /* --- MEAN --- */
  } else if (layer.type === 'mean') {
    if (layer.reduce_dim === undefined) layer.reduce_dim = 0;
    if (layer.keepdim    === undefined) layer.keepdim    = false;
    const inc         = connections.filter(c => c.to === layer.id);
    const src         = inc.length > 0 ? shapeCache[inc[inc.length - 1].from] : null;
    const inShapeStr  = src ? `[${src.join(', ')}]` : '?';
    const outShape    = shapeCache[layer.id];
    const outShapeStr = outShape ? `[${outShape.join(', ')}]` : '?';
    const dimVal      = Array.isArray(layer.reduce_dim) ? layer.reduce_dim.join(', ') : String(layer.reduce_dim);
    peBody.innerHTML  = `
      <div class="pe-row"><span class="pe-label" style="font-size:9px;color:rgba(255,140,0,0.4);">${inShapeStr} → ${outShapeStr}</span></div>
      <div class="pe-row" style="margin-top:6px;"><span class="pe-label">DIM</span><input class="pe-input" type="text" value="${dimVal}" id="pe-reduce-dim" placeholder="0 or 0,1"></div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">KEEPDIM</span><input type="checkbox" id="pe-keepdim" ${layer.keepdim ? 'checked' : ''} style="accent-color:#ff8c00;width:14px;height:14px;cursor:pointer;"></div>`;
    const dimInput = peBody.querySelector('#pe-reduce-dim');
    const kdInput  = peBody.querySelector('#pe-keepdim');
    dimInput.addEventListener('change', () => {
      const parts = dimInput.value.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      layer.reduce_dim = parts.length === 1 ? parts[0] : parts;
      saveState();
    });
    kdInput.addEventListener('change', () => { layer.keepdim = kdInput.checked; saveState(); });
    setTimeout(() => dimInput.focus(), 50);

  /* --- LINEAR --- */
  } else if (layer.type === 'linear') {
    const inc = connections.filter(c => c.to === layer.id);
    let inF   = '?';
    if (inc.length > 0) { const src = shapeCache[inc[inc.length - 1].from]; if (src && src.length > 0) inF = src[src.length - 1]; }
    const mismatch = inF !== '?' && layer._inFeatures && layer._inFeatures !== inF;
    const curAct   = layer.activation || 'none';
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label">IN FEATURES</span><span style="color:${mismatch ? '#ff4444' : '#ffc800'};font-size:12px;font-family:'Courier New',monospace;">${inF}</span></div>
      <div class="pe-row" style="margin-top:6px;"><span class="pe-label">OUT FEATURES</span><input class="pe-input" type="text" value="${layer.units || 128}" id="pe-units"></div>
      <div class="pe-row" style="margin-top:6px;"><span class="pe-label">BIAS</span><input type="checkbox" id="pe-bias" ${layer.bias !== false ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--pe-color,#0088ff);"></div>
      <div class="pe-row" style="margin-top:8px;"><span class="pe-label">FUNCTION</span><div class="pe-fn-btn" id="pe-fn-btn">${curAct} ▾</div></div>
      <div class="pe-fn-panel" id="pe-fn-panel" style="display:none;"><input class="pe-fn-search" type="text" placeholder="search..." id="pe-fn-search" autocomplete="off"><div id="pe-fn-list"></div></div>`;
    const input    = peBody.querySelector('#pe-units');
    const fnBtn    = peBody.querySelector('#pe-fn-btn');
    const fnPanel  = peBody.querySelector('#pe-fn-panel');
    const fnSearch = peBody.querySelector('#pe-fn-search');
    const fnList   = peBody.querySelector('#pe-fn-list');
    if (input) {
      input.addEventListener('change', () => {
        const raw = input.value.trim();
        layer.units = (raw !== '' && !isNaN(raw)) ? Math.max(1, parseInt(raw) || 1) : raw;
        saveState();
      });
      setTimeout(() => input.focus(), 50);
    }
    const biasChk = peBody.querySelector('#pe-bias');
    if (biasChk) {
      biasChk.addEventListener('change', () => {
        layer.bias = biasChk.checked;
        saveState();
      });
    }
    const FN_WINDOW = 5;
    let focusedFnIdx = -1;
    let windowStart  = 0;

    function getFilteredFns(filter) {
      return ALL_FNS.filter(f => f.includes(filter.toLowerCase()));
    }

    function selectFn(fnName) {
      layer.activation = fnName === 'none' ? undefined : fnName;
      fnBtn.textContent = (layer.activation || 'none') + ' ▾';
      fnPanel.style.display = 'none';
      saveState();
    }

    function renderFnItems(filter) {
      const cur = layer.activation || 'none';
      const fns = getFilteredFns(filter);
      if (focusedFnIdx >= fns.length) focusedFnIdx = Math.max(0, fns.length - 1);
      // slide window so focusedFnIdx stays inside it
      if (focusedFnIdx < windowStart) windowStart = focusedFnIdx;
      if (focusedFnIdx >= windowStart + FN_WINDOW) windowStart = focusedFnIdx - FN_WINDOW + 1;
      windowStart = Math.max(0, Math.min(windowStart, Math.max(0, fns.length - FN_WINDOW)));
      const visible = fns.slice(windowStart, windowStart + FN_WINDOW);
      fnList.innerHTML = visible.map((f, i) => {
        const absIdx = windowStart + i;
        let cls = 'pe-fn-item';
        if (f === cur)           cls += ' pe-fn-active';
        if (absIdx === focusedFnIdx) cls += ' pe-fn-focused';
        return `<div class="${cls}" data-fn="${f}">${f}</div>`;
      }).join('');
      fnList.querySelectorAll('.pe-fn-item').forEach(el => {
        el.addEventListener('click', () => selectFn(el.dataset.fn));
      });
    }

    fnBtn.addEventListener('click', e => {
      e.stopPropagation();
      const open = fnPanel.style.display !== 'none';
      fnPanel.style.display = open ? 'none' : 'block';
      if (!open) {
        fnSearch.value = '';
        focusedFnIdx = ALL_FNS.indexOf(layer.activation || 'none');
        if (focusedFnIdx < 0) focusedFnIdx = 0;
        // open window centred around current activation
        windowStart = Math.max(0, focusedFnIdx - Math.floor(FN_WINDOW / 2));
        renderFnItems('');
        setTimeout(() => fnSearch.focus(), 10);
      }
    });

    fnSearch.addEventListener('input', () => {
      focusedFnIdx = 0;
      windowStart  = 0;
      renderFnItems(fnSearch.value);
    });

    fnSearch.addEventListener('keydown', e => {
      if (fnPanel.style.display === 'none') return;
      const fns = getFilteredFns(fnSearch.value);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusedFnIdx = (focusedFnIdx + 1) % fns.length;
        renderFnItems(fnSearch.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusedFnIdx = (focusedFnIdx - 1 + fns.length) % fns.length;
        renderFnItems(fnSearch.value);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedFnIdx >= 0 && focusedFnIdx < fns.length) selectFn(fns[focusedFnIdx]);
      } else if (e.key === 'Escape') {
        fnPanel.style.display = 'none';
      }
    });

    renderFnItems('');

  /* --- FLATTEN --- */
  } else if (layer.type === 'flatten') {
    if (layer.start_dim === undefined) layer.start_dim = 0;
    if (layer.end_dim   === undefined) layer.end_dim   = -1;
    const inc         = connections.filter(c => c.to === layer.id);
    const src         = inc.length > 0 ? shapeCache[inc[inc.length - 1].from] : null;
    const inShapeStr  = src ? `[${src.join(', ')}]` : '?';
    const outShape    = shapeCache[layer.id];
    const outShapeStr = outShape ? `[${outShape.join(', ')}]` : '?';
    peBody.innerHTML  = `
      <div class="pe-row"><span class="pe-label" style="font-size:9px;color:rgba(255,200,0,0.4);">${inShapeStr} → ${outShapeStr}</span></div>
      <div class="pe-row" style="margin-top:6px;"><span class="pe-label">START DIM</span><input class="pe-input" type="number" min="-32" max="32" value="${layer.start_dim}" id="pe-start-dim"></div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">END DIM</span><input class="pe-input" type="number" min="-32" max="32" value="${layer.end_dim}" id="pe-end-dim"></div>`;
    const sdInput = peBody.querySelector('#pe-start-dim');
    const edInput = peBody.querySelector('#pe-end-dim');
    sdInput.addEventListener('change', () => { layer.start_dim = parseInt(sdInput.value) || 0; saveState(); });
    edInput.addEventListener('change', () => { const v = parseInt(edInput.value); layer.end_dim = isNaN(v) ? -1 : v; saveState(); });
    setTimeout(() => sdInput.focus(), 50);

  /* --- CONV --- */
  } else if (layer.type === 'conv') {
    if (layer.out_channels  === undefined) layer.out_channels  = 16;
    if (layer.kernel_size   === undefined) layer.kernel_size   = 3;
    if (layer.stride        === undefined) layer.stride        = 1;
    if (layer.padding       === undefined) layer.padding       = 0;
    if (layer.dilation      === undefined) layer.dilation      = 1;
    if (layer.groups        === undefined) layer.groups        = 1;
    if (layer.ndim          === undefined) layer.ndim          = 2;
    const inc         = connections.filter(c => c.to === layer.id);
    const src         = inc.length > 0 ? shapeCache[inc[inc.length - 1].from] : null;
    const inShapeStr  = src ? `[${src.join(', ')}]` : '?';
    const outShape    = shapeCache[layer.id];
    const outShapeStr = outShape ? `[${outShape.join(', ')}]` : '?';
    peBody.innerHTML  = `
      <div class="pe-row"><span class="pe-label" style="font-size:9px;color:rgba(0,204,221,0.4);">${inShapeStr} → ${outShapeStr}</span></div>
      <div class="pe-row" style="margin-top:6px;"><span class="pe-label">DIM</span>
        <select class="pe-input" id="pe-ndim">
          <option value="1" ${layer.ndim === 1 ? 'selected' : ''}>1D</option>
          <option value="2" ${layer.ndim === 2 ? 'selected' : ''}>2D</option>
          <option value="3" ${layer.ndim === 3 ? 'selected' : ''}>3D</option>
        </select>
      </div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">OUT CHANNELS</span><input class="pe-input" type="number" min="1" value="${layer.out_channels}" id="pe-out-ch"></div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">KERNEL SIZE</span><input class="pe-input" type="number" min="1" value="${layer.kernel_size}" id="pe-ks"></div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">STRIDE</span><input class="pe-input" type="number" min="1" value="${layer.stride}" id="pe-stride"></div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">PADDING</span><input class="pe-input" type="number" min="0" value="${layer.padding}" id="pe-pad"></div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">DILATION</span><input class="pe-input" type="number" min="1" value="${layer.dilation}" id="pe-dil"></div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">GROUPS</span><input class="pe-input" type="number" min="1" value="${layer.groups}" id="pe-grp"></div>`;
    const fields = [
      { id: 'pe-ndim',    key: 'ndim', select: true },
      { id: 'pe-out-ch',  key: 'out_channels' },
      { id: 'pe-ks',      key: 'kernel_size' },
      { id: 'pe-stride',  key: 'stride' },
      { id: 'pe-pad',     key: 'padding' },
      { id: 'pe-dil',     key: 'dilation' },
      { id: 'pe-grp',     key: 'groups' },
    ];
    fields.forEach(f => {
      const inp = peBody.querySelector(`#${f.id}`);
      inp.addEventListener('change', () => {
        const raw = inp.value.trim();
        if (f.select) {
          layer[f.key] = parseInt(raw);
        } else {
          layer[f.key] = (raw !== '' && !isNaN(raw)) ? Math.max(1, parseInt(raw) || 1) : raw;
        }
        saveState();
      });
    });
    setTimeout(() => peBody.querySelector('#pe-out-ch').focus(), 50);

  /* --- SHARED_DENSE --- */
  } else if (layer.type === 'shared_dense') {
    const inc = connections.filter(c => c.to === layer.id);
    let inF   = '?';
    if (inc.length > 0) { const src = shapeCache[inc[0].from]; if (src) inF = src[0]; }
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label">INPUTS</span><span style="color:#ffc800;font-size:12px;font-family:'Courier New',monospace;">${inc.length}</span></div>
      <div class="pe-row"><span class="pe-label">IN FEATURES</span><span style="color:#ffc800;font-size:12px;font-family:'Courier New',monospace;">${inF}</span></div>
      <div class="pe-row" style="margin-top:2px;"><span class="pe-label" style="font-size:9px;color:rgba(0,229,204,0.4);">N×[in]→concat[N×out]</span></div>
      <div class="pe-row" style="margin-top:6px;"><span class="pe-label">OUT FEATURES</span><input class="pe-input" type="text" value="${layer.units || 128}"></div>`;
    const inp2 = peBody.querySelector('.pe-input');
    if (inp2) {
      inp2.addEventListener('change', () => {
        const raw = inp2.value.trim();
        layer.units = (raw !== '' && !isNaN(raw)) ? Math.max(1, parseInt(raw) || 1) : raw;
        saveState();
      });
      setTimeout(() => inp2.focus(), 50);
    }
  } else if (layer.type === 'add') {
    peTitle.textContent = 'ADD';
    const inc = connections.filter(c => c.to === layer.id);
    const shapes = inc.map(c => shapeCache[c.from]);
    const outShape = shapeCache[layer.id];
    const compatible = inc.length < 2 || outShape !== null;
    let html = '';
    if (inc.length === 0) {
      html = `<div class="pe-row"><span class="pe-label" style="color:rgba(170,255,0,0.5);">no inputs connected</span></div>`;
    } else {
      shapes.forEach((s, i) => {
        const col = (!compatible && s) ? '#ff5555' : 'rgba(170,255,0,0.7)';
        html += `<div class="pe-row"><span class="pe-label">IN ${i+1}</span><span style="color:${col};font-size:11px;font-family:'Courier New',monospace;">[${s ? s.join(', ') : '?'}]</span></div>`;
      });
      if (outShape) html += `<div class="pe-row" style="margin-top:4px;"><span class="pe-label">OUT</span><span style="color:rgba(170,255,0,0.9);font-size:11px;font-family:'Courier New',monospace;">[${outShape.join(', ')}]</span></div>`;
      if (!compatible) html += `<div class="pe-row" style="margin-top:4px;"><span class="pe-label" style="color:#ff4444;font-size:9px;">INCOMPATIBLE SHAPES</span></div>`;
    }
    html += `<div class="pe-row" style="margin-top:6px;border-top:1px solid rgba(128,128,128,0.2);padding-top:6px;"><span class="pe-label" style="font-size:9px;opacity:0.5;">element-wise sum · no params</span></div>`;
    peBody.innerHTML = html;

  } else if (layer.type === 'softmax') {
    peTitle.textContent = 'SOFTMAX';
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label">DIM</span><input class="pe-input" type="number" value="${layer.dim !== undefined ? layer.dim : -1}" id="pe-sm-dim" step="1"></div>`;
    const smDim = peBody.querySelector('#pe-sm-dim');
    if (smDim) {
      smDim.addEventListener('change', () => { layer.dim = parseInt(smDim.value) || -1; saveState(); });
      setTimeout(() => smDim.focus(), 50);
    }

  } else if (layer.type === 'unsqueeze') {
    peTitle.textContent = 'UNSQUEEZE';
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label">DIM</span><input class="pe-input" type="number" value="${layer.dim !== undefined ? layer.dim : 0}" id="pe-dim" step="1"></div>`;
    const dimInp = peBody.querySelector('#pe-dim');
    if (dimInp) {
      dimInp.addEventListener('change', () => {
        const v = parseInt(dimInp.value);
        layer.dim = isNaN(v) ? 0 : v;
        saveState();
      });
      setTimeout(() => dimInp.focus(), 50);
    }
  } else if (layer.type === 'bmm') {
    peTitle.textContent = 'BATCH MATMUL';
    const inc = connections.filter(c => c.to === layer.id);
    const shA = inc.length > 0 ? shapeCache[inc[0].from] : null;
    const shB = inc.length > 1 ? shapeCache[inc[1].from] : null;
    const fmtS = s => s ? `[${s.join(', ')}]` : '—';
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label">A</span><span class="pe-val">${fmtS(shA)}</span></div>
      <div class="pe-row"><span class="pe-label">B</span><span class="pe-val">${fmtS(shB)}</span></div>
      <div class="pe-hint">A @ B  (inner dims must match)</div>`;
  } else if (layer.type === 'squeeze') {
    peTitle.textContent = 'SQUEEZE';
    const dimVal = layer.dim !== undefined && layer.dim !== null ? layer.dim : '';
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label">DIM</span><input class="pe-input" type="number" value="${dimVal}" id="pe-dim" step="1" placeholder="all"></div>
      <div class="pe-hint">Leave blank → squeeze all size-1 dims</div>`;
    const dimInp = peBody.querySelector('#pe-dim');
    if (dimInp) {
      dimInp.addEventListener('change', () => {
        const v = dimInp.value.trim();
        layer.dim = v === '' ? null : (parseInt(v) || 0);
        saveState();
      });
      setTimeout(() => dimInp.focus(), 50);
    }
  }

  // name row — prepend so innerHTML assignments by type blocks don't wipe it
  {
    const nameRow = document.createElement('div'); nameRow.className = 'pe-row';
    nameRow.style.marginBottom = '8px'; nameRow.style.paddingBottom = '8px';
    nameRow.style.borderBottom = '1px solid rgba(128,128,128,0.2)';
    nameRow.innerHTML = '<span class="pe-label">NAME</span>';
    const nameInp = document.createElement('input');
    nameInp.className = 'pe-input'; nameInp.type = 'text';
    nameInp.placeholder = 'optional'; nameInp.value = layer.name || '';
    nameInp.style.width = '100px';
    nameInp.addEventListener('change', () => {
      layer.name = nameInp.value.trim() || undefined;
      saveState();
    });
    nameRow.appendChild(nameInp);
    peBody.prepend(nameRow);
  }

  // position the popup next to the layer box
  const [sx, sy] = worldToScreen(layer.x, layer.y);
  const boxW = t.w * zoom, boxH = t.h * zoom;
  let left = sx + boxW / 2 + 12;
  let top  = sy - 20;
  if (left + 200 > W) left = sx - boxW / 2 - 192;
  if (top < 10) top = 10;
  if (top + 150 > H) top = H - 160;
  propEditor.style.left    = left + 'px';
  propEditor.style.top     = top  + 'px';
  propEditor.style.display = 'block';
  propEditor._layerId      = layer.id;
  nodesDirty               = true;
}

function closePropEditor() {
  propEditor.style.display = 'none';
  propEditor._layerId      = null;
}

peClose.addEventListener('click', closePropEditor);

function openSuperboxEditor(sb) {
  selectedSuperboxId = sb.id;
  selectedLayerId = null;
  const peTitle = document.getElementById('pe-title');
  const peBody  = document.getElementById('pe-body');
  peTitle.textContent = 'GROUP';
  peTitle.style.color = SUPERBOX_COLORS[sb.colorIdx % SUPERBOX_COLORS.length];
  peTitle.style.textShadow = '';
  propEditor.style.setProperty('--pe-color', SUPERBOX_COLORS[sb.colorIdx % SUPERBOX_COLORS.length]);
  propEditor.style.setProperty('--pe-rgb', hexToRgb(SUPERBOX_COLORS[sb.colorIdx % SUPERBOX_COLORS.length]));
  peBody.innerHTML = '';

  const nameRow = document.createElement('div'); nameRow.className = 'pe-row';
  const nameLbl = document.createElement('span'); nameLbl.className = 'pe-label'; nameLbl.textContent = 'NAME';
  const nameInp = document.createElement('input'); nameInp.className = 'pe-input'; nameInp.value = sb.name || ''; nameInp.placeholder = 'group name';
  nameInp.addEventListener('input', () => { sb.name = nameInp.value; nodesDirty = true; });
  nameInp.addEventListener('change', () => saveState());
  nameRow.appendChild(nameLbl); nameRow.appendChild(nameInp);
  peBody.appendChild(nameRow);

  const infoRow = document.createElement('div'); infoRow.className = 'pe-hint';
  infoRow.textContent = `${sb.layerIds.length} layer${sb.layerIds.length !== 1 ? 's' : ''} · Ctrl+C/V to copy`;
  peBody.appendChild(infoRow);

  propEditor.style.display = 'block';
  setTimeout(() => nameInp.focus(), 50);
}
