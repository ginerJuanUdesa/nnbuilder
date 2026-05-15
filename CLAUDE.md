# CLAUDE.md — NN Builder: Adding New Layer Boxes

## Architecture Overview

Vanilla JS, no build step, no framework. Files loaded via `<script>` in `index.html` — all globals shared.

```
js/
  config.js       — layerTypes palette (color, size, glow)
  state.js        — global mutable state (layers[], connections[], etc.)
  shapes.js       — resolveShape() — numeric shape propagation engine
  utils.js        — getDisplayShape(), canConnect(), hit testing
  renderer.js     — canvas draw loop, holograms, box subtexts
  prop-editor.js  — openPropEditor() — right-panel parameter UI
  persistence.js  — save/load localStorage + .nnb files (auto-handles new params)
  vars-panel.js   — variable system (name=value or name=formula)
  interactions.js — mouse/keyboard events
  main.js         — animation loop, resize
css/styles.css
index.html        — palette items, canvas elements
```

**Serialization is automatic.** Layer objects are plain JS objects stored in `layers[]`.
`_snap()` JSON-stringifies the whole array — any property you set on a layer is saved for free.
No changes to `persistence.js` needed unless renaming an existing type (see Migration section).

---

## Step-by-Step: Adding a New Layer

### Step 0 — Research PyTorch semantics

Before writing any code, look up the exact PyTorch behavior:
- What is the input shape? What is the output shape formula?
- How many inputs does the op take? (1 = unary, 2+ = multi-input)
- What are the configurable parameters? What are their defaults?
- Does it support negative indices? Batch broadcasting?
- Check edge cases: what happens with 0-dim or 1-dim input?

Verify with a concrete example:
```python
import torch
x = torch.randn(2, 4, 8)
out = torch.your_op(x, ...)
print(out.shape)  # verify formula matches
```

---

### Step 1 — `js/config.js`

Add entry to `layerTypes`. Pick a color distinct from all existing ones.

```js
myop: { w: 140, h: 70, color: '#RRGGBB', glow: '#RRGGBB', bg: 'rgba(R, G, B, 0.97)', lightColor: '#RRGGBB' },
```

- `color` / `glow` — neon hex, used for text, borders, glow in dark mode
- `bg` — dark mode box fill (keep alpha 0.97)
- `lightColor` — muted version of color for white/light mode

**Existing colors (avoid these):**
`#00ff88` input, `#0088ff` linear, `#ffc800` flatten, `#ff64ff` output,
`#ff8c00` mean, `#00ccdd` conv, `#e060a0` unsqueeze, `#c87af0` squeeze,
`#ff3333` softmax, `#aaff00` add, `#ff9500` matmul, `#44ffcc` scale, `#aa88ff` transpose

---

### Step 2 — `js/shapes.js` — numeric shape propagation

Add a block inside `resolveShape()`, **before** the `/* OUTPUT: passthrough */` comment.
Pattern for a single-input op:

```js
/* MYOP: description of what it does */
if (layer.type === 'myop') {
  const incoming = connections.filter(c => c.to === layerId);
  if (incoming.length === 0) { shapeCache[layerId] = null; return null; }
  const srcShape = resolveShape(incoming[0].from);
  if (!srcShape) { shapeCache[layerId] = null; return null; }

  // compute out from srcShape + layer params
  // use resolveVal(layer.someParam) to resolve variable names to numbers
  const out = /* your shape formula */;

  shapeCache[layerId] = out;
  return shapeCache[layerId];
}
```

For **multi-input** ops (like matmul, add) filter `connections.filter(c => c.to === layerId)`
and access `incoming[0].from`, `incoming[1].from` etc. Return `null` if count insufficient.

**Rules:**
- Always set `shapeCache[layerId]` before returning (even when returning null)
- Return `null` on any error — downstream layers handle null gracefully
- Use `resolveVal(layer.param)` to convert variable names/expressions to numbers
- Support negative dim indices: `if (d < 0) d = srcShape.length + d`

