/* Property editor — doubles as the shape inspector */
const propEditor = document.getElementById('prop-editor');
const peTitle    = document.getElementById('pe-title');
const peBody     = document.getElementById('pe-body');
const peClose    = document.getElementById('pe-close');

function openPropEditor(layer) {
  const t = layerTypes[layer.type];
  peTitle.textContent = layer.type.toUpperCase() + ' LAYER';
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
