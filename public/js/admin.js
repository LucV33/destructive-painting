const socket = io();

// --- Constants ---
const IMG_ASPECT = 1536 / 1024; // 3:2
const OUTLINE_SRC = '/assets/outline.png';

// --- DOM Elements ---
const screens = {
  lobby: document.getElementById('screen-lobby'),
  painting: document.getElementById('screen-painting'),
  reveal: document.getElementById('screen-reveal'),
  destruction: document.getElementById('screen-destruction'),
  results: document.getElementById('screen-results'),
};

const startBtn = document.getElementById('start-btn');
const destroyBtn = document.getElementById('destroy-btn');
const resetBtn = document.getElementById('reset-btn');
const downloadBtn = document.getElementById('download-btn');
const playerCountEl = document.getElementById('player-count');
const paintTimer = document.getElementById('paint-timer');
const destroyTimer = document.getElementById('destroy-timer');
const joinUrlEl = document.getElementById('join-url');

// The main paint canvas (strokes go here) — persists across phases
let paintCanvas, paintCtx;
let canvasW, canvasH;
let outlineImg = null;

// Pre-load the outline image
function loadOutline() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { outlineImg = img; resolve(img); };
    img.onerror = () => { console.warn('Failed to load outline'); resolve(null); };
    img.src = OUTLINE_SRC;
  });
}
loadOutline();

// Show the join URL
joinUrlEl.textContent = `Join at: ${window.location.origin}`;

// --- Screen Management ---
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
}

// --- Shared player list rendering ---
function renderPlayerList(players) {
  for (let t = 1; t <= 4; t++) {
    document.getElementById(`team-${t}-list`).innerHTML = '';
  }
  players.forEach(p => {
    const li = document.createElement('li');
    li.className = 'player-entry';

    const leftBtn = document.createElement('button');
    leftBtn.className = 'move-btn';
    leftBtn.textContent = '\u25C0';
    leftBtn.addEventListener('click', () => {
      socket.emit('admin-move-player', { playerId: p.id, direction: 'left' });
    });

    const nameSpan = document.createElement('span');
    nameSpan.textContent = p.name;

    const rightBtn = document.createElement('button');
    rightBtn.className = 'move-btn';
    rightBtn.textContent = '\u25B6';
    rightBtn.addEventListener('click', () => {
      socket.emit('admin-move-player', { playerId: p.id, direction: 'right' });
    });

    li.appendChild(leftBtn);
    li.appendChild(nameSpan);
    li.appendChild(rightBtn);
    document.getElementById(`team-${p.team}-list`).appendChild(li);
  });
  playerCountEl.textContent = `${players.length} player${players.length !== 1 ? 's' : ''} joined`;
  startBtn.disabled = players.length < 1;
}

// --- Reconnection: handle initial game-state on connect ---
socket.on('game-state', ({ phase, players, timeRemaining }) => {
  if (players && players.length > 0) {
    renderPlayerList(players);
  }

  // If game is in progress, jump to the right screen
  if (phase === 'painting') {
    showScreen('painting');
    initCanvasPair('admin');
  } else if (phase === 'reveal') {
    showScreen('reveal');
    initCanvasPair('admin');
    cloneCanvasPairTo('reveal');
  } else if (phase === 'destruction') {
    showScreen('destruction');
    initCanvasPair('admin');
    cloneCanvasPairTo('destroy');
  } else if (phase === 'results') {
    showScreen('results');
    initCanvasPair('admin');
    cloneCanvasPairTo('results');
    showLeaderboard(players);
  }
});

// --- Lobby ---
socket.on('player-list', ({ players }) => {
  renderPlayerList(players);
});

startBtn.addEventListener('click', () => {
  socket.emit('admin-start-game');
});

