'use client';

import { useState } from 'react';

export default function VarsPanel() {
  const [vars, setVars] = useState([
    { name: 'B', value: '32' },
    { name: 'T', value: '512' },
  ]);

  const addVar = () =>
    setVars(v => [...v, { name: '', value: '' }]);

  const removeVar = i =>
    setVars(v => v.filter((_, j) => j !== i));

  const update = (i, field, val) =>
    setVars(v => v.map((vr, j) => j === i ? { ...vr, [field]: val } : vr));

  return (
    <div className="vars-panel" onMouseDown={e => e.stopPropagation()}>
      <div className="vars-header">
        <span>Variables</span>
        <button className="vars-add" onClick={addVar} title="Add variable">+</button>
      </div>

      {vars.length === 0 && (
        <div className="vars-empty">No variables yet</div>
      )}

      {vars.map((v, i) => (
        <div className="vars-row" key={i}>
          <input
            className="vars-name"
            value={v.name}
            onChange={e => update(i, 'name', e.target.value)}
            placeholder="name"
            spellCheck={false}
          />
          <span className="vars-eq">=</span>
          <input
            className="vars-val"
            value={v.value}
            onChange={e => update(i, 'value', e.target.value)}
            placeholder="value"
            spellCheck={false}
          />
          <button className="vars-del" onClick={() => removeVar(i)} title="Remove">×</button>
        </div>
      ))}
    </div>
  );
}
