# TorchBuilder — CLAUDE.md

## Project Vision

TorchBuilder is a visual neural network builder that brings a new way of designing PyTorch architectures. Users work on an infinite scrollable grid where they compose neural networks by placing and connecting **modules** — each module representing a matrix, tensor operation, or PyTorch layer. The goal is to make NN architecture design spatial and intuitive, replacing code-first iteration with a visual-first workflow.

## Core Goals

1. **Visual construction** — drag-and-place PyTorch modules (Linear, Conv2d, Attention, etc.) onto the grid, connect them with edges to define data flow
2. **Matrix-faithful semantics** — every node represents a real tensor transformation; shapes propagate automatically through the graph so the user always sees input/output dimensions
3. **Serialization** — architectures can be saved, loaded, and shared as files (`.torchbuilder` or similar format)
4. **PyTorch code export** — the built graph exports to clean, runnable `nn.Module` Python code that matches PyTorch conventions exactly (`y = xW^T + b`, correct initialization, named parameters)

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, vanilla Canvas 2D for the grid and node rendering
- **No build-step logic** — shape math runs in JS in the browser
- **Port**: 6969 (`./run.sh` or `npm run dev`)

## Architecture

```
app/
  layout.js       — topbar (PyTorch-style dark header, #ee4c2c accent)
  page.js         — three-column layout: left sidebar | canvas stage | right sidebar
  globals.css     — PyTorch palette, sidebar/stage/panel styles
components/
  Grid.js         — infinite pan/zoom canvas grid + variables panel at world (0,0)
                    dispatches 'worldinfo' CustomEvent each RAF frame
  LeftSidebar.js  — World Information (x, y, zoom, fps) + Modules sections
  RightSidebar.js — Module Information section
```

## Key Design Rules

- **PyTorch math is ground truth** — all shape formulas must match PyTorch exactly (verify with `torch.randn` if unsure)
- **World coordinate system** — camera `cam = {x, y, zoom}`, world origin (0,0) is where the variables panel lives; CSS position of world point `(wx, wy)` = `(-cam.x * cam.zoom, -cam.y * cam.zoom)` when `wx=wy=0`
- **Variables system** — users define named variables (`B=32`, `T=512`) used as symbolic dimensions in layer params; stored in `vars` state in `Grid.js`
- **World info bus** — `Grid.js` fires `window.dispatchEvent(new CustomEvent('worldinfo', { detail: {x, y, zoom, fps} }))` each frame; sidebars subscribe with `addEventListener`
- **No strict mode** — `reactStrictMode: false` to avoid double-effect teardown breaking the RAF loop

## Planned Features (not yet built)

- Module palette (drag Linear, Conv2d, Attention, etc. from left sidebar onto grid)
- Connection edges between modules with automatic shape propagation
- Shape mismatch detection and visual error highlighting
- Parameter count display (total trainable params in the graph)
- Export to `nn.Module` Python code
- Save/load `.torchbuilder` files (JSON graph serialization)
- Share links for built architectures