// --- Phase Changes ---
socket.on('phase-change', ({ phase, timeRemaining, players, splats }) => {
  switch (phase) {
    case 'painting':
      showScreen('painting');
      initCanvasPair('admin');
      break;
    case 'reveal':
      showScreen('reveal');
      cloneCanvasPairTo('reveal');
      break;
    case 'destruction':
      showScreen('destruction');
      cloneCanvasPairTo('destroy');
      break;
    case 'results':
      showScreen('results');
      cloneCanvasPairTo('results');
      copySplatsTo('results-splat-overlay');
      showLeaderboard(players);
      break;
  }
});

socket.on('timer', ({ timeRemaining }) => {
  paintTimer.textContent = timeRemaining;
  destroyTimer.textContent = timeRemaining;
});

// --- Canvas Setup ---
// Each phase has a pair: <prefix>-paint-canvas + <prefix>-outline-canvas
function initCanvasPair(prefix) {
  paintCanvas = document.getElementById(`${prefix}-paint-canvas`);
  const outlineCanvas = document.getElementById(`${prefix}-outline-canvas`);
  paintCtx = paintCanvas.getContext('2d');

  // Size to fit viewport while preserving 3:2 ratio
  const container = paintCanvas.parentElement;
  const maxW = (container.closest('.screen')?.clientWidth || container.parentElement.clientWidth) - 60;
  const maxH = window.innerHeight - 160;

  if (maxW / IMG_ASPECT <= maxH) {
    canvasW = Math.floor(maxW);
    canvasH = Math.floor(maxW / IMG_ASPECT);
  } else {
    canvasH = Math.floor(maxH);
    canvasW = Math.floor(maxH * IMG_ASPECT);
  }

  // Paint canvas
  paintCanvas.width = canvasW;
  paintCanvas.height = canvasH;
  paintCtx.fillStyle = '#fff';
  paintCtx.fillRect(0, 0, canvasW, canvasH);
  paintCtx.lineCap = 'round';
  paintCtx.lineJoin = 'round';

  // Outline canvas (same size, drawn on top)
  outlineCanvas.width = canvasW;
  outlineCanvas.height = canvasH;
  const olCtx = outlineCanvas.getContext('2d');
  if (outlineImg) {
    olCtx.drawImage(outlineImg, 0, 0, canvasW, canvasH);
  }

  // Draw subtle quadrant divider lines on paint canvas
  paintCtx.save();
  paintCtx.strokeStyle = 'rgba(0,0,0,0.08)';
  paintCtx.lineWidth = 2;
  paintCtx.setLineDash([8, 8]);
  paintCtx.beginPath();
  paintCtx.moveTo(canvasW / 2, 0);
  paintCtx.lineTo(canvasW / 2, canvasH);
  paintCtx.moveTo(0, canvasH / 2);
  paintCtx.lineTo(canvasW, canvasH / 2);
  paintCtx.stroke();
  paintCtx.restore();
}

function cloneCanvasPairTo(prefix) {
  const targetPaint = document.getElementById(`${prefix}-paint-canvas`);
  const targetOutline = document.getElementById(`${prefix}-outline-canvas`);

  targetPaint.width = canvasW;
  targetPaint.height = canvasH;
  targetPaint.getContext('2d').drawImage(paintCanvas, 0, 0);

  targetOutline.width = canvasW;
  targetOutline.height = canvasH;
  if (outlineImg) {
    targetOutline.getContext('2d').drawImage(outlineImg, 0, 0, canvasW, canvasH);
  }
}

// --- Receive Strokes ---
socket.on('stroke', (batch) => {
  if (!paintCtx) return;

  const strokes = Array.isArray(batch) ? batch : [batch];
  const halfW = canvasW / 2;
  const halfH = canvasH / 2;

  strokes.forEach(s => {
    const quad = getQuadrantOffset(s.team);

    const x1 = quad.x + s.prevX * halfW;
    const y1 = quad.y + s.prevY * halfH;
    const x2 = quad.x + s.x * halfW;
    const y2 = quad.y + s.y * halfH;

    paintCtx.strokeStyle = s.color;
    paintCtx.lineWidth = s.size * (halfW / 300);
    paintCtx.beginPath();
    paintCtx.moveTo(x1, y1);
    paintCtx.lineTo(x2, y2);
    paintCtx.stroke();
  });
});

