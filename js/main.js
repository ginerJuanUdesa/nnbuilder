/* ============================================================
   main.js — resize, init, animation loop
   ============================================================ */

function resize() {
  W = canvas.width = nodeCanvas.width = window.innerWidth;
  H = canvas.height = nodeCanvas.height = window.innerHeight;
  gridDirty = true;
}
resize();
window.addEventListener('resize', resize);

document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

/* Restore persisted state, then boot the UI */
loadState();
renderVarsPanel();

/* Animation loop — capped at FRAME_MS, skips frames when idle */
function loop(ts) {
  requestAnimationFrame(loop);
  if (ts - lastFrameTime < FRAME_MS) return;
  lastFrameTime = ts;

  if (gridDirty) nodesDirty = true;

  const animatedTypes = ['flatten', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'conv', 'mean', 'linear', 'input', 'layernorm', 'rmsnorm', 'fanout'];
  // hasAnimated: cache result, only recompute when layer/connection count changes
  if (_hasAnimatedDirty) {
    const _cset = new Set(); for (const c of connections) { _cset.add(c.from); _cset.add(c.to); }
    _hasAnimatedCache = layers.some(l => animatedTypes.includes(l.type) && _cset.has(l.id));
    _hasAnimatedDirty = false;
  }
  const hasAnimated  = _hasAnimatedCache;
  const isAnimating = connectionMode || layerDragging || panDragging || groupDragging || sbDragging || !!paletteDragType || hasAnimated;

  if (!gridDirty && !nodesDirty && !isAnimating) return;

  time = ts / 1000;

  // FPS: EMA of inter-frame delta over rendered frames, DOM-updated ~4x/sec
  if (_fpsLastTs > 0) {
    const _dt = ts - _fpsLastTs;
    if (_dt > 0) {
      const _inst = 1000 / _dt;
      _fpsEMA = _fpsEMA > 0 ? _fpsEMA * 0.9 + _inst * 0.1 : _inst;
    }
  }
  _fpsLastTs = ts;
  if (ts - _fpsLastDom > 250) {
    _fpsLastDom = ts;
    const _fpsEl = document.getElementById('fps');
    if (_fpsEl) {
      const _v = Math.round(_fpsEMA);
      _fpsEl.textContent = _v;
      _fpsEl.style.color = _v >= 50 ? '#00ff88' : _v >= 25 ? '#ffc800' : '#ff3333';
    }
  }

  if (gridDirty) {
    buildGrid(); // clears gridDirty internally
    ctx.clearRect(0, 0, W, H);
    if (gridCanvas) ctx.drawImage(gridCanvas, 0, 0);
  }

  if (nodesDirty || isAnimating) draw();

  if (!isAnimating) nodesDirty = false;
}
requestAnimationFrame(loop);
