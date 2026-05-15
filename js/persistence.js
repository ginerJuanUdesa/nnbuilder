/* ============================================================
   persistence.js — save/load, undo/redo
   ============================================================ */

const undoStack = [];
const redoStack = [];
let _prevSnap   = null;

function _snap() {
  return JSON.stringify({ layers, connections, nextId, variables, superboxes });
}

function _applySnap(raw) {
  const data = JSON.parse(raw);
  layers.length      = 0; (data.layers      || []).forEach(l => layers.push(l));
  connections.length = 0; (data.connections || []).forEach(c => connections.push(c));
  variables.length   = 0; (data.variables   || []).forEach(v => variables.push(v));
  superboxes.length  = 0; (data.superboxes  || []).forEach(s => superboxes.push(s));
  nextId     = data.nextId || 1;
  nodesDirty = true;
  gridDirty  = true;
}

function _persistLocal() {
  try {
    localStorage.setItem('nn-grid', JSON.stringify({
      layers, connections, nextId, camX, camY, zoom, variables, superboxes
    }));
  } catch (e) {}
}

function saveState() {
  if (_prevSnap !== null) {
    undoStack.push(_prevSnap);
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  _prevSnap  = _snap();
  nodesDirty = true;
  _persistLocal();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(_snap());
  const prev = undoStack.pop();
  _applySnap(prev);
  _prevSnap = prev;
  _persistLocal();
  selectedLayerId = null; selectedConnIdx = -1;
  closePropEditor();
  renderVarsPanel();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(_snap());
  const next = redoStack.pop();
  _applySnap(next);
  _prevSnap = next;
  _persistLocal();
  selectedLayerId = null; selectedConnIdx = -1;
  closePropEditor();
  renderVarsPanel();
}

function loadState() {
  try {
    const raw = localStorage.getItem('nn-grid');
    if (raw) {
      const data = JSON.parse(raw);
      layers.length = 0;
      connections.length = 0;
      if (data.layers) data.layers.forEach(l => {
        if (l.type === 'dense') l.type = 'linear'; // migrate old saves
        layers.push(l);
      });
      if (data.connections) data.connections.forEach(c => connections.push(c));
      if (data.variables) variables.push(...data.variables);
      if (data.superboxes) data.superboxes.forEach(s => superboxes.push(s));
      nextId = data.nextId || 1;
      camX   = data.camX  || 0;
      camY   = data.camY  || 0;
      zoom   = data.zoom  || 1;
    }
  } catch (e) {}
  _prevSnap = _snap(); // baseline so first action pushes correctly
}

/* ============================================================
   File export / import (.nnb = JSON)
   ============================================================ */

function exportToFile() {
  const data = {
    version: 1,
    layers,
    connections,
    nextId,
    variables,
    camera: { x: camX, y: camY, zoom }
  };
  const raw = prompt('Save as:', 'network');
  if (raw === null) return; // cancelled
  const name = (raw.trim() || 'network').replace(/\.nnb$/i, '') + '.nnb';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function importFromFile() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.nnb,application/json';
  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        // migrate dense → linear
        (data.layers || []).forEach(l => { if (l.type === 'dense') l.type = 'linear'; });
        // push undo checkpoint before replacing state
        if (_prevSnap !== null) {
          undoStack.push(_prevSnap);
          if (undoStack.length > 100) undoStack.shift();
          redoStack.length = 0;
        }
        layers.length      = 0; (data.layers      || []).forEach(l => layers.push(l));
        connections.length = 0; (data.connections || []).forEach(c => connections.push(c));
        variables.length   = 0; (data.variables   || []).forEach(v => variables.push(v));
        nextId = data.nextId || 1;
        if (data.camera) { camX = data.camera.x || 0; camY = data.camera.y || 0; zoom = data.camera.zoom || 1; }
        _prevSnap  = _snap();
        nodesDirty = true;
        gridDirty  = true;
        _persistLocal();
        selectedLayerId = null; selectedConnIdx = -1;
        closePropEditor();
        renderVarsPanel();
      } catch (err) {
        alert('Failed to load .nnb file: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

/* ============================================================
   Superbox copy/paste
   ============================================================ */

function copySuperbox(sb) {
  copiedSuperbox = JSON.parse(JSON.stringify(sb));
}

function pasteSuperbox() {
  if (!copiedSuperbox) return;
  const dx = gridSpacing * 2, dy = gridSpacing * 2;
  const idMap = {};
  // duplicate layers
  const newLayers = copiedSuperbox.layerIds.map(id => {
    const l = layers.find(x => x.id === id);
    if (!l) return null;
    const nl = JSON.parse(JSON.stringify(l));
    nl.id = nextId++;
    nl.x += dx; nl.y += dy;
    idMap[l.id] = nl.id;
    return nl;
  }).filter(Boolean);
  // duplicate internal connections only
  const newConns = connections.filter(c =>
    copiedSuperbox.layerIds.includes(c.from) && copiedSuperbox.layerIds.includes(c.to)
  ).map(c => ({ from: idMap[c.from], to: idMap[c.to] }));
  newLayers.forEach(l => layers.push(l));
  newConns.forEach(c => connections.push(c));
  const newSb = {
    id: nextId++,
    name: copiedSuperbox.name ? copiedSuperbox.name + ' copy' : '',
    x: copiedSuperbox.x + dx, y: copiedSuperbox.y + dy,
    w: copiedSuperbox.w, h: copiedSuperbox.h,
    layerIds: newLayers.map(l => l.id),
    colorIdx: copiedSuperbox.colorIdx
  };
  superboxes.push(newSb);
  selectedSuperboxId = newSb.id;
  selectedLayerId = null;
  saveState();
}
