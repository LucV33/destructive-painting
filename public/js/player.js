const socket = io();

// --- Constants ---
const IMG_ASPECT = 1536 / 1024; // 3:2 — full image
const QUAD_ASPECT = (1536 / 2) / (1024 / 2); // each quadrant is also 3:2
const OUTLINE_SRC = '/assets/outline.png';

// --- DOM Elements ---
const screens = {
  join: document.getElementById('screen-join'),
  waiting: document.getElementById('screen-waiting'),
  painting: document.getElementById('screen-painting'),
  reveal: document.getElementById('screen-reveal'),
  destruction: document.getElementById('screen-destruction'),
  results: document.getElementById('screen-results'),
};

const nameInput = document.getElementById('name-input');
const joinBtn = document.getElementById('join-btn');
const teamBadge = document.getElementById('team-badge');
const paintTimer = document.getElementById('paint-timer');
const destroyTimer = document.getElementById('destroy-timer');
const tomatoBtn = document.getElementById('tomato-btn');
const throwCountEl = document.getElementById('throw-count');
const finalThrowCount = document.getElementById('final-throw-count');
const cooldownSvgCircle = document.querySelector('#cooldown-svg circle');
const cooldownTimerEl = document.getElementById('cooldown-timer');

let myTeam = null;
let throwCount = 0;
let cooldownActive = false;

// Outline image
let outlineImg = null;
function loadOutline() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { outlineImg = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = OUTLINE_SRC;
  });
}
loadOutline();

// --- Screen Management ---
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  if (screens[name]) screens[name].classList.add('active');
}

// --- Join ---
joinBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  socket.emit('player-join', { name });
});

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

// --- Socket Events ---
socket.on('joined', ({ team, teamColor }) => {
  myTeam = team;
  teamBadge.textContent = `Team ${team} - ${teamColor}`;
  teamBadge.className = `team-badge team-${team}`;
  showScreen('waiting');
});

socket.on('error-msg', (msg) => {
  alert(msg);
});

socket.on('phase-change', ({ phase, timeRemaining }) => {
  switch (phase) {
    case 'painting':
      showScreen('painting');
      initCanvas();
      break;
    case 'reveal':
      showScreen('reveal');
      break;
    case 'destruction':
      showScreen('destruction');
      throwCount = 0;
      throwCountEl.textContent = '0';
      break;
    case 'results':
      showScreen('results');
      finalThrowCount.textContent = throwCount;
      break;
  }
});

socket.on('timer', ({ timeRemaining }) => {
  paintTimer.textContent = timeRemaining;
  destroyTimer.textContent = timeRemaining;
});

socket.on('throw-count', ({ count }) => {
  throwCount = count;
  throwCountEl.textContent = count;
});

socket.on('game-reset', () => {
  myTeam = null;
  throwCount = 0;
  showScreen('join');
  nameInput.value = '';
});

// --- Canvas (Painting Phase) ---
let canvas, ctx, outlineCanvas, outlineCtx;
let drawing = false;
let currentColor = '#E53935';
let currentSize = 10;
let lastX, lastY;
let strokeBatch = [];
let batchInterval = null;

function getQuadrantSource(team) {
  // Returns the {sx, sy} source offset in the full image for this team's quadrant
  const halfW = 1536 / 2;
  const halfH = 1024 / 2;
  switch (team) {
    case 1: return { sx: 0, sy: 0 };
    case 2: return { sx: halfW, sy: 0 };
    case 3: return { sx: 0, sy: halfH };
    case 4: return { sx: halfW, sy: halfH };
    default: return { sx: 0, sy: 0 };
  }
}

function initCanvas() {
  canvas = document.getElementById('paint-canvas');
  outlineCanvas = document.getElementById('outline-canvas');
  ctx = canvas.getContext('2d');
  outlineCtx = outlineCanvas.getContext('2d');

  const container = document.getElementById('canvas-container');
  const maxW = container.clientWidth - 16;
  const maxH = container.clientHeight - 16;

  let w, h;
  if (maxW / QUAD_ASPECT <= maxH) {
    w = Math.floor(maxW);
    h = Math.floor(maxW / QUAD_ASPECT);
  } else {
    h = Math.floor(maxH);
    w = Math.floor(maxH * QUAD_ASPECT);
  }

  // Paint canvas
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Outline canvas — draw just this team's quadrant
  outlineCanvas.width = w;
  outlineCanvas.height = h;
  outlineCanvas.style.width = w + 'px';
  outlineCanvas.style.height = h + 'px';
  // Position outline canvas on top of paint canvas
  outlineCanvas.style.left = canvas.offsetLeft + 'px';
  outlineCanvas.style.top = canvas.offsetTop + 'px';

  if (outlineImg && myTeam) {
    const src = getQuadrantSource(myTeam);
    outlineCtx.drawImage(
      outlineImg,
      src.sx, src.sy, 1536 / 2, 1024 / 2, // source rect
      0, 0, w, h                            // dest rect
    );
  }

  // Touch events
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });

  // Mouse events (for desktop testing)
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);

  // Start batching strokes
  if (batchInterval) clearInterval(batchInterval);
  batchInterval = setInterval(flushStrokes, 50);
}

