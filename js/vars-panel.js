function renderVarsPanel() {
  const list = document.getElementById('vars-list');
  list.innerHTML = '';
  variables.forEach((v, i) => {
    const row = document.createElement('div'); row.className = 'var-row';

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
