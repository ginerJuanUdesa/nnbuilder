function renderVarsPanel() {
  const list = document.getElementById('vars-list');
  list.innerHTML = '';
  variables.forEach((v, i) => {
    const row = document.createElement('div'); row.className = 'var-row';

    const nameInp = document.createElement('input');
    nameInp.className = 'var-name'; nameInp.value = v.name; nameInp.placeholder = 'name';
    nameInp.addEventListener('change', () => { variables[i].name = nameInp.value.trim(); saveState(); renderVarsPanel(); });

    const eq = document.createElement('span'); eq.className = 'var-eq'; eq.textContent = '=';

    const hasFormula = v.formula && v.formula.trim();

    if (hasFormula) {
      const fInp = document.createElement('input');
      fInp.className = 'var-formula'; fInp.value = v.formula; fInp.placeholder = 'e.g. sqrt(B)';
      fInp.addEventListener('change', () => { variables[i].formula = fInp.value.trim(); saveState(); renderVarsPanel(); });

      const computed = document.createElement('span');
      computed.className = 'var-computed';
      computed.textContent = '→ ' + resolveVar(v, 0);

      const toggleBtn = document.createElement('span');
      toggleBtn.className = 'var-fntoggle'; toggleBtn.textContent = '123';
      toggleBtn.title = 'Switch to constant';
      toggleBtn.addEventListener('click', () => {
        variables[i].value = String(resolveVar(v, 0));
        variables[i].formula = '';
        saveState(); renderVarsPanel();
      });

      row.appendChild(nameInp); row.appendChild(eq); row.appendChild(fInp);
      row.appendChild(computed); row.appendChild(toggleBtn);
    } else {
      const valInp = document.createElement('input');
      valInp.className = 'var-val'; valInp.type = 'number'; valInp.value = v.value; valInp.placeholder = '1';
      valInp.addEventListener('change', () => { variables[i].value = valInp.value; saveState(); });

      const toggleBtn = document.createElement('span');
      toggleBtn.className = 'var-fntoggle'; toggleBtn.textContent = 'f(x)';
      toggleBtn.title = 'Switch to formula';
      toggleBtn.addEventListener('click', () => {
        variables[i].formula = v.value || '1';
        saveState(); renderVarsPanel();
      });

      row.appendChild(nameInp); row.appendChild(eq); row.appendChild(valInp); row.appendChild(toggleBtn);
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
  const list    = document.getElementById('vars-list');
  const addBtn  = document.getElementById('vars-add');
  const toggleBtn = document.getElementById('vars-toggle');
  list.style.display    = _varsOpen ? '' : 'none';
  addBtn.style.display  = _varsOpen ? '' : 'none';
  toggleBtn.textContent = _varsOpen ? '▾' : '▸';
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