function getQuadrantOffset(team) {
  const halfW = canvasW / 2;
  const halfH = canvasH / 2;
  switch (team) {
    case 1: return { x: 0, y: 0 };
    case 2: return { x: halfW, y: 0 };
    case 3: return { x: 0, y: halfH };
    case 4: return { x: halfW, y: halfH };
    default: return { x: 0, y: 0 };
  }
}

// --- Destruction ---
destroyBtn.addEventListener('click', () => {
  socket.emit('admin-start-destruction');
});

socket.on('splat', (splat) => {
  const overlay = document.getElementById('splat-overlay');
  if (!overlay) return;
  renderSplat(overlay, splat);
});

// --- Procedural Splat Generator ---
// Generates a unique, organic-looking tomato splat on a small canvas
function generateSplatCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  // Randomize tomato red hue
  const hue = 0 + Math.random() * 12; // 0-12 (red range)
  const sat = 75 + Math.random() * 20;
  const light = 38 + Math.random() * 15;

  // 1. Main splat body — irregular blob
  ctx.save();
  ctx.beginPath();
  const points = 12 + Math.floor(Math.random() * 6);
  const baseR = size * 0.32;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const wobble = baseR * (0.7 + Math.random() * 0.5);
    const x = cx + Math.cos(angle) * wobble;
    const y = cy + Math.sin(angle) * wobble;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  // Gradient fill
  const grad = ctx.createRadialGradient(cx - size * 0.05, cy - size * 0.05, 0, cx, cy, baseR * 1.2);
  grad.addColorStop(0, `hsla(${hue}, ${sat}%, ${light + 15}%, 0.9)`);
  grad.addColorStop(0.5, `hsla(${hue}, ${sat}%, ${light}%, 0.85)`);
  grad.addColorStop(1, `hsla(${hue - 3}, ${sat + 5}%, ${light - 10}%, 0.7)`);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // 2. Splatter droplets radiating outward
  const dropletCount = 5 + Math.floor(Math.random() * 8);
  for (let i = 0; i < dropletCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = baseR * (0.8 + Math.random() * 0.7);
    const dx = cx + Math.cos(angle) * dist;
    const dy = cy + Math.sin(angle) * dist;
    const dr = 3 + Math.random() * (size * 0.06);

    ctx.beginPath();
    ctx.ellipse(dx, dy, dr, dr * (0.5 + Math.random() * 0.5), angle, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${light + Math.random() * 10}%, ${0.6 + Math.random() * 0.3})`;
    ctx.fill();
  }

  // 3. Streak lines from center outward
  const streakCount = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < streakCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const len = baseR * (0.5 + Math.random() * 0.8);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * baseR * 0.3, cy + Math.sin(angle) * baseR * 0.3);
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.strokeStyle = `hsla(${hue}, ${sat}%, ${light}%, ${0.3 + Math.random() * 0.3})`;
    ctx.lineWidth = 2 + Math.random() * 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // 4. Highlight — small bright spot
  ctx.beginPath();
  ctx.arc(cx - size * 0.06, cy - size * 0.06, size * 0.06, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${hue}, ${sat - 20}%, ${light + 30}%, 0.35)`;
  ctx.fill();

  // 5. Optional: seed specks
  const seedCount = Math.floor(Math.random() * 5);
  for (let i = 0; i < seedCount; i++) {
    const sx = cx + (Math.random() - 0.5) * baseR;
    const sy = cy + (Math.random() - 0.5) * baseR;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 2, 3.5, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(50, 70%, 75%, 0.7)`;
    ctx.fill();
  }

  return c;
}

function renderSplat(overlay, splat) {
  const size = 90 + Math.random() * 60; // 90-150px

  // 1. Show flying tomato emoji
  const tomato = document.createElement('div');
  tomato.className = 'tomato-fly';
  tomato.textContent = '\uD83C\uDF45';
  tomato.style.left = (splat.x * 100) + '%';
  tomato.style.top = (splat.y * 100) + '%';
  overlay.appendChild(tomato);

  // 2. After the fly animation, show the splat
  setTimeout(() => {
    tomato.remove();

    const wrap = document.createElement('div');
    wrap.className = 'splat-wrap';
    wrap.style.left = (splat.x * 100) + '%';
    wrap.style.top = (splat.y * 100) + '%';

    const splatCanvas = generateSplatCanvas(size);
    // Random rotation for variety
    splatCanvas.style.transform = `rotate(${Math.random() * 360}deg)`;
    wrap.appendChild(splatCanvas);
    overlay.appendChild(wrap);
  }, 220);
}

function copySplatsTo(targetId) {
  const source = document.getElementById('splat-overlay');
  const target = document.getElementById(targetId);
  target.innerHTML = '';

  // Deep clone each splat wrapper, re-drawing canvas pixel data
  source.querySelectorAll('.splat-wrap').forEach(wrap => {
    const clone = wrap.cloneNode(false); // shallow clone the wrapper div
    clone.style.cssText = wrap.style.cssText;
    // Copy animation state: force final state
    clone.style.animation = 'none';
    clone.style.transform = 'translate(-50%, -50%) scale(1)';

    const srcCanvas = wrap.querySelector('canvas');
    if (srcCanvas) {
      const newCanvas = document.createElement('canvas');
      newCanvas.width = srcCanvas.width;
      newCanvas.height = srcCanvas.height;
      newCanvas.style.cssText = srcCanvas.style.cssText;
      newCanvas.getContext('2d').drawImage(srcCanvas, 0, 0);
      clone.appendChild(newCanvas);
    }
    target.appendChild(clone);
  });
}

// --- Results ---
function showLeaderboard(players) {
  const sorted = [...players].sort((a, b) => b.throwCount - a.throwCount);
  const list = document.getElementById('leaderboard-list');
  list.innerHTML = '';
  sorted.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name} — ${p.throwCount} tomatoes`;
    list.appendChild(li);
  });

  const total = players.reduce((sum, p) => sum + p.throwCount, 0);
  const teamTotals = {};
  players.forEach(p => {
    teamTotals[p.team] = (teamTotals[p.team] || 0) + p.throwCount;
  });

  document.getElementById('stats').innerHTML = `
    Total tomatoes: ${total}<br>
    Team 1: ${teamTotals[1] || 0} | Team 2: ${teamTotals[2] || 0} |
    Team 3: ${teamTotals[3] || 0} | Team 4: ${teamTotals[4] || 0}
  `;
}

