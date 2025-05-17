const express = require('express');
const http = require('http');
const path = require('path');
const socketIO = require('socket.io');
const { createDeck, shuffleDeck, evaluateHand } = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Cria 10 mesas pré-definidas, cada uma com capacidade máxima de 8 jogadores.
const rooms = {};
for (let i = 1; i <= 10; i++) {
  const roomId = `Mesa${i}`;
  rooms[roomId] = { 
    name: `Mesa ${i}`, 
    players: [],        // Jogadores ativos
    spectators: [],     // Espectadores (que entram após a partida começar)
    gameState: null,
    startingIndex: 0    // Índice de quem inicia a partida (rotativo)
  };
}

// Endpoint para obter o estado do jogo
app.get('/api/gameState', (req, res) => {
  const { roomId } = req.query;
  if (!roomId || !rooms[roomId]) {
    return res.status(404).json({ success: false, message: 'Mesa não encontrada.' });
  }
  // Se não houver gameState, retorna um estado padrão usando os jogadores ativos (não espectadores)
  if (!rooms[roomId].gameState) {
    return res.json({ 
      stage: 'WAITING', 
      communityCards: [], 
      pot: 0, 
      currentPlayerIndex: 0, 
      players: rooms[roomId].players.map(p => ({ 
        id: p.id, 
        nick: p.nick, 
        chips: p.chips, 
        folded: false, 
        allIn: false, 
        betAmount: 0, 
        lastAction: "", 
        cards: [] 
      })) 
    });
  }
  return res.json(getPublicGameState(rooms[roomId].gameState));
});

// Endpoint para listar mesas com jogadores (apenas os ativos)
app.get('/api/roomsWithPlayers', (req, res) => {
  const data = Object.keys(rooms).map(roomId => ({
    id: roomId,
    name: rooms[roomId].name,
    players: rooms[roomId].players.map(p => p.nick),
    availableSpots: 8 - rooms[roomId].players.length
  }));
  res.json(data);
});

// Socket.IO
io.on('connection', (socket) => {
  console.log("Usuário conectado:", socket.id);

  // Evento para entrar em uma mesa
  socket.on('joinRoom', (data) => {
    const { roomId, nick, chips } = data;
    const room = rooms[roomId];
    const initialChips = parseInt(chips, 10) || 1000;
    // Não permite entrada se o jogador não tiver fichas
    if (initialChips <= 0) {
      socket.emit('errorMessage', { message: 'Você não possui fichas suficientes para entrar.' });
      return;
    }
    // Verifica se já existe um jogador ou espectador com o mesmo nome na mesa
    const nameExists = room.players.some(p => p.nick === nick) || room.spectators.some(s => s.nick === nick);
    if (nameExists) {
      socket.emit('errorMessage', { message: 'Já existe um jogador com esse nome na mesa.' });
      return;
    }
    // Se a partida já estiver em andamento (stage diferente de WAITING), o usuário entra como espectador.
    if (room.gameState && room.gameState.stage !== 'WAITING') {
      room.spectators.push({ id: socket.id, nick, chips: initialChips });
      socket.emit('infoMessage', { message: 'Você está assistindo à partida.' });
      return;
    }
    // Verifica se a sala já está cheia
    if (room.players.length >= 8) {
      socket.emit('errorMessage', { message: 'Esta mesa já está cheia.' });
      return;
    }
    socket.join(roomId);
    room.players.push({ id: socket.id, nick, chips: initialChips });
    console.log(`Jogador ${nick} entrou na ${roomId} com ${initialChips} fichas`);
    io.to(roomId).emit('playersUpdate', { players: room.players });
  });

  // Evento para iniciar o jogo
  socket.on('startGame', (roomId) => {
    startGame(roomId);
  });

  // Evento para as ações do jogador
  socket.on('playerAction', (data) => {
    const { roomId, action, amount } = data;
    const room = rooms[roomId];
    if (!room || !room.gameState) return;
    const gs = room.gameState;
    const currentPlayer = gs.playersInGame[gs.currentPlayerIndex];
    if (currentPlayer.id !== socket.id) return;
    playerAction(roomId, action, amount, currentPlayer);
  });

  // Evento para finalizar a rodada (SHOWDOWN)
  socket.on('endRound', (roomId) => {
    const room = rooms[roomId];
    if (!room || !room.gameState) return;
    if (room.gameState.stage === 'SHOWDOWN') {
      determineWinner(roomId);
    } else {
      room.gameState.stage = "WAITING";
      io.to(roomId).emit('gameStateUpdate', getPublicGameState(room.gameState));
    }
  });

  // Desconexão: remove o socket de players e espectadores
  socket.on('disconnecting', () => {
    const roomsJoined = Array.from(socket.rooms).filter(r => r !== socket.id);
    roomsJoined.forEach(roomId => {
      const room = rooms[roomId];
      if (!room) return;
      room.players = room.players.filter(player => player.id !== socket.id);
      room.spectators = room.spectators.filter(spectator => spectator.id !== socket.id);
      io.to(roomId).emit('playersUpdate', { players: room.players });
    });
  });

  socket.on('disconnect', () => {
    console.log("Usuário desconectado:", socket.id);
  });
});

