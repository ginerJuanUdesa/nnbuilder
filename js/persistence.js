function saveState() {
  nodesDirty = true;
  try {
    localStorage.setItem('nn-grid', JSON.stringify({
      layers, connections, nextId, camX, camY, zoom, variables
    }));
  } catch (e) {}
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
}
