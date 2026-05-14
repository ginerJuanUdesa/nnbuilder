/* Layer visual config + global constants */
const gridSpacing = 100;
const majorEvery  = 5;
const FRAME_MS    = 1000 / 30;

const layerTypes = {
  input:   { w: 140, h: 70, color: '#00ff88', glow: '#00ff88', bg: 'rgba(0, 50, 30, 0.97)',  lightColor: '#0a7a3e' },
  linear:  { w: 140, h: 70, color: '#0088ff', glow: '#0088ff', bg: 'rgba(0, 30, 60, 0.97)',  lightColor: '#005abe' },
  flatten: { w: 140, h: 70, color: '#ffc800', glow: '#ffc800', bg: 'rgba(60, 50, 0, 0.97)',  lightColor: '#a87800' },
  output:  { w: 140, h: 70, color: '#ff64ff', glow: '#ff64ff', bg: 'rgba(60, 0, 60, 0.97)',  lightColor: '#8c28b4' },
  mean:    { w: 140, h: 70, color: '#ff8c00', glow: '#ff8c00', bg: 'rgba(60, 30, 0, 0.97)',  lightColor: '#c05000' },
  conv:    { w: 140, h: 70, color: '#00ccdd', glow: '#00ccdd', bg: 'rgba(0, 50, 60, 0.97)',  lightColor: '#008296' },
};

const ALL_FNS = ['none', 'relu', 'gelu', 'swiglu', 'sigmoid', 'tanh', 'leaky_relu', 'elu', 'selu', 'softplus', 'mish'];