/* ------------------------- Lógica do Jogo ------------------------- */

// Inicia uma nova partida usando os saldos atuais dos jogadores ativos.
// A rotação do jogador que inicia é feita com base em room.startingIndex.
function startGame(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.players.length < 2) {
    io.to(roomId).emit('notEnoughPlayers', { message: 'É necessário ter ao menos 2 jogadores para iniciar o jogo.' });
    return;
  }
  // Define a rotação: use room.startingIndex (inicializado em 0 se não existir) e atualize-o para a próxima rodada.
  if (typeof room.startingIndex === 'undefined' || room.startingIndex >= room.players.length) {
    room.startingIndex = 0;
  }
  const start = room.startingIndex;
  room.startingIndex = (room.startingIndex + 1) % room.players.length;
  
  // Cria um novo gameState utilizando os saldos atuais dos jogadores ativos
  room.gameState = {
    stage: 'WAITING',
    deck: [],
    communityCards: [],
    pot: 0,
    currentPlayerIndex: 0, // será definido a seguir
    bigBlind: 10,
    bettingRoundStart: 0,
    playersInGame: room.players.map(p => ({
      id: p.id,
      nick: p.nick,
      chips: p.chips,
      cards: [],
      folded: false,
      allIn: false,
      betAmount: 0,
      lastAction: ""
    }))
  };
  
  const gs = room.gameState;
  gs.deck = shuffleDeck(createDeck());

  // Distribui 2 cartas para cada jogador
  gs.playersInGame.forEach(player => {
    player.cards.push(gs.deck.pop());
    player.cards.push(gs.deck.pop());
  });

  gs.stage = 'PRE-FLOP';

  // Rotaciona os blinds: usando o índice de início "start"
  if (gs.playersInGame.length >= 3) {
    const n = gs.playersInGame.length;
    const smallBlindIndex = start;
    const bigBlindIndex = (start + 1) % n;
    const firstToAct = (start + 2) % n;
    const smallBlind = gs.bigBlind / 2;
    const bigBlind = gs.bigBlind;
    if (gs.playersInGame[smallBlindIndex].chips >= smallBlind) {
      gs.playersInGame[smallBlindIndex].chips -= smallBlind;
      gs.playersInGame[smallBlindIndex].betAmount = smallBlind;
      gs.playersInGame[smallBlindIndex].lastAction = `Small Blind (${smallBlind})`;
      gs.pot += smallBlind;
      if (gs.playersInGame[smallBlindIndex].chips === 0) gs.playersInGame[smallBlindIndex].allIn = true;
    }
    if (gs.playersInGame[bigBlindIndex].chips >= bigBlind) {
      gs.playersInGame[bigBlindIndex].chips -= bigBlind;
      gs.playersInGame[bigBlindIndex].betAmount = bigBlind;
      gs.playersInGame[bigBlindIndex].lastAction = `Big Blind (${bigBlind})`;
      gs.pot += bigBlind;
      if (gs.playersInGame[bigBlindIndex].chips === 0) gs.playersInGame[bigBlindIndex].allIn = true;
    }
    gs.currentPlayerIndex = firstToAct;
  } else {
    gs.currentPlayerIndex = start;
  }
  gs.bettingRoundStart = gs.currentPlayerIndex;
  io.to(roomId).emit('gameStarted', { gameState: getPublicGameState(gs) });
}

