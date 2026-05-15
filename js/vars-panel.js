function renderVarsPanel() {
  const list = document.getElementById('vars-list');
  list.innerHTML = '';
  variables.forEach((v, i) => {
    const row = document.createElement('div'); row.className = 'var-row';

    /* ── Batch size variable B — pinned, locked name ── */
    if (v._batch) {
      row.className = 'var-row var-row-batch';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'var-name var-name-locked';
      nameSpan.textContent = 'BATCH';
      const eq = document.createElement('span'); eq.className = 'var-eq'; eq.textContent = '=';
      const valInp = document.createElement('input');
      valInp.className = 'var-val'; valInp.type = 'text';
      valInp.value = v.value || '32'; valInp.placeholder = '32';
      valInp.addEventListener('change', () => {
        variables[i].value = valInp.value.trim();
        variables[i].formula = '';
        saveState(); renderVarsPanel();
      });
      const badge = document.createElement('span');
      badge.className = 'var-batch-badge'; badge.textContent = 'BATCH';
      row.appendChild(nameSpan); row.appendChild(eq); row.appendChild(valInp); row.appendChild(badge);
      list.appendChild(row);
      return;
    }

    const nameInp = document.createElement('input');
    nameInp.className = 'var-name'; nameInp.value = v.name; nameInp.placeholder = 'name';
    nameInp.addEventListener('change', () => { variables[i].name = nameInp.value.trim(); saveState(); renderVarsPanel(); });

    const eq = document.createElement('span'); eq.className = 'var-eq'; eq.textContent = '=';

    // unified input: legacy formula field takes priority for display
    const displayVal = (v.formula && v.formula.trim()) ? v.formula : (v.value || '1');
    const isFormula  = !/^-?\d+$/.test(displayVal.trim());

    const valInp = document.createElement('input');
    valInp.className = isFormula ? 'var-formula' : 'var-val';
    valInp.type = 'text';
    valInp.value = displayVal;
    valInp.placeholder = '128 or sqrt(B)';
    valInp.addEventListener('change', () => {
      variables[i].value   = valInp.value.trim();
      variables[i].formula = ''; // clear legacy formula field
      saveState();
      renderVarsPanel();
    });

    row.appendChild(nameInp); row.appendChild(eq); row.appendChild(valInp);

    if (isFormula) {
      const computed = document.createElement('span');
      computed.className = 'var-computed';
      computed.textContent = '→ ' + resolveVar(v, 0);
      row.appendChild(computed);
    }

    const del = document.createElement('span'); del.className = 'var-del'; del.textContent = '×';
    del.addEventListener('click', () => { variables.splice(i, 1); saveState(); renderVarsPanel(); });
    row.appendChild(del);

    list.appendChild(row);
  });
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('white-mode');
  gridDirty = true;
});

let _varsOpen = false;
document.getElementById('vars-toggle').addEventListener('click', () => {
  _varsOpen = !_varsOpen;
  document.getElementById('vars-panel').style.display = _varsOpen ? '' : 'none';
});

document.getElementById('vars-add').addEventListener('click', () => {
  variables.push({ name: '', value: '1' });
  saveState();
  renderVarsPanel();
  const inputs = document.querySelectorAll('#vars-list .var-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
});

document.getElementById('save-file').addEventListener('click', exportToFile);

document.getElementById('load-file').addEventListener('click', importFromFile);

/* ── Strip button: active-state sync helper ── */
function syncStripButtons() {
  const connBtn  = document.getElementById('connect-toggle');
  const drawBtn  = document.getElementById('draw-toggle');
  const eraseBtn = document.getElementById('erase-toggle');
  if (connBtn)  connBtn.classList.toggle('active', !!connectionMode);
  if (drawBtn)  drawBtn.classList.toggle('active', !!drawMode);
  if (eraseBtn) eraseBtn.classList.toggle('active', !!eraseMode);
}

document.getElementById('connect-toggle').addEventListener('click', () => {
  connectionMode = !connectionMode; connectStartId = null;
  if (connectionMode) { drawMode = false; _sbDrawStart = null; _sbDrawCurrent = null; document.body.style.cursor = 'default'; }
  nodesDirty = true; syncStripButtons();
});

document.getElementById('draw-toggle').addEventListener('click', () => {
  drawMode = !drawMode;
  if (drawMode) { connectionMode = false; connectStartId = null; eraseMode = false; _eraseStart = null; _eraseCurrent = null; }
  _sbDrawStart = null; _sbDrawCurrent = null;
  document.body.style.cursor = drawMode ? 'crosshair' : 'default';
  nodesDirty = true; syncStripButtons();
});

document.getElementById('erase-toggle').addEventListener('click', () => {
  eraseMode = !eraseMode;
  if (eraseMode) { connectionMode = false; connectStartId = null; drawMode = false; _sbDrawStart = null; _sbDrawCurrent = null; }
  _eraseStart = null; _eraseCurrent = null;
  document.body.style.cursor = eraseMode ? 'crosshair' : 'default';
  nodesDirty = true; syncStripButtons();
});
