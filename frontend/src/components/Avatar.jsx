import React, { useId } from 'react';

const PALETTES = [
  ['#17b98c', '#2ee6ab'],
  ['#2f7df6', '#6ea8ff'],
  ['#f6a627', '#ffc95e'],
  ['#9b5de5', '#c58fff'],
  ['#e4537e', '#ff84a6'],
  ['#15b6c4', '#4fe0ec'],
  ['#7c5bf5', '#a98bff'],
  ['#f26d4f', '#ff9b7a'],
];

function hashString(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  return hash;
}

function Avatar({ email = '', name = '', className = '', title, photo }) {
  if (photo) {
    return <img className={className} src={photo} alt={title || `Avatar for ${name || email}`} />;
  }
  const seed = hashString((email || name || 'user').trim().toLowerCase());
  const [c1, c2] = PALETTES[seed % PALETTES.length];
  const id = useId().replace(/:/g, '');
  const cell = 16;
  const gap = 3;
  const origin = Math.round((100 - (cell * 5 + gap * 4)) / 2);
  const diag = (seed & 32) === 0;

  const cells = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 3; c++) {
      const bits = (seed >> ((r * 5 + c) * 2)) & 3;
      if (bits === 0) continue;
      const mirrored = c === 0 ? 4 : c === 1 ? 3 : 2;
      const y = origin + r * (cell + gap);
      const opacity = bits === 3 ? 0.92 : 0.55;
      cells.push(<rect key={`${r}-${c}-a`} x={origin + c * (cell + gap)} y={y} width={cell} height={cell} rx={4} fill="#fff" fillOpacity={opacity} />);
      if (mirrored !== c) cells.push(<rect key={`${r}-${c}-b`} x={origin + mirrored * (cell + gap)} y={y} width={cell} height={cell} rx={4} fill="#fff" fillOpacity={opacity} />);
    }
  }

  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title || (email || name ? `Avatar for ${name || email}` : 'User avatar')}
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={id} x1="0%" y1={diag ? '0%' : '100%'} x2="100%" y2={diag ? '100%' : '0%'}>
          <stop offset="0%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id})`} />
      {cells}
    </svg>
  );
}

export default Avatar;