// Processa as ações dos jogadores
function playerAction(roomId, action, amount, currentPlayer) {
  const room = rooms[roomId];
  if (!room || !room.gameState) return;
  const gs = room.gameState;

  switch(action) {
    case "fold":
      currentPlayer.folded = true;
      currentPlayer.lastAction = "Fold";
      break;
    case "check":
      currentPlayer.lastAction = "Check";
      break;
    case "call": {
      const maxBet = Math.max(...gs.playersInGame.map(p => p.betAmount));
      const callAmount = maxBet - currentPlayer.betAmount;
      if (currentPlayer.chips >= callAmount) {
        currentPlayer.chips -= callAmount;
        currentPlayer.betAmount += callAmount;
        gs.pot += callAmount;
        currentPlayer.lastAction = "Call " + callAmount;
        if (currentPlayer.chips === 0) currentPlayer.allIn = true;
      } else {
        currentPlayer.lastAction = "All‑In";
        gs.pot += currentPlayer.chips;
        currentPlayer.betAmount += currentPlayer.chips;
        currentPlayer.chips = 0;
        currentPlayer.allIn = true;
      }
      break;
    }
    case "bet": {
      const betVal = parseInt(amount, 10);
      if (currentPlayer.chips >= betVal) {
        currentPlayer.chips -= betVal;
        currentPlayer.betAmount += betVal;
        gs.pot += betVal;
        currentPlayer.lastAction = "Bet " + betVal;
        gs.bettingRoundStart = gs.currentPlayerIndex;
        if (currentPlayer.chips === 0) currentPlayer.allIn = true;
      }
      break;
    }
    case "raise": {
      const maxBet = Math.max(...gs.playersInGame.map(p => p.betAmount));
      const desiredBet = maxBet * 2;
      const additional = desiredBet - currentPlayer.betAmount;
      if (currentPlayer.chips >= additional) {
        currentPlayer.chips -= additional;
        currentPlayer.betAmount += additional;
        gs.pot += additional;
        currentPlayer.lastAction = `Raise to ${desiredBet}`;
        if (currentPlayer.chips === 0) currentPlayer.allIn = true;
      } else {
        currentPlayer.lastAction = "All‑In";
        gs.pot += currentPlayer.chips;
        currentPlayer.betAmount += currentPlayer.chips;
        currentPlayer.chips = 0;
        currentPlayer.allIn = true;
      }
      break;
    }
    case "all-in": {
      currentPlayer.lastAction = "All‑In";
      gs.pot += currentPlayer.chips;
      currentPlayer.betAmount += currentPlayer.chips;
      currentPlayer.chips = 0;
      currentPlayer.allIn = true;
      break;
    }
  }

  // Se todos os jogadores ativos (não-foldados) estiverem sem opção de apostar, encerra a rodada.
  const activeNotFolded = gs.playersInGame.filter(p => !p.folded);
  const allActiveNoOption = activeNotFolded.every(p => p.allIn || p.chips === 0);
  if (allActiveNoOption) {
    gs.stage = 'SHOWDOWN';
    determineWinner(roomId);
    return;
  }

  // Se apenas um jogador não deu fold, encerra a rodada.
  const notFolded = gs.playersInGame.filter(p => !p.folded);
  if (notFolded.length === 1) {
    const winner = notFolded[0];
    winner.chips += gs.pot;
    io.to(roomId).emit('roundEnded', { 
      winner: winner.nick, 
      pot: gs.pot,
      message: `${winner.nick} ganhou o pote de ${gs.pot} fichas por fold dos demais!`
    });
    room.players = room.players.map(p => {
      const gameP = gs.playersInGame.find(pi => pi.id === p.id);
      return gameP ? { ...p, chips: gameP.chips } : p;
    }).filter(p => p.chips > 0);
    resetGameState(roomId);
    return;
  }

  // Avança para o próximo jogador ativo (pula jogadores que deram fold ou estão all-in)
  let nextIndex = gs.currentPlayerIndex;
  for (let i = 0; i < gs.playersInGame.length; i++) {
    nextIndex = (nextIndex + 1) % gs.playersInGame.length;
    if (!gs.playersInGame[nextIndex].folded && !gs.playersInGame[nextIndex].allIn) break;
  }
  gs.currentPlayerIndex = nextIndex;

  // Se a vez voltou ao jogador que iniciou a rodada e as apostas estão iguais, passa para o próximo estágio.
  const active = gs.playersInGame.filter(p => !p.folded);
  const allEqual = active.every(p => p.betAmount === active[0].betAmount);
  if (gs.currentPlayerIndex === gs.bettingRoundStart && allEqual) {
    nextStage(roomId);
  } else {
    io.to(roomId).emit('gameStateUpdate', getPublicGameState(gs));
  }
}

