const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const socketIO = require('socket.io');
const { createDeck, shuffleDeck, evaluateHand } = require('./gameLogic');

// Configura servidor Express + WebSocket
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Habilita CORS para todas origens (ajuste em produção)
app.use(cors());

// Serve arquivos estáticos (HTML, CSS, JS, imagens)
app.use(express.static(path.join(__dirname, '../public')));

// Parse JSON no body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cria 10 mesas pré-definidas
const rooms = {};
for (let i = 1; i <= 10; i++) {
  const roomId = `Mesa${i}`;
  rooms[roomId] = {
    name: `Mesa ${i}`,
    players: [],
    spectators: [],
    gameState: null,
    startingIndex: 0
  };
}

// Rotas de API
app.get('/api/roomsWithPlayers', (req, res) => {
  const data = Object.keys(rooms).map(roomId => ({
    id: roomId,
    name: rooms[roomId].name,
    players: rooms[roomId].players.map(p => p.nick),
    availableSpots: 8 - rooms[roomId].players.length
  }));
  res.json(data);
});

app.get('/api/gameState', (req, res) => {
  const { roomId } = req.query;
  const room = rooms[roomId];
  if (!room) return res.status(404).json({ message: 'Mesa não encontrada.' });
  if (!room.gameState) {
    return res.json({
      stage: 'WAITING',
      communityCards: [],
      pot: 0,
      currentPlayerIndex: 0,
      players: room.players.map(p => ({
        id: p.id, nick: p.nick, chips: p.chips,
        folded: false, allIn: false, betAmount: 0, lastAction: '', cards: []
      }))
    });
  }
  res.json(getPublicGameState(room.gameState));
});

// Socket.IO
io.on('connection', socket => {
  console.log('Usuário conectado:', socket.id);

  socket.on('joinRoom', data => {
    const { roomId, nick, chips } = data;
    const room = rooms[roomId];
    if (!room) return socket.emit('errorMessage', { message: 'Mesa não existe.' });
    const initialChips = parseInt(chips, 10) || 1000;
    if (initialChips <= 0) return socket.emit('errorMessage', { message: 'Fichas insuficientes.' });

    // Reconexão: remove instâncias anteriores
    room.players = room.players.filter(p => p.id !== socket.id);
    room.spectators = room.spectators.filter(s => s.id !== socket.id);
    socket.leave(roomId);

    // Se jogo em andamento, entra como espectador
    if (room.gameState && room.gameState.stage !== 'WAITING') {
      room.spectators.push({ id: socket.id, nick, chips: initialChips });
      socket.emit('infoMessage', { message: 'Você está como espectador.' });
      socket.join(roomId);
      return;
    }

    if (room.players.length >= 8) return socket.emit('errorMessage', { message: 'Mesa cheia.' });

    room.players.push({ id: socket.id, nick, chips: initialChips });
    socket.join(roomId);
    io.to(roomId).emit('playersUpdate', { players: room.players });
  });

  socket.on('startGame', roomId => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players.length < 2) {
      return io.to(roomId).emit('notEnoughPlayers', { message: 'Precisa de 2+ jogadores.' });
    }
    startGame(roomId);
  });

  // ... restante das ações do jogador (playerAction, endRound, disconnect) ...
});

// Inicia o servidor
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

// (Implementar funções auxiliares: startGame, playerAction, nextStage, determineWinner, getPublicGameState)
