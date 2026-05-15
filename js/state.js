/* Canvas elements */
const canvas     = document.getElementById('grid');
const ctx        = canvas.getContext('2d');
const nodeCanvas = document.getElementById('nodes');
const nodeCtx    = nodeCanvas.getContext('2d');
const ghostEl    = document.getElementById('ghost');

/* Viewport */
let W, H;
let camX = 0, camY = 0;
let zoom = 1;
let time = 0;

/* Render flags */
let gridDirty     = true;
let nodesDirty    = true;
let lastFrameTime = 0;
let gridCanvas    = null;

/* Graph data */
const layers      = [];
const connections = [];
let variables     = [];
let nextId        = 1;

/* Selection */
let selectedLayerId = null;
let selectedConnIdx = -1;
let mouseDownDist   = 0;
let mouseDownX = 0, mouseDownY = 0;
let lastMouseSX = 0, lastMouseSY = 0; // live cursor screen pos (for paste centering)

/* Connection mode */
let connectionMode = false;
let connectStartId = null;
let connectStartSide = null; // side-centre the in-progress wire starts from
let connectMouseX  = 0, connectMouseY = 0;

/* Palette drag */
let paletteDragType   = null;
let paletteDragOffset = { x: 0, y: 0 };

/* Pan drag */
let panDragging = false;
let panStartX = 0, panStartY = 0, panCamX = 0, panCamY = 0;

/* Layer drag */
let layerDragging  = false;
let layerDragId    = null;
let layerDragOffX  = 0, layerDragOffY  = 0;
let layerDragOrigX = 0, layerDragOrigY = 0;

/* Connection drag (repositioning elbow) */
let connDragging    = false;
let connDragIdx     = -1;
let connDragStartSX = 0;
let connDragStartElbowWX = 0;

/* Copy/paste */
let clipboard = null;

/* Superboxes */
let superboxes = [];
let selectedSuperboxId = null;
let drawMode = false;
let _sbDrawStart = null;
let _sbDrawCurrent = null;
let sbDragging = false;
let sbDragId = null;
let sbDragOffX = 0, sbDragOffY = 0;
let sbResizing = false;
let sbResizeId = null;
let sbResizeEdge = null;
let sbResizeStartX = 0, sbResizeStartY = 0;
let sbResizeOrigX = 0, sbResizeOrigY = 0, sbResizeOrigW = 0, sbResizeOrigH = 0;
let copiedSuperbox = null;

/* Erase mode */
let eraseMode = false;
let _eraseStart = null;
let _eraseCurrent = null;

/* Visibility */
let visible = true;