// Avança para o próximo estágio do jogo
function nextStage(roomId) {
  const room = rooms[roomId];
  if (!room || !room.gameState) return;
  const gs = room.gameState;
  switch (gs.stage) {
    case 'PRE-FLOP':
      gs.stage = 'FLOP';
      gs.communityCards.push(gs.deck.pop(), gs.deck.pop(), gs.deck.pop());
      break;
    case 'FLOP':
      gs.stage = 'TURN';
      gs.communityCards.push(gs.deck.pop());
      break;
    case 'TURN':
      gs.stage = 'RIVER';
      gs.communityCards.push(gs.deck.pop());
      break;
    case 'RIVER':
      gs.stage = 'SHOWDOWN';
      break;
    case 'SHOWDOWN':
      determineWinner(roomId);
      return;
  }
  io.to(roomId).emit('gameStateUpdate', getPublicGameState(gs));
}

// Determina o vencedor da rodada
function determineWinner(roomId) {
  const room = rooms[roomId];
  if (!room || !room.gameState) return;
  const gs = room.gameState;
  const hands = gs.playersInGame.filter(p => !p.folded).map(player => {
    const allCards = [...player.cards, ...gs.communityCards];
    return { player, handValue: evaluateHand(allCards) };
  });
  hands.sort((a, b) => b.handValue - a.handValue);
  const winner = hands[0];
  winner.player.chips += gs.pot;
  io.to(roomId).emit('roundEnded', { 
    winner: winner.player.nick, 
    pot: gs.pot,
    message: `${winner.player.nick} ganhou o pote de ${gs.pot} fichas!`
  });
  
  // Atualiza os saldos e remove jogadores com 0 fichas
  room.players = room.players.map(p => {
    const gameP = gs.playersInGame.find(pi => pi.id === p.id);
    return gameP ? { ...p, chips: gameP.chips } : p;
  }).filter(p => p.chips > 0);
  
  resetGameState(roomId);
}

// Reinicia o estado do jogo para a mesa, preservando os saldos atuais dos jogadores ativos
// e adicionando os espectadores (se houver) à lista de jogadores para a próxima rodada.
function resetGameState(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room.spectators.length > 0) {
    room.players = room.players.concat(room.spectators);
    room.spectators = [];
  }
  room.gameState = {
    stage: 'WAITING',
    deck: [],
    communityCards: [],
    pot: 0,
    currentPlayerIndex: 0,
    bigBlind: 10,
    bettingRoundStart: 0,
    playersInGame: room.players.map(p => ({
      id: p.id,
      nick: p.nick,
      chips: p.chips,
      cards: [],
      folded: false,
      allIn: false,
      betAmount: 0,
      lastAction: ""
    }))
  };
}

// Retorna o estado público do jogo
function getPublicGameState(gs) {
  return {
    stage: gs.stage,
    communityCards: gs.communityCards,
    pot: gs.pot,
    currentPlayerIndex: gs.currentPlayerIndex,
    players: gs.playersInGame.map(p => ({
      id: p.id,
      nick: p.nick,
      chips: p.chips,
      folded: p.folded,
      allIn: p.allIn,
      betAmount: p.betAmount,
      lastAction: p.lastAction,
      cards: p.cards
    }))
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
