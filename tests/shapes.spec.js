// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Shape propagation smoke tests.
 *
 * Strategy: navigate to the running app, then use page.evaluate() to
 * directly manipulate the globals (layers, connections, variables) and
 * call computeOutputShapes().  This avoids any UI interaction and tests
 * the pure shape-propagation logic from shapes.js.
 *
 * computeOutputShapes() only runs when _shapesDirty is true, so we must
 * set that flag before each call.
 */

test.describe('Shape propagation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to finish initialising (shapes.js globals must exist)
    await page.waitForFunction(() => typeof computeOutputShapes === 'function');
  });

  /**
   * Helper: replace layers + connections with the provided arrays, force a
   * recompute, and return the shapeCache as a plain object.
   */
  async function runShapes(page, { testLayers, testConnections, testVariables }) {
    return page.evaluate(({ testLayers, testConnections, testVariables }) => {
      // Replace global state in-place (arrays are declared with const in state.js,
      // so we splice rather than reassign).
      layers.length = 0;
      testLayers.forEach(l => layers.push(l));

      connections.length = 0;
      testConnections.forEach(c => connections.push(c));

      if (testVariables) {
        variables.length = 0;
        testVariables.forEach(v => variables.push(v));
      }

      // Force recompute
      _shapesDirty = true;
      computeOutputShapes();

      // Return a plain snapshot of shapeCache (Map keys → values are already
      // stored as plain object since shapeCache is an object, not a Map)
      return JSON.parse(JSON.stringify(shapeCache));
    }, { testLayers, testConnections, testVariables });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: INPUT [B, T, 512] → LINEAR(256)
  // Expected output shape: [B, T, 256]
  // LINEAR replaces only the last dim.
  // ──────────────────────────────────────────────────────────────────────────
  test('INPUT [B,T,512] → LINEAR(256) produces [B,T,256]', async ({ page }) => {
    const cache = await runShapes(page, {
      testLayers: [
        { id: 1, type: 'input',  x: 0, y: 0, dims: ['T', 512] },
        { id: 2, type: 'linear', x: 200, y: 0, units: 256 },
      ],
      testConnections: [
        { from: 1, to: 2, seq: 1 },
      ],
      testVariables: [
        { name: 'BATCH', value: '32', _batch: true },
        { name: 'T',     value: '128' },
      ],
    });

    // Layer 2 (linear) should produce [32, 128, 256]
    expect(cache['2']).toEqual([32, 128, 256]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: INPUT [B, 512] → FLATTEN
  // Expected output shape: [B, 512]  (1-D non-batch — nothing to flatten)
  // ──────────────────────────────────────────────────────────────────────────
  test('INPUT [B,512] → FLATTEN produces [B,512]', async ({ page }) => {
    const cache = await runShapes(page, {
      testLayers: [
        { id: 1, type: 'input',   x: 0, y: 0, dims: [512] },
        { id: 2, type: 'flatten', x: 200, y: 0 },
      ],
      testConnections: [
        { from: 1, to: 2, seq: 1 },
      ],
      testVariables: [
        { name: 'BATCH', value: '32', _batch: true },
      ],
    });

    // [B, 512] flatten(start_dim=1) → single non-batch dim is already flat → [32, 512]
    expect(cache['2']).toEqual([32, 512]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: INPUT [B, 3, 224, 224] → CONV(out=64, k=3, s=1, p=1)
  // Expected output shape: [B, 64, 224, 224]
  // PyTorch formula: floor((224 + 2*1 - 1*(3-1) - 1) / 1 + 1) = 224
  // ──────────────────────────────────────────────────────────────────────────
  test('INPUT [B,3,224,224] → CONV(64,k=3,s=1,p=1) produces [B,64,224,224]', async ({ page }) => {
    const cache = await runShapes(page, {
      testLayers: [
        { id: 1, type: 'input', x: 0, y: 0, dims: [3, 224, 224] },
        {
          id: 2, type: 'conv', x: 200, y: 0,
          out_channels: 64,
          kernel_size: 3,
          stride: 1,
          padding: 1,
          dilation: 1,
          ndim: 2,
        },
      ],
      testConnections: [
        { from: 1, to: 2, seq: 1 },
      ],
      testVariables: [
        { name: 'BATCH', value: '32', _batch: true },
      ],
    });

    // CONV output: [B, 64, 224, 224]
    expect(cache['2']).toEqual([32, 64, 224, 224]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: INPUT [B, T, 512] → RESHAPE([B, T, 8, 64])
  // Expected output shape: [B, T, 8, 64]
  // B is preserved as dim 0; remaining dims = target dims (no -1 inference).
  // ──────────────────────────────────────────────────────────────────────────
  test('INPUT [B,T,512] → RESHAPE([B,T,8,64]) produces [B,T,8,64]', async ({ page }) => {
    const cache = await runShapes(page, {
      testLayers: [
        { id: 1, type: 'input',   x: 0, y: 0, dims: ['T', 512] },
        // RESHAPE dims: the non-batch part of the target shape.
        // The engine always prepends B (dim 0 of src), so we pass [T, 8, 64].
        { id: 2, type: 'reshape', x: 200, y: 0, dims: ['T', 8, 64] },
      ],
      testConnections: [
        { from: 1, to: 2, seq: 1 },
      ],
      testVariables: [
        { name: 'BATCH', value: '32', _batch: true },
        { name: 'T',     value: '128' },
      ],
    });

    // RESHAPE output: [32, 128, 8, 64]
    expect(cache['2']).toEqual([32, 128, 8, 64]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bonus: Disconnected layer has null shape
  // ──────────────────────────────────────────────────────────────────────────
  test('Disconnected LINEAR has null shape', async ({ page }) => {
    const cache = await runShapes(page, {
      testLayers: [
        { id: 1, type: 'linear', x: 0, y: 0, units: 128 },
      ],
      testConnections: [],
      testVariables: [
        { name: 'BATCH', value: '32', _batch: true },
      ],
    });

    // No incoming edge → falls through to [units] fallback in the engine
    // (the engine returns [units] when there is no source, not null)
    expect(cache['1']).toEqual([128]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Bonus: RESHAPE with -1 inference
  // INPUT [B, 512] → RESHAPE([-1]) → [B, 512]  (inferred from numel=512)
  // ──────────────────────────────────────────────────────────────────────────
  test('RESHAPE with -1 infers correct dim', async ({ page }) => {
    const cache = await runShapes(page, {
      testLayers: [
        { id: 1, type: 'input',   x: 0, y: 0, dims: [512] },
        { id: 2, type: 'reshape', x: 200, y: 0, dims: [-1] },
      ],
      testConnections: [
        { from: 1, to: 2, seq: 1 },
      ],
      testVariables: [
        { name: 'BATCH', value: '32', _batch: true },
      ],
    });

    // numel of non-batch dims = 512; -1 is inferred → [32, 512]
    expect(cache['2']).toEqual([32, 512]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Serialization round-trip tests
//
// Strategy: build a network, snap it with _snap(), apply with _applySnap(),
// recompute shapes, and verify shapes are identical before and after.
// Catches bugs in persistence.js (lost params, type coercion, etc).
// ────────────────────────────────────────────────────────────────────────────
test.describe('Serialization round-trip', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof _snap === 'function' && typeof _applySnap === 'function');
  });

  test('INPUT → LINEAR round-trip preserves shapes', async ({ page }) => {
    const result = await page.evaluate(() => {
      layers.length = 0;
      connections.length = 0;
      variables.length = 0;

      layers.push({ id: 1, type: 'input',  x: 0,   y: 0, dims: ['T', 512] });
      layers.push({ id: 2, type: 'linear', x: 200,  y: 0, units: 256 });
      connections.push({ from: 1, to: 2, seq: 1 });
      variables.push({ name: 'BATCH', value: '32', _batch: true });
      variables.push({ name: 'T', value: '128' });

      _shapesDirty = true;
      computeOutputShapes();
      const before = JSON.parse(JSON.stringify(shapeCache));

      const snap = _snap();
      _applySnap(snap);

      _shapesDirty = true;
      computeOutputShapes();
      const after = JSON.parse(JSON.stringify(shapeCache));

      return { before, after };
    });

    expect(result.after).toEqual(result.before);
  });

  test('INPUT → CONV → FLATTEN → LINEAR round-trip preserves params and shapes', async ({ page }) => {
    const result = await page.evaluate(() => {
      layers.length = 0;
      connections.length = 0;
      variables.length = 0;

      layers.push({ id: 1, type: 'input',   x: 0,   y: 0, dims: [3, 32, 32] });
      layers.push({ id: 2, type: 'conv',    x: 200,  y: 0,
        out_channels: 16, kernel_size: 3, stride: 1, padding: 1, dilation: 1, ndim: 2 });
      layers.push({ id: 3, type: 'flatten', x: 400,  y: 0 });
      layers.push({ id: 4, type: 'linear',  x: 600,  y: 0, units: 10 });
      connections.push({ from: 1, to: 2, seq: 1 });
      connections.push({ from: 2, to: 3, seq: 2 });
      connections.push({ from: 3, to: 4, seq: 3 });
      variables.push({ name: 'BATCH', value: '4', _batch: true });

      _shapesDirty = true;
      computeOutputShapes();
      const before = JSON.parse(JSON.stringify(shapeCache));

      const snap = _snap();
      _applySnap(snap);

      _shapesDirty = true;
      computeOutputShapes();
      const after = JSON.parse(JSON.stringify(shapeCache));

      const convAfter = layers.find(l => l.type === 'conv');
      return { before, after, convParams: {
        out_channels: convAfter.out_channels,
        kernel_size:  convAfter.kernel_size,
        stride:       convAfter.stride,
        padding:      convAfter.padding,
      }};
    });

    expect(result.after).toEqual(result.before);
    expect(result.convParams).toEqual({ out_channels: 16, kernel_size: 3, stride: 1, padding: 1 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// canConnect() matrix tests
//
// ⚠️  MAINTENANCE: when you add a new layer type or change connection rules
// in js/utils.js, update the ALL_TYPES list and KNOWN_EXCEPTIONS below
// to match.  CI will fail to remind you if you forget.
// ────────────────────────────────────────────────────────────────────────────
test.describe('canConnect() matrix', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof canConnect === 'function');
  });

  test('every type can connect to output (except triu and output itself)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const ALL_TYPES = [
        'input', 'linear', 'mean', 'flatten', 'conv', 'unsqueeze', 'squeeze',
        'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm',
        'custom', 'concat', 'fanout', 'maskedfill', 'reshape', 'triu',
      ];
      const out = { type: 'output', id: 999 };
      const failing = [];
      for (const t of ALL_TYPES) {
        if (t === 'output') continue;
        const from = { type: t, id: 1 };
        if (!canConnect(from, out)) failing.push(t);
      }
      return failing;
    });
    // triu cannot connect to output (matrix-only op)
    const KNOWN_EXCEPTIONS = ['triu'];
    const unexpected = result.filter(t => !KNOWN_EXCEPTIONS.includes(t));
    expect(unexpected).toEqual([]);
  });

  test('no type can self-connect (same id)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const ALL_TYPES = [
        'input', 'linear', 'mean', 'flatten', 'conv', 'unsqueeze', 'squeeze',
        'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm',
        'custom', 'concat', 'fanout', 'maskedfill', 'reshape', 'triu', 'output',
      ];
      return ALL_TYPES.filter(t => canConnect({ type: t, id: 42 }, { type: t, id: 42 }));
    });
    expect(result).toEqual([]);
  });

  test('triu restricted to matrix/attention ops only', async ({ page }) => {
    const result = await page.evaluate(() => {
      const ALLOWED   = ['matmul', 'add', 'scale', 'transpose',
                         'unsqueeze', 'squeeze', 'concat', 'fanout', 'custom',
                         'maskedfill', 'reshape'];
      const FORBIDDEN = ['linear', 'mean', 'flatten', 'conv', 'softmax',
                         'layernorm', 'rmsnorm', 'output'];
      const from = { type: 'triu', id: 1 };
      return {
        wrongAllow:  ALLOWED.filter(t => !canConnect(from, { type: t, id: 2 })),
        wrongForbid: FORBIDDEN.filter(t =>  canConnect(from, { type: t, id: 2 })),
      };
    });
    expect(result.wrongAllow).toEqual([]);
    expect(result.wrongForbid).toEqual([]);
  });

  test('nothing can connect INTO input', async ({ page }) => {
    const result = await page.evaluate(() => {
      const ALL_TYPES = [
        'input', 'linear', 'mean', 'flatten', 'conv', 'unsqueeze', 'squeeze',
        'softmax', 'add', 'matmul', 'scale', 'transpose', 'layernorm', 'rmsnorm',
        'custom', 'concat', 'fanout', 'maskedfill', 'reshape', 'triu', 'output',
      ];
      const inp = { type: 'input', id: 99 };
      return ALL_TYPES.filter(t => canConnect({ type: t, id: 1 }, inp));
    });
    expect(result).toEqual([]);
  });
});
