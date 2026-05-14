/* ============================================================
   persistence.js — save/load, undo/redo
   ============================================================ */

const undoStack = [];
const redoStack = [];
let _prevSnap   = null;

function _snap() {
  return JSON.stringify({ layers, connections, nextId, variables });
}

function _applySnap(raw) {
  const data = JSON.parse(raw);
  layers.length      = 0; (data.layers      || []).forEach(l => layers.push(l));
  connections.length = 0; (data.connections || []).forEach(c => connections.push(c));
  variables.length   = 0; (data.variables   || []).forEach(v => variables.push(v));
  nextId     = data.nextId || 1;
  nodesDirty = true;
  gridDirty  = true;
}

function _persistLocal() {
  try {
    localStorage.setItem('nn-grid', JSON.stringify({
      layers, connections, nextId, camX, camY, zoom, variables
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
      nextId = data.nextId || 1;
      camX   = data.camX  || 0;
      camY   = data.camY  || 0;
      zoom   = data.zoom  || 1;
    }
  } catch (e) {}
  _prevSnap = _snap(); // baseline so first action pushes correctly
}
