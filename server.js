const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- Game State ---
const TEAM_COLORS = ['Red', 'Blue', 'Green', 'Yellow'];
const PHASE_DURATION = 60; // seconds

const gameState = {
  phase: 'lobby', // lobby | painting | reveal | destruction | results
  players: [],    // { id, name, team, throwCount }
  timer: null,
  timeRemaining: 0,
  splats: [],
};

function getTeamForPlayer() {
  const teamIndex = gameState.players.length % 4;
  return teamIndex + 1; // teams are 1-4
}

function getTeamCounts() {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  gameState.players.forEach(p => counts[p.team]++);
  return counts;
}

// --- Socket.io ---
io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  // Send current game state to newly connected client
  socket.emit('game-state', {
    phase: gameState.phase,
    players: gameState.players,
    timeRemaining: gameState.timeRemaining,
  });

  // Player joins the game
  socket.on('player-join', ({ name }) => {
    if (gameState.phase !== 'lobby') {
      socket.emit('error-msg', 'Game already in progress');
      return;
    }

    const team = getTeamForPlayer();
    const player = {
      id: socket.id,
      name: name.trim().substring(0, 20),
      team,
      throwCount: 0,
    };
    gameState.players.push(player);

    // Tell the player their team
    socket.emit('joined', { team, teamColor: TEAM_COLORS[team - 1] });

    // Tell admin about updated player list
    io.emit('player-list', { players: gameState.players });

    console.log(`${player.name} joined Team ${team} (${TEAM_COLORS[team - 1]})`);
  });

  // Admin moves a player to a different team
  socket.on('admin-move-player', ({ playerId, direction }) => {
    if (gameState.phase !== 'lobby') return;

    const player = gameState.players.find(p => p.id === playerId);
    if (!player) return;

    if (direction === 'left') {
      player.team = player.team === 1 ? 4 : player.team - 1;
    } else {
      player.team = player.team === 4 ? 1 : player.team + 1;
    }

    // Notify the moved player of their new team
    io.to(playerId).emit('joined', {
      team: player.team,
      teamColor: TEAM_COLORS[player.team - 1],
    });

    // Broadcast updated player list
    io.emit('player-list', { players: gameState.players });

    console.log(`${player.name} moved to Team ${player.team} (${TEAM_COLORS[player.team - 1]})`);
  });

  // Admin starts the game → painting phase
  socket.on('admin-start-game', () => {
    if (gameState.phase !== 'lobby') return;
    gameState.phase = 'painting';
    gameState.timeRemaining = PHASE_DURATION;

    io.emit('phase-change', { phase: 'painting', timeRemaining: PHASE_DURATION });

    startTimer(() => {
      // Timer ended → move to reveal
      gameState.phase = 'reveal';
      io.emit('phase-change', { phase: 'reveal' });
    });

    console.log('Game started — Painting phase');
  });

  // Stroke data from a player
  socket.on('stroke', (data) => {
    if (gameState.phase !== 'painting') return;
    // Broadcast to admin (and all clients for potential spectators)
    socket.broadcast.emit('stroke', data);
  });

  // Admin triggers reveal → destruction
  socket.on('admin-start-destruction', () => {
    if (gameState.phase !== 'reveal') return;
    gameState.phase = 'destruction';
    gameState.timeRemaining = PHASE_DURATION;

    io.emit('phase-change', { phase: 'destruction', timeRemaining: PHASE_DURATION });

    startTimer(() => {
      gameState.phase = 'results';
      io.emit('phase-change', {
        phase: 'results',
        players: gameState.players,
        splats: gameState.splats,
      });
    });

    console.log('Destruction phase started');
  });

  // Tomato throw
  socket.on('throw-tomato', () => {
    if (gameState.phase !== 'destruction') return;

    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;

    player.throwCount++;

    // Random position on the canvas
    const splat = {
      x: Math.random(),
      y: Math.random(),
      playerName: player.name,
      team: player.team,
    };
    gameState.splats.push(splat);

    io.emit('splat', splat);
    socket.emit('throw-count', { count: player.throwCount });
  });

  // Admin shows results
  socket.on('admin-show-results', () => {
    if (gameState.phase !== 'destruction' && gameState.phase !== 'results') return;
    gameState.phase = 'results';
    clearTimer();

    io.emit('phase-change', {
      phase: 'results',
      players: gameState.players,
      splats: gameState.splats,
    });
  });

  // Admin skip phase (dev shortcut — skip current timer)
  socket.on('admin-skip-phase', () => {
    clearTimer();
    if (gameState.phase === 'painting') {
      gameState.phase = 'reveal';
      io.emit('phase-change', { phase: 'reveal' });
    } else if (gameState.phase === 'reveal') {
      gameState.phase = 'destruction';
      gameState.timeRemaining = PHASE_DURATION;
      io.emit('phase-change', { phase: 'destruction', timeRemaining: PHASE_DURATION });
      startTimer(() => {
        gameState.phase = 'results';
        io.emit('phase-change', { phase: 'results', players: gameState.players, splats: gameState.splats });
      });
    } else if (gameState.phase === 'destruction') {
      gameState.phase = 'results';
      io.emit('phase-change', { phase: 'results', players: gameState.players, splats: gameState.splats });
    }
    console.log(`Skipped to: ${gameState.phase}`);
  });

  // Admin resets game
  socket.on('admin-reset', () => {
    clearTimer();
    gameState.phase = 'lobby';
    gameState.players = [];
    gameState.splats = [];
    gameState.timeRemaining = 0;
    io.emit('game-reset');
    console.log('Game reset');
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);
    // Don't remove players mid-game, just log it
  });
});

// --- Timer Utility ---
function startTimer(onComplete) {
  clearTimer();
  gameState.timer = setInterval(() => {
    gameState.timeRemaining--;
    io.emit('timer', { timeRemaining: gameState.timeRemaining });

    if (gameState.timeRemaining <= 0) {
      clearTimer();
      onComplete();
    }
  }, 1000);
}

function clearTimer() {
  if (gameState.timer) {
    clearInterval(gameState.timer);
    gameState.timer = null;
  }
}

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Admin page: http://localhost:${PORT}/admin`);
});