---

### Step 3 — `js/utils.js` — two edits

#### 3a. `getDisplayShape()` — variable-name-preserving version

Add block after the `softmax` / `scale` pass-through branches. This version preserves
variable name strings (e.g. `"B"`, `"T"`) instead of resolving to numbers — used for display.

```js
if (layer.type === 'myop') {
  const inc = connections.filter(c => c.to === layerId);
  if (inc.length === 0) return resolved;
  const srcDisp = getDisplayShape(inc[0].from);
  if (!srcDisp) return resolved;
  // apply same transform as shapes.js but on srcDisp (may contain strings)
  // use resolveVal() only when you need a number for arithmetic
  const out = /* display shape */;
  return out;
}
```

For pass-through ops: `return inc.length > 0 ? getDisplayShape(inc[0].from) : resolved;`

#### 3b. `canConnect()` — connection rules

Two edits:
1. Add `'myop'` to every existing source-type destination array (use replace_all on the last type in each array).
2. Add a new source line at the end of the return block (before the closing `)`):

```js
(from.type === 'myop' && ['linear', 'mean', 'flatten', 'output', 'conv',
  'unsqueeze', 'squeeze', 'softmax', 'add', 'matmul', 'scale', 'transpose', 'myop'
].includes(to.type))
```

Remove types from the destination list that don't make semantic sense as targets.
`'output'` should almost always be in the list. `'flatten'` only if op produces ≥1D.

---

### Step 4 — `js/renderer.js` — four edits

#### 4a. White-mode background map (`bgMap`)

Find the `const bgMap = {` block near the top of `drawLayerBox`. Add:

```js
myop: 'rgba(R2, G2, B2, 0.97)',  // light pastel version of the layer color
```

#### 4b. Subtext inside box

Add a branch in the subtext section (after the `if (zoom > 0.4)` guard, inside the
chain of `else if` blocks). Shows info below the layer name on the box face.

```js
} else if (layer.type === 'myop') {
  const text = /* what to show, e.g. shape, param summary */;
  nodeCtx.fillStyle = white ? tColor : `rgba(${hexToRgb(tColor)}, 0.65)`;
  nodeCtx.measureText(text).width > boxHalfW * 2
    ? wrapText(text, cx, baseY, boxHalfW * 2, subFontStr)
    : nodeCtx.fillText(text, cx, baseY);
```

Available variables: `layer`, `cx`, `cy`, `baseY`, `tColor`, `white`, `subFontStr`,
`boxHalfW`, `shapeCache`, `getDisplayShape()`, `resolveVal()`.

#### 4c. Hologram function

Add a top-level function `drawMyopHologram(layer, cx, cy, white)` before `drawScaleHologram`.

**Critical rules — violating these crashes the entire draw loop and makes all boxes invisible:**
- MUST start with `nodeCtx.save()`
- MUST end with `nodeCtx.restore()` — even on early return paths
- Use `if (zoom < 0.28) return;` guard at the very top BEFORE save
- Reference `layerTypes.myop.h` — NOT any other type name (this caused the bmm→matmul bug)

Template:

```js
function drawMyopHologram(layer, cx, cy, white) {
  if (zoom < 0.28) return;
  nodeCtx.save(); nodeCtx.globalAlpha = white ? 0.88 : 0.65;

  const colorRgb = white ? 'R, G, B' : 'R2, G2, B2'; // dark vs light mode RGB
  const boxH = layerTypes.myop.h * zoom;
  const flicker = 0.84 + Math.sin(time * 3.0 + layer.id * 1.5) * 0.09
                       + Math.sin(time * 8.0 + layer.id * 0.5) * 0.04;
  const gap = Math.max(8, 11 * zoom);
  // draw above the box: topY = cy - boxH/2 - gap - contentH

  nodeCtx.restore();
}
```

#### 4d. Dispatch + animatedTypes

In the hologram dispatch block (near end of draw loop):

