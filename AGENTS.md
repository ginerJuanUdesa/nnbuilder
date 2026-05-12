# AGENTS.md — NN Builder Grid

## What this is

Single-file (`grid.html`) infinite-canvas neural network builder. Visual, educational tool for understanding how neural net parameters are constructed. Follows PyTorch tensor multiplication conventions for all shape propagation.

## Purpose

- Help users understand how layer parameters (weights, biases) are built from tensor shapes
- Let users visually compose neural nets by connecting layer nodes on an infinite grid
- Show live parameter counts and tensor shapes on connections as the graph is edited

## Architecture

One HTML file, no build step, no dependencies. Two `<canvas>` elements stacked:
- `#grid` — background infinite grid (cached offscreen, only redrawn on pan/zoom)
- `#nodes` — layers, connections, labels (redrawn every animation frame)

State lives in plain JS arrays (`layers`, `connections`) and is persisted to `localStorage` under key `nn-grid`.

## Layer Types

| Type | Color | Configurable | Output Shape |
|------|-------|-------------|--------------|
| `input` | green `#00ff88` | `dims: number[]` (arbitrary rank) | `dims` directly |
| `dense` | blue `#0088ff` | `units: number` | `[...leading, units]` — preserves batch dims |
| `flatten` | yellow `#ffc800` | none | `[product_of_all_input_dims]` |
| `output` | magenta `#ff64ff` | none | passthrough from incoming layer |

## PyTorch Shape Conventions

Dense layer follows `torch.nn.Linear` semantics:

```
input shape:  [..., in_features]
output shape: [..., out_features]
params:       weight W[in_features, out_features] + bias b[out_features]
param count:  in_features * out_features + out_features
```

Leading batch dimensions are preserved. Only the last dimension is transformed.

Flatten follows `torch.nn.Flatten(start_dim=1)` semantics — collapses all dims into a 1D vector of size `product(all_dims)`.

## Shape Propagation (`computeOutputShapes`)

Called every frame before drawing. Resolves shapes recursively via `shapeCache[layerId]`. For multi-input layers, only the last incoming connection is used. Shape labels and param strings are annotated on each connection edge.

Connection edge label format:
```
W[in, out]  b[out]        ← bottom label (tensor notation)
in×out+bias=total_params  ← top label (arithmetic)
```

## Controls

| Action | Behavior |
|--------|----------|
| Drag from palette | Place layer snapped to 100px grid |
| Click layer | Open property editor (units / dims) |
| Drag layer | Move layer; snaps to grid on release |
| `C` | Toggle connection mode |
| Click layer in connect mode | Select as source, then click target to connect |
| Click connection | Select it (shows delete button) |
| Right-click connection | Delete immediately |
| Right-click canvas | Teleport camera to that world position |
| `Del` / `Backspace` | Delete selected layer or connection |
| `Escape` | Close editor / cancel connection mode |
| Scroll | Zoom (0.05x–50x) |
| Drag canvas | Pan |

## Valid Connection Rules (`canConnect`)

```
input  -> dense, flatten, output
dense  -> dense, flatten, output
flatten -> dense, output
```

Output layers have no outgoing connections.

## Coordinate System

- World space: infinite, origin at `(0, 0)` marked with a pulsing red dot
- Screen space: canvas pixels
- Transforms: `worldToScreen`, `screenToWorld` use `camX/camY` (camera position) and `zoom`
- Grid snapping: `snapToGrid(v)` rounds to nearest `gridSpacing` (100 world units)

## Data Model

```js
// Layer
{
  id: number,
  type: 'input' | 'dense' | 'flatten' | 'output',
  x: number,        // world coords, snapped to grid
  y: number,
  dims: number[],   // input only: e.g. [28, 28] or [3, 224, 224]
  units: number,    // dense only: e.g. 128
  outputShape: number[] | null  // output only: resolved at draw time
}

// Connection
{
  from: number,     // layer id
  to: number,       // layer id
  paramCount: number,
  paramLabel: string,
  paramLabelTop: string
}
```

## Key Implementation Notes

- Shape resolution is memoized per frame in `shapeCache` — reset at start of `computeOutputShapes()`
- Grid canvas is only rebuilt when `gridDirty = true` (pan, zoom, resize, drop)
- PRNG `hash(x, y)` used for deterministic grid dot brightness variation
- No framework, no bundler — open `grid.html` directly in browser
- All state auto-saves to `localStorage` on every mutation

## Extending

To add a new layer type:
1. Add entry to `layerTypes` (color, glow, bg, w, h)
2. Add palette item in HTML with `data-type`
3. Add shape resolution logic in `computeOutputShapes` → `resolveShape`
4. Add parameter count logic in the connection loop inside `computeOutputShapes`
5. Add property editor UI in `openPropEditor`
6. Update `canConnect` rules