function getCanvasPos(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  };
}

// --- Touch handlers ---
function onTouchStart(e) {
  if (e.touches.length !== 1) return;
  e.preventDefault();
  drawing = true;
  const pos = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
  lastX = pos.x;
  lastY = pos.y;
}

function onTouchMove(e) {
  if (!drawing || e.touches.length !== 1) return;
  e.preventDefault();
  const pos = getCanvasPos(e.touches[0].clientX, e.touches[0].clientY);
  handleDraw(pos.x, pos.y);
}

function onTouchEnd(e) {
  drawing = false;
  flushStrokes();
}

// --- Mouse handlers ---
function onMouseDown(e) {
  drawing = true;
  const pos = getCanvasPos(e.clientX, e.clientY);
  lastX = pos.x;
  lastY = pos.y;
}

function onMouseMove(e) {
  if (!drawing) return;
  const pos = getCanvasPos(e.clientX, e.clientY);
  handleDraw(pos.x, pos.y);
}

function onMouseUp(e) {
  drawing = false;
  flushStrokes();
}

// --- Shared draw logic ---
function handleDraw(x, y) {
  // Draw locally
  drawLine(lastX, lastY, x, y, currentColor, currentSize);

  // Queue for server
  strokeBatch.push({
    prevX: lastX,
    prevY: lastY,
    x: x,
    y: y,
    color: currentColor,
    size: currentSize,
    team: myTeam,
  });

  lastX = x;
  lastY = y;
}

function drawLine(x1, y1, x2, y2, color, size) {
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.beginPath();
  ctx.moveTo(x1 * canvas.width, y1 * canvas.height);
  ctx.lineTo(x2 * canvas.width, y2 * canvas.height);
  ctx.stroke();
}

function flushStrokes() {
  if (strokeBatch.length === 0) return;
  socket.emit('stroke', strokeBatch);
  strokeBatch = [];
}

// Color buttons
document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentColor = btn.dataset.color;
  });
});

// Size buttons
document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentSize = parseInt(btn.dataset.size);
  });
});

// --- Tomato Button (Destruction Phase) ---
const COOLDOWN_SECONDS = 5;
const CIRCUMFERENCE = 2 * Math.PI * 80; // matches SVG circle r=80

tomatoBtn.addEventListener('click', () => {
  if (cooldownActive) return;
  socket.emit('throw-tomato');

  // Throw animation
  tomatoBtn.classList.add('thrown');
  setTimeout(() => tomatoBtn.classList.remove('thrown'), 300);

  // Red burst effect behind the button
  spawnThrowSplat();

  startCooldown();
});

function spawnThrowSplat() {
  const screen = document.getElementById('screen-destruction');
  const btnRect = tomatoBtn.getBoundingClientRect();
  const screenRect = screen.getBoundingClientRect();
  const splat = document.createElement('div');
  splat.className = 'throw-splat';
  splat.style.left = (btnRect.left - screenRect.left + btnRect.width / 2) + 'px';
  splat.style.top = (btnRect.top - screenRect.top + btnRect.height / 2) + 'px';
  screen.appendChild(splat);
  setTimeout(() => splat.remove(), 500);
}

function startCooldown() {
  cooldownActive = true;
  tomatoBtn.classList.add('disabled');
  cooldownTimerEl.classList.remove('hidden');

  // Start SVG ring animation
  cooldownSvgCircle.style.transition = 'none';
  cooldownSvgCircle.style.strokeDasharray = CIRCUMFERENCE;
  cooldownSvgCircle.style.strokeDashoffset = '0';

  // Force reflow then animate
  cooldownSvgCircle.getBoundingClientRect();
  cooldownSvgCircle.style.transition = `stroke-dashoffset ${COOLDOWN_SECONDS}s linear`;
  cooldownSvgCircle.style.strokeDashoffset = CIRCUMFERENCE;

  let remaining = COOLDOWN_SECONDS;
  cooldownTimerEl.textContent = remaining;

  const interval = setInterval(() => {
    remaining--;
    cooldownTimerEl.textContent = remaining;
    if (remaining <= 0) {
      clearInterval(interval);
      cooldownActive = false;
      tomatoBtn.classList.remove('disabled');
      cooldownTimerEl.classList.add('hidden');
      // Reset ring
      cooldownSvgCircle.style.transition = 'none';
      cooldownSvgCircle.style.strokeDashoffset = '0';
    }
  }, 1000);
}