```js
if (l.type === 'myop' && isConnected && !isHologramBlocked(l) && !inSuperbox) drawMyopHologram(l, sx, sy, white);
```

In `js/main.js`, add `'myop'` to `animatedTypes` array so animation loop keeps running.

---

### Step 5 — `js/prop-editor.js`

Add branch in `openPropEditor()`. Insert before the `} else if (layer.type === 'scale')` block.

```js
} else if (layer.type === 'myop') {
  peTitle.textContent = 'MYOP';
  // set defaults on layer object
  if (layer.someParam === undefined) layer.someParam = defaultValue;

  peBody.innerHTML = `
    <div class="pe-row">
      <span class="pe-label">PARAM</span>
      <input class="pe-input" type="number" value="${layer.someParam}" id="pe-myop-param" placeholder="default">
    </div>
    <div class="pe-hint">Brief description of what this op does</div>`;

  const inp = peBody.querySelector('#pe-myop-param');
  inp.addEventListener('change', () => {
    layer.someParam = parseInt(inp.value) || defaultValue;
    saveState();
  });
  setTimeout(() => inp.focus(), 50);
```

**UI elements available:** `pe-input` (text/number input), `pe-label` (left label),
`pe-row` (flex row), `pe-hint` (small gray hint text), checkboxes with `accent-color`.

---

### Step 6 — `index.html`

Add palette item. Order: put it near semantically similar layers.

```html
<div class="palette-item type-myop" data-type="myop">
  <div class="name">MYOP</div>
  <div class="desc">Short PyTorch description</div>
</div>
```

---

### Step 7 — `css/styles.css`

Add after the `type-transpose` block:

```css
.palette-item.type-myop      { border-color: rgba(R, G, B, 0.4); }
.palette-item.type-myop      .name { color: #RRGGBB; }
body.white-mode .palette-item.type-myop { background: rgba(R, G, B, 0.08); border-color: rgba(R2, G2, B2, 0.4); }
body.white-mode .palette-item.type-myop .name { color: #lightColor; }
```

---

## Migration (renaming an existing type)

If renaming `oldtype` → `newtype`, add migration in **both** places in `js/persistence.js`:

```js
// in loadState():
if (l.type === 'oldtype') l.type = 'newtype';

// in importFromFile():
if (l.type === 'oldtype') l.type = 'newtype';
```

---

## Common Bugs & Pitfalls

| Bug | Cause | Fix |
|-----|-------|-----|
| All boxes invisible when layer connected | Hologram crashes (save/restore imbalance or `layerTypes.wrongname.h`) | Wrap entire hologram in save/restore; verify type name in `layerTypes.XXX.h` matches config.js key |
| New layer not animating | Missing from `animatedTypes` in main.js | Add `'myop'` to the array |
| Shape shows numbers not variable names | `getDisplayShape` missing or calls `resolveVal` unnecessarily | Add branch that passes through string dim names |
| Can't connect TO new layer | Missing `'myop'` in destination arrays of other types in `canConnect` | Add to ALL existing source-type arrays, not just the new one |
| White mode box is black | Missing from `bgMap` in renderer.js | Add `myop: 'rgba(...)'` to bgMap |
| Layer params lost on save/load | Params stored as non-JSON values | Use plain numbers/strings/arrays only on layer object |
| ReferenceError on const in draw() | Variable declared after use in same function scope | Declare `const` at top of function, before any code that references it |

---

## Variable System

Users define named variables (`B=32`, `T=512`) and use them in layer params.
To support variables in a param field:
- Store as string: `layer.someParam = '512'` or `layer.someParam = 'B'`
- Resolve at compute time: `resolveVal(layer.someParam)` → number
- In `getDisplayShape`: pass the raw string through without resolving
- In `shapes.js`: call `resolveVal(layer.someParam)` to get the number

Variables also support formulas: `sqrt(B)`, `floor(T/8)` — handled by `evalFormula()`.
