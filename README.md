# NN Builder

A browser-based neural network composer that mirrors PyTorch's module semantics. Drag layers onto a canvas, wire them together, and watch tensor shapes propagate automatically — no Python or runtime required.

![NN Builder screenshot](https://i.imgur.com/t9PYbNj.png)

---

## Features

- **Auto shape propagation** — output shapes update live as you connect layers, using PyTorch-exact formulas
- **PyTorch-faithful layer types** — Linear, Conv2d, Flatten, Reshape, Transpose, Squeeze/Unsqueeze, LayerNorm, RMSNorm, Softmax, MatMul, Add, Scale, MaskedFill, TRIU, FANOUT, and more
- **Variable system** — define `B=32`, `T=512` and use them in any layer param; shapes display as `[B, T, 256]`
- **Custom boxes** — save a sub-network as a `.nnb` file and reuse it as a single composable module
- **Save / load** — networks persist to localStorage and export as `.nnb` JSON files
- **Dark + light mode** — holographic neon canvas UI with a clean white-mode toggle

---

## Run locally

```bash
npx browser-sync start \
  --server \
  --files "**/*.html, **/*.css, **/*.js" \
  --port 3000 \
  --index index.html
```

Or just open `index.html` directly in a browser (no build step needed).

---

## Layer types

| Group | Layers |
|-------|--------|
| I / O | INPUT, OUTPUT |
| Linear | LINEAR |
| Convolutional | CONV |
| Reshape | FLATTEN, RESHAPE, TRANSPOSE, UNSQUEEZE, SQUEEZE |
| Reduction | MEAN |
| Matrix Math | MATMUL, ADD, SCALE, TRIU, CONCAT, MASKEDFILL |
| Normalization | LAYERNORM, RMSNORM |
| Elementwise | SOFTMAX |
| Structural | FANOUT, CUSTOM |

---

## Adding a new layer

See [`CLAUDE.md`](CLAUDE.md) for the full step-by-step guide (config → shape propagation → renderer → prop editor → palette).

---

## CI

GitHub Actions runs on every push to `develop` and every PR to `master`:

| Job | What it checks |
|-----|----------------|
| **lint** | ESLint — syntax errors, undefined globals, redeclarations |
| **shape-tests** | Playwright — shape propagation, serialization round-trip, `canConnect()` matrix |
| **html-validate** | W3C-style HTML validation |
| **deploy-preview** | Cloudflare Pages preview URL posted to the PR (PRs only) |

---

## Tech stack

Vanilla JS · no build step · no framework · Cloudflare Pages
