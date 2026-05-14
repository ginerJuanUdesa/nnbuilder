function renderVarsPanel() {
  const list = document.getElementById('vars-list');
  list.innerHTML = '';
  variables.forEach((v, i) => {
    const row     = document.createElement('div'); row.className = 'var-row';
    const nameInp = document.createElement('input'); nameInp.className = 'var-name'; nameInp.value = v.name; nameInp.placeholder = 'name';
    nameInp.addEventListener('change', () => { variables[i].name = nameInp.value.trim(); saveState(); });
    const eq      = document.createElement('span'); eq.className = 'var-eq'; eq.textContent = '=';
    const valInp  = document.createElement('input'); valInp.className = 'var-val'; valInp.type = 'number'; valInp.value = v.value; valInp.placeholder = '1';
    valInp.addEventListener('change', () => { variables[i].value = valInp.value; saveState(); });
    const del     = document.createElement('span'); del.className = 'var-del'; del.textContent = '×';
    del.addEventListener('click', () => { variables.splice(i, 1); saveState(); renderVarsPanel(); });
    row.appendChild(nameInp); row.appendChild(eq); row.appendChild(valInp); row.appendChild(del);
    list.appendChild(row);
  });
}

document.getElementById('theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('white-mode');
  gridDirty = true;
});

document.getElementById('vars-add').addEventListener('click', () => {
  variables.push({ name: '', value: '1' });
  saveState();
  renderVarsPanel();
  const inputs = document.querySelectorAll('#vars-list .var-name');
  if (inputs.length) inputs[inputs.length - 1].focus();
});
