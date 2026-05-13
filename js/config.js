/* Layer visual config + global constants */
const gridSpacing = 100;
const majorEvery  = 5;
const FRAME_MS    = 1000 / 30;

const layerTypes = {
  input:   { w: 140, h: 70, color: '#00ff88', glow: '#00ff88', bg: 'rgba(0, 30, 20, 0.9)' },
  linear:  { w: 140, h: 70, color: '#0088ff', glow: '#0088ff', bg: 'rgba(0, 15, 40, 0.9)' },
  flatten: { w: 140, h: 70, color: '#ffc800', glow: '#ffc800', bg: 'rgba(30, 25, 0, 0.9)' },
  output:  { w: 140, h: 70, color: '#ff64ff', glow: '#ff64ff', bg: 'rgba(30, 0, 30, 0.9)' },
  mean:    { w: 140, h: 70, color: '#ff8c00', glow: '#ff8c00', bg: 'rgba(30, 15, 0, 0.9)' },
};

const ALL_FNS = ['none', 'relu', 'gelu', 'swiglu', 'sigmoid', 'tanh', 'leaky_relu', 'elu', 'selu', 'softplus', 'mish'];
