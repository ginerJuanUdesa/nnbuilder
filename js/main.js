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

  const animatedTypes = ['flatten', 'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'conv', 'mean', 'linear', 'input'];
  const hasAnimated  = layers.some(l => animatedTypes.includes(l.type) && connections.some(c => c.from === l.id || c.to === l.id));
  const isAnimating = connectionMode || layerDragging || panDragging || !!paletteDragType || hasAnimated;

  if (!gridDirty && !nodesDirty && !isAnimating) return;

  time = ts / 1000;

  if (gridDirty) {
    buildGrid(); // clears gridDirty internally
    ctx.clearRect(0, 0, W, H);
    if (gridCanvas) ctx.drawImage(gridCanvas, 0, 0);
  }

  if (nodesDirty || isAnimating) draw();

  if (!isAnimating) nodesDirty = false;
}
requestAnimationFrame(loop);
