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
  propEditor.style.minWidth = '';
  peBody.innerHTML = '';

  /* --- INPUT --- */
  if (layer.type === 'input') {
    if (!layer.dims) layer.dims = [28, 28];
    const dimsContainer = document.createElement('div');
    dimsContainer.id = 'pe-dims-container';

    function renderDims() {
      dimsContainer.innerHTML = '';
      // Locked batch dim D0 = B
      const bRow = document.createElement('div'); bRow.className = 'pe-dim-row pe-dim-row-batch';
      const bLabel = document.createElement('span'); bLabel.className = 'pe-dim-label'; bLabel.textContent = 'D0';
      const bVal   = document.createElement('span'); bVal.className = 'pe-input pe-input-locked'; bVal.textContent = 'BATCH';
      bRow.appendChild(bLabel); bRow.appendChild(bVal); dimsContainer.appendChild(bRow);
      // User dims (D1, D2, …)
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
  } else if (layer.type === 'transpose') {
    peTitle.textContent = 'TRANSPOSE';
    if (layer.dim0 === undefined) layer.dim0 = 0;
    if (layer.dim1 === undefined) layer.dim1 = 1;
    const inc = connections.filter(c => c.to === layer.id);
    const src = inc.length > 0 ? shapeCache[inc[0].from] : null;
    const out = shapeCache[layer.id];
    const fmtS = s => s ? `[${s.join(', ')}]` : '?';
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label" style="font-size:9px;color:rgba(170,136,255,0.4);">${fmtS(src)} → ${fmtS(out)}</span></div>
      <div class="pe-row"><span class="pe-label">DIM0</span><input class="pe-input" type="number" value="${layer.dim0}" id="pe-t-dim0" step="1" placeholder="0" style="width:55px"></div>
      <div class="pe-row"><span class="pe-label">DIM1</span><input class="pe-input" type="number" value="${layer.dim1}" id="pe-t-dim1" step="1" placeholder="1" style="width:55px"></div>
      <div class="pe-hint">torch.transpose(x, dim0, dim1) — supports negatives</div>`;
    const d0inp = peBody.querySelector('#pe-t-dim0');
    const d1inp = peBody.querySelector('#pe-t-dim1');
    d0inp.addEventListener('change', () => { layer.dim0 = parseInt(d0inp.value) || 0; saveState(); });
    d1inp.addEventListener('change', () => { layer.dim1 = parseInt(d1inp.value) || 1; saveState(); });
    propEditor.style.minWidth = '130px';
    setTimeout(() => d0inp.focus(), 50);

  } else if (layer.type === 'layernorm') {
    peTitle.textContent = 'LAYER NORM';
    if (layer.normalized_shape === undefined) layer.normalized_shape = '';
    if (layer.eps               === undefined) layer.eps               = '1e-5';
    if (layer.elementwise_affine === undefined) layer.elementwise_affine = true;

    // Infer normalized_shape from incoming shape if not set
    const _inc = connections.filter(c => c.to === layer.id);
    const _src = _inc.length > 0 ? shapeCache[_inc[_inc.length - 1].from] : null;
    const _lastDim = _src ? _src[_src.length - 1] : '';
    const _nsPlaceholder = _lastDim !== '' ? String(_lastDim) : '64';

    peBody.innerHTML = `
      <div class="pe-row">
        <span class="pe-label">NORM SHAPE</span>
        <input class="pe-input" type="text" id="pe-ln-ns" value="${layer.normalized_shape}" placeholder="${_nsPlaceholder}">
      </div>
      <div class="pe-row">
        <span class="pe-label">EPS</span>
        <input class="pe-input" type="text" id="pe-ln-eps" value="${layer.eps}" style="width:80px">
      </div>
      <div class="pe-row">
        <span class="pe-label">AFFINE</span>
        <input type="checkbox" id="pe-ln-aff" ${layer.elementwise_affine ? 'checked' : ''} style="accent-color:var(--pe-color);width:16px;height:16px">
      </div>
      <div class="pe-hint">nn.LayerNorm — normalizes last dim(s), shape passthrough</div>`;

    peBody.querySelector('#pe-ln-ns').addEventListener('change', e => {
      const raw = e.target.value.trim();
      layer.normalized_shape = raw === '' ? '' : (isNaN(raw) ? raw : parseInt(raw));
      saveState();
    });
    peBody.querySelector('#pe-ln-eps').addEventListener('change', e => {
      layer.eps = e.target.value.trim() || '1e-5'; saveState();
    });
    peBody.querySelector('#pe-ln-aff').addEventListener('change', e => {
      layer.elementwise_affine = e.target.checked; saveState();
    });
    setTimeout(() => peBody.querySelector('#pe-ln-ns').focus(), 50);

  } else if (layer.type === 'rmsnorm') {
    peTitle.textContent = 'RMS NORM';
    if (layer.normalized_shape   === undefined) layer.normalized_shape   = '';
    if (layer.eps                === undefined) layer.eps                = '1e-8';
    if (layer.elementwise_affine === undefined) layer.elementwise_affine = true;

    const _inc = connections.filter(c => c.to === layer.id);
    const _src = _inc.length > 0 ? shapeCache[_inc[_inc.length - 1].from] : null;
    const _lastDim = _src ? _src[_src.length - 1] : '';
    const _nsPlaceholder = _lastDim !== '' ? String(_lastDim) : '64';

    peBody.innerHTML = `
      <div class="pe-row">
        <span class="pe-label">NORM SHAPE</span>
        <input class="pe-input" type="text" id="pe-rms-ns" value="${layer.normalized_shape}" placeholder="${_nsPlaceholder}">
      </div>
      <div class="pe-row">
        <span class="pe-label">EPS</span>
        <input class="pe-input" type="text" id="pe-rms-eps" value="${layer.eps}" style="width:80px">
      </div>
      <div class="pe-row">
        <span class="pe-label">AFFINE</span>
        <input type="checkbox" id="pe-rms-aff" ${layer.elementwise_affine ? 'checked' : ''} style="accent-color:var(--pe-color);width:16px;height:16px">
      </div>
      <div class="pe-hint">nn.RMSNorm — x÷RMS(x)×w, weight only (no bias), shape passthrough</div>`;

    peBody.querySelector('#pe-rms-ns').addEventListener('change', e => {
      const raw = e.target.value.trim();
      layer.normalized_shape = raw === '' ? '' : (isNaN(raw) ? raw : parseInt(raw));
      saveState();
    });
    peBody.querySelector('#pe-rms-eps').addEventListener('change', e => {
      layer.eps = e.target.value.trim() || '1e-8'; saveState();
    });
    peBody.querySelector('#pe-rms-aff').addEventListener('change', e => {
      layer.elementwise_affine = e.target.checked; saveState();
    });
    setTimeout(() => peBody.querySelector('#pe-rms-ns').focus(), 50);

  } else if (layer.type === 'scale') {
    peTitle.textContent = 'SCALE';
    if (layer.op     === undefined) layer.op     = '/';
    if (layer.factor === undefined) layer.factor = '1';
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label">OP</span>
        <select class="pe-input" id="pe-scale-op" style="background:rgba(0,20,40,0.8);color:#44ffcc;border:1px solid rgba(68,255,204,0.3);border-radius:3px;padding:4px 8px;font-size:13px;cursor:pointer;outline:none;">
          <option value="/" ${layer.op === '/' ? 'selected' : ''}>÷ divide</option>
          <option value="*" ${layer.op === '*' ? 'selected' : ''}>× multiply</option>
        </select>
      </div>
      <div class="pe-row" style="margin-top:6px;"><span class="pe-label">FACTOR</span><input class="pe-input" type="text" value="${layer.factor}" id="pe-scale-factor" placeholder="e.g. sqrt(dk)"></div>
      <div class="pe-hint">x ${layer.op === '/' ? '÷' : '×'} factor  (shape unchanged)</div>`;
    peBody.querySelector('#pe-scale-op').addEventListener('change', e => { layer.op = e.target.value; saveState(); nodesDirty = true; });
    peBody.querySelector('#pe-scale-factor').addEventListener('change', e => { layer.factor = e.target.value.trim(); saveState(); nodesDirty = true; });
    setTimeout(() => peBody.querySelector('#pe-scale-factor').focus(), 50);

  } else if (layer.type === 'triu') {
    peTitle.textContent = 'TRIU';
    if (!layer.dims) layer.dims = [1, 1];
    if (layer.diagonal === undefined) layer.diagonal = 0;
    if (layer.upper === undefined) layer.upper = true; // upper-triangular (triu) by default; false = tril
    const dc = document.createElement('div'); dc.id = 'pe-triu-dims';
    function renderTD() {
      dc.innerHTML = '';
      layer.dims.forEach((d, i) => {
        const row = document.createElement('div'); row.className = 'pe-dim-row';
        const lab = document.createElement('span'); lab.className = 'pe-dim-label'; lab.textContent = `D${i}`;
        const inp = document.createElement('input'); inp.className = 'pe-input'; inp.type = 'text'; inp.value = d;
        inp.addEventListener('change', () => {
          const raw = inp.value.trim();
          layer.dims[i] = (raw !== '' && !isNaN(raw)) ? Math.max(1, parseInt(raw) || 1) : raw;
          saveState(); nodesDirty = true; _shapesDirty = true;
        });
        row.appendChild(lab); row.appendChild(inp);
        if (layer.dims.length > 1) {
          const rm = document.createElement('span'); rm.className = 'pe-dim-remove'; rm.textContent = '\u00d7';
          rm.addEventListener('click', () => { layer.dims.splice(i, 1); saveState(); _shapesDirty = true; openPropEditor(layer); });
          row.appendChild(rm);
        }
        dc.appendChild(row);
      });
      const ab = document.createElement('div'); ab.className = 'pe-add-btn'; ab.textContent = '+ ADD DIM';
      ab.addEventListener('click', () => { layer.dims.push(1); saveState(); _shapesDirty = true; openPropEditor(layer); });
      dc.appendChild(ab);
    }
    renderTD();
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="pe-hint">torch.triu(torch.ones(*dims), diagonal) — upper-triangular ones. Source node (no batch dim).</div>
      <div class="pe-row" style="margin-top:6px;"><span class="pe-label">DIAGONAL</span><input class="pe-input" type="number" step="1" value="${layer.diagonal}" id="pe-triu-diag"></div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">UPPER TRI</span><input type="checkbox" id="pe-triu-bool" ${layer.upper ? 'checked' : ''} style="accent-color:#a3e635;width:14px;height:14px;cursor:pointer;"></div>`;
    peBody.appendChild(dc);
    peBody.appendChild(wrap);
    wrap.querySelector('#pe-triu-diag').addEventListener('change', e => {
      layer.diagonal = parseInt(e.target.value, 10) || 0; saveState(); nodesDirty = true; _shapesDirty = true;
    });
    wrap.querySelector('#pe-triu-bool').addEventListener('change', e => {
      layer.upper = e.target.checked; saveState(); nodesDirty = true;
    });
    setTimeout(() => { const f = dc.querySelector('.pe-input'); if (f) f.focus(); }, 50);

  } else if (layer.type === 'maskedfill') {
    peTitle.textContent = 'MASKED_FILL';
    if (layer.value === undefined) layer.value = '-inf';
    const inc = connections.filter(c => c.to === layer.id);
    const sStr = inc[0] ? `[${(shapeCache[inc[0].from]||['?']).join(', ')}]` : '?';
    const mStr = inc[1] ? `[${(shapeCache[inc[1].from]||['?']).join(', ')}]` : '(no mask)';
    const oShape = getDisplayShape(layer.id);
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label" style="font-size:9px;color:rgba(251,113,133,0.6);">scores ${sStr} · mask ${mStr} → ${oShape ? '['+oShape.join(', ')+']' : '?'}</span></div>
      <div class="pe-row" style="margin-top:6px;"><span class="pe-label">VALUE</span><input class="pe-input" type="text" value="${layer.value}" id="pe-mf-val" placeholder="-inf or 0"></div>
      <div class="pe-hint">scores.masked_fill(mask, value) — input 0 = scores, input 1 = mask. Fills where mask is True.</div>`;
    const vi = peBody.querySelector('#pe-mf-val');
    vi.addEventListener('change', () => { layer.value = vi.value.trim() || '-inf'; saveState(); nodesDirty = true; });
    setTimeout(() => vi.focus(), 50);

  } else if (layer.type === 'fanout') {
    peTitle.textContent = 'FANOUT';
    if (layer.n === undefined) layer.n = 2;
    const oShape  = getDisplayShape(layer.id);
    const oStr    = oShape ? `[${oShape.join(', ')}]` : '?';
    const innerT  = layer._fanoutInnerType || null;
    const prm     = (typeof layer._fanoutParams === 'number') ? layer._fanoutParams : 0;
    const innerLine = innerT
      ? `<span style="color:#22c55e;">inner: ${innerT}</span>`
      : `<span style="color:#ef4444;">no box inside — drop one in</span>`;
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label" style="font-size:9px;color:rgba(217,70,239,0.6);">${innerLine}</span></div>
      <div class="pe-row"><span class="pe-label">N</span><input class="pe-input" type="text" value="${layer.n}" id="pe-fanout-n" placeholder="2 or a var"></div>
      <div class="pe-row" style="margin-top:4px;"><span class="pe-label">INDEPENDENT</span><input type="checkbox" id="pe-fanout-indep" ${layer.independent !== false ? 'checked' : ''} style="accent-color:#d946ef;width:14px;height:14px;cursor:pointer;"></div>
      <div class="pe-row"><span class="pe-label" style="font-size:9px;color:rgba(217,70,239,0.55);">out (stacked) → ${oStr} · ${prm.toLocaleString()} params ${layer.independent !== false ? '(×N distinct)' : '(shared)'}</span></div>`;
    const ni = peBody.querySelector('#pe-fanout-n');
    ni.addEventListener('change', () => {
      const v = ni.value.trim();
      layer.n = /^-?\d+$/.test(v) ? Math.max(1, parseInt(v, 10)) : (v || 2);
      saveState(); nodesDirty = true; _shapesDirty = true; openPropEditor(layer);
    });
    const ind = peBody.querySelector('#pe-fanout-indep');
    ind.addEventListener('change', () => {
      layer.independent = ind.checked;
      saveState(); nodesDirty = true; _shapesDirty = true; openPropEditor(layer);
    });
    setTimeout(() => ni.focus(), 50);

  } else if (layer.type === 'concat') {
    peTitle.textContent = 'CONCAT';
    if (layer.dim === undefined) layer.dim = -1; // torch: join on feature dim, batch (0) untouched
    const inc = connections.filter(c => c.to === layer.id);
    const inStrs = inc.map(c => { const sh = shapeCache[c.from]; return sh ? `[${sh.join(', ')}]` : '—'; });
    const out = getDisplayShape(layer.id);
    const outStr = out ? `[${out.join(', ')}]` : '?';
    peBody.innerHTML = `
      <div class="pe-row"><span class="pe-label" style="font-size:9px;color:rgba(125,95,255,0.55);">${inc.length} in → ${outStr}</span></div>
      <div class="pe-row"><span class="pe-label">DIM</span><input class="pe-input" type="number" step="1" value="${layer.dim}" id="pe-cat-dim"></div>
      <div class="pe-hint">torch.cat — joins inputs along DIM (negative ok). All other dims must match.</div>
      <div class="pe-hint" style="font-size:9px;opacity:0.6;">${inStrs.join('  ·  ') || 'no inputs'}</div>`;
    const di = peBody.querySelector('#pe-cat-dim');
    di.addEventListener('change', () => {
      const v = di.value.trim();
      layer.dim = v === '' ? 0 : (parseInt(v, 10) || 0);
      saveState(); nodesDirty = true; openPropEditor(layer);
    });
    setTimeout(() => di.focus(), 50);
  } else if (layer.type === 'custom') {
    peTitle.textContent = (layer.customName || 'CUSTOM').toUpperCase();
    const inc = connections.filter(c => c.to === layer.id);
    const src = inc.length > 0 ? shapeCache[inc[inc.length - 1].from] : null;
    const inStr  = src ? `[${src.join(', ')}]` : '?';
    const oShape = getDisplayShape(layer.id);
    const outStr = oShape ? `[${oShape.join(', ')}]` : '?';
    const prm    = (typeof layer._customParams === 'number') ? layer._customParams : 0;
    const err    = layer._customErr;
    const vars   = ((layer.subnet && layer.subnet.variables) || []).filter(v => v && v.name && !v._batch);
    if (!layer.varOverrides) layer.varOverrides = {};
    let html = `<div class="pe-row"><span class="pe-label" style="font-size:9px;color:rgba(255,95,162,0.55);">${inStr} → ${outStr}</span></div>`;
    html += `<div class="pe-row"><span class="pe-label">PARAMS</span><span class="pe-val">${prm.toLocaleString()}</span></div>`;
    if (err) html += `<div class="pe-hint" style="color:#ff6666;">⚠ ${err}</div>`;
    if (vars.length) {
      html += `<div class="pe-hint">Variables — override to customize this instance:</div>`;
      vars.forEach(v => {
        let def = (v.formula && String(v.formula).trim()) ? v.formula : (v.value != null ? v.value : '');
        // follows a matching GLOBAL variable when present (auto-pick)
        const g = (typeof variables !== 'undefined') ? variables.find(x => x && x.name === v.name && !x._batch) : null;
        const linked = !!g;
        if (linked && typeof resolveVal === 'function') def = resolveVal(v.name);
        const cur = (layer.varOverrides[v.name] !== undefined) ? layer.varOverrides[v.name] : def;
        const tag = linked ? ` <span style="font-size:8px;opacity:0.6;">(global)</span>` : '';
        html += `<div class="pe-row"><span class="pe-label">${v.name}${tag}</span><input class="pe-input" type="text" data-vname="${v.name}" value="${cur}" placeholder="${def}"></div>`;
      });
    } else {
      html += `<div class="pe-hint">No customizable variables in this box</div>`;
    }
    peBody.innerHTML = html;
    peBody.querySelectorAll('input[data-vname]').forEach(inp => {
      inp.addEventListener('change', () => {
        const nm = inp.dataset.vname, val = inp.value.trim();
        if (val === '') delete layer.varOverrides[nm];
        else layer.varOverrides[nm] = val;
        saveState(); nodesDirty = true;
        openPropEditor(layer); // refresh shape/param readout
      });
    });
  } else if (layer.type === 'matmul') {
    peTitle.textContent = 'MATMUL';
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

  // center on screen
  propEditor.style.display = 'block';
  const edW = propEditor.offsetWidth  || 220;
  const edH = propEditor.offsetHeight || 100;
  propEditor.style.left = Math.max(10, (W - edW) / 2) + 'px';
  propEditor.style.top  = Math.max(10, (H - edH) / 2) + 'px';
  setTimeout(() => nameInp.focus(), 50);
}