// --- Downloads ---
function compositeDownload(includeSplats) {
  const offscreen = document.createElement('canvas');
  offscreen.width = canvasW;
  offscreen.height = canvasH;
  const ctx = offscreen.getContext('2d');

  // Layer 1: paint strokes
  ctx.drawImage(paintCanvas, 0, 0);

  // Layer 2: outline (multiply blend)
  if (outlineImg) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(outlineImg, 0, 0, canvasW, canvasH);
    ctx.globalCompositeOperation = 'source-over';
  }

  const link = document.createElement('a');
  link.download = includeSplats ? 'destructive-painting-destroyed.png' : 'destructive-painting-clean.png';
  link.href = offscreen.toDataURL('image/png');
  link.click();
}

downloadBtn.addEventListener('click', () => compositeDownload(true));

// --- Reset ---
resetBtn.addEventListener('click', () => {
  socket.emit('admin-reset');
});

socket.on('game-reset', () => {
  showScreen('lobby');
  document.getElementById('splat-overlay').innerHTML = '';
  document.getElementById('results-splat-overlay').innerHTML = '';
  for (let t = 1; t <= 4; t++) {
    document.getElementById(`team-${t}-list`).innerHTML = '';
  }
  playerCountEl.textContent = '0 players joined';
  startBtn.disabled = true;
});
