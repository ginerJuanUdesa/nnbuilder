'use client';

import { useState, useEffect } from 'react';

const IMPLEMENTED = new Set(['select', 'connect', 'group', 'save', 'load']);

const TOOLS = [
  {
    id: 'select',
    title: 'Selection area (S)',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="14" height="14" rx="2" strokeDasharray="3 2"/>
      </svg>
    ),
  },
  {
    id: 'connect',
    title: 'Connect (C)',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="4" cy="10" r="2"/><circle cx="16" cy="10" r="2"/>
        <line x1="6" y1="10" x2="14" y2="10"/>
      </svg>
    ),
  },
  {
    id: 'group',
    title: 'Group (G)',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="2" width="16" height="16" rx="3" strokeDasharray="4 2"/>
        <rect x="5" y="5" width="4" height="4" rx="1" strokeWidth="1.4"/>
        <rect x="11" y="5" width="4" height="4" rx="1" strokeWidth="1.4"/>
        <rect x="5" y="11" width="4" height="4" rx="1" strokeWidth="1.4"/>
      </svg>
    ),
  },
  {
    id: 'comment',
    title: 'Comment',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path d="M2 3h16a1 1 0 011 1v9a1 1 0 01-1 1H6l-4 3V4a1 1 0 011-1z"/>
      </svg>
    ),
  },
  {
    id: 'fit',
    title: 'Fit to screen',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/>
      </svg>
    ),
  },
  {
    id: 'export',
    title: 'Export PyTorch',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 3v10M6 9l4 4 4-4"/><path d="M4 15h12"/>
      </svg>
    ),
  },
  {
    id: 'share',
    title: 'Share',
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="15" cy="5" r="2"/><circle cx="5" cy="10" r="2"/><circle cx="15" cy="15" r="2"/>
        <line x1="7" y1="11" x2="13" y2="14"/><line x1="7" y1="9" x2="13" y2="6"/>
      </svg>
    ),
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M11.5 2h-3l-.4 2a6 6 0 00-1.2.7l-1.9-.8-2.1 2.1.8 1.9a6 6 0 00-.7 1.2L1 9.5v3l2 .4a6 6 0 00.7 1.2l-.8 1.9 2.1 2.1 1.9-.8a6 6 0 001.2.7l.4 2h3l.4-2a6 6 0 001.2-.7l1.9.8 2.1-2.1-.8-1.9a6 6 0 00.7-1.2L19 11.5v-3l-2-.4a6 6 0 00-.7-1.2l.8-1.9-2.1-2.1-1.9.8a6 6 0 00-1.2-.7L11.5 2zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
      </svg>
    ),
  },
  {
    id: 'save',
    title: 'Save architecture (.json)',
    icon: (
      // Floppy disk
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3h11l3 3v11a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z"/>
        <path d="M5 3v5h8V3"/>
        <rect x="6" y="11" width="8" height="5"/>
      </svg>
    ),
  },
  {
    id: 'load',
    title: 'Load architecture (.json)',
    icon: (
      // Folder-open + arrow up (load = read from disk)
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h5l2 2h7v8a1 1 0 01-1 1H3a1 1 0 01-1-1V7a1 1 0 011-1z"/>
        <path d="M10 16V9M7 12l3-3 3 3"/>
      </svg>
    ),
  },
];

export default function Toolbar() {
  const [activeTool, setActiveTool] = useState('pan');

  useEffect(() => {
    const h = (e) => setActiveTool(e.detail);
    window.addEventListener('toolmodechanged', h);
    return () => window.removeEventListener('toolmodechanged', h);
  }, []);

  const handleClick = (toolId) => {
    if (toolId === 'select') {
      const next = activeTool === 'select' ? 'pan' : 'select';
      window.dispatchEvent(new CustomEvent('toolchange', { detail: next }));
    } else if (toolId === 'connect') {
      const next = activeTool === 'connect' ? 'pan' : 'connect';
      window.dispatchEvent(new CustomEvent('toolchange', { detail: next }));
    } else if (toolId === 'group') {
      const next = activeTool === 'group' ? 'pan' : 'group';
      window.dispatchEvent(new CustomEvent('toolchange', { detail: next }));
    } else if (toolId === 'save') {
      window.dispatchEvent(new CustomEvent('tb-save'));
    } else if (toolId === 'load') {
      window.dispatchEvent(new CustomEvent('tb-load'));
    }
  };

  return (
    <div className="toolbar">
      {TOOLS.map(tool => (
        <button
          key={tool.id}
          className={[
            'toolbar-btn',
            !IMPLEMENTED.has(tool.id) ? 'stub' : '',
            ['select','connect','group'].includes(tool.id) && activeTool === tool.id ? 'active' : '',
          ].join(' ').trim()}
          title={IMPLEMENTED.has(tool.id) ? tool.title : ''}
          onClick={() => handleClick(tool.id)}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
}
