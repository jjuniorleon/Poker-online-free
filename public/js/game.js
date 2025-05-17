function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function getCardImagePath(card) {
  return `images/${card.value}${card.suit}.png`;
}

class GameClient {
  constructor() {
    this.roomId = getQueryParam("roomId");
    this.nick = getQueryParam("nick");
    this.chips = parseInt(getQueryParam("chips"), 10) || 1000;
    this.localChips = 0;
    this.socket = io();

    // Elementos da página
    this.roomInfo = document.getElementById("roomInfo");
    this.stageInfo = document.getElementById("stageInfo");
    this.potInfo = document.getElementById("potInfo");
    this.turnInfo = document.getElementById("turnInfo");
    this.myChipsInfo = document.getElementById("myChipsInfo");
    this.communityCardsDiv = document.getElementById("communityCards");
    this.playersContainer = document.getElementById("playersContainer");
    this.iniciarContainer = document.getElementById("iniciarContainer");
    this.acoesContainer = document.getElementById("acoesContainer");
    this.startGameBtn = document.getElementById("startGameBtn");
    this.foldBtn = document.getElementById("foldBtn");
    this.checkBtn = document.getElementById("checkBtn");
    this.callBtn = document.getElementById("callBtn");
    this.betBtn = document.getElementById("betBtn");
    this.raiseBtn = document.getElementById("raiseBtn");
    this.allInBtn = document.getElementById("allInBtn");
    this.betAmountInput = document.getElementById("betAmount");
    this.endRoundBtn = document.getElementById("endRoundBtn");
    this.backButton = document.getElementById("backButton");

    this.setupSocket();
    this.setupUI();
    this.joinRoom();
    this.startPolling();
  }

  joinRoom() {
    this.socket.emit("joinRoom", {
      roomId: this.roomId,
      nick: this.nick,
      chips: this.chips,
    });
  }

  setupSocket() {
    this.socket.on("playersUpdate", (data) => this.updatePlayers(data));
    this.socket.on("notEnoughPlayers", (data) => alert(data.message));
    this.socket.on("gameStarted", (data) => {
      if (data.gameState) this.updateGameState(data.gameState);
    });
    this.socket.on("gameStateUpdate", (gameState) => {
      if (gameState) this.updateGameState(gameState);
    });
    this.socket.on("roundEnded", (data) => {
      alert(data.message);
      this.updateGameState({ stage: "SHOWDOWN" });
    });
    this.socket.on("errorMessage", (data) => alert(data.message));
    this.socket.on("infoMessage", (data) => alert(data.message));
  }

  setupUI() {
    this.startGameBtn.addEventListener("click", () => {
      this.socket.emit("startGame", this.roomId);
    });
    this.foldBtn.addEventListener("click", () => this.sendAction("fold"));
    this.checkBtn.addEventListener("click", () => this.sendAction("check"));
    this.callBtn.addEventListener("click", () => this.sendAction("call"));
    this.betBtn.addEventListener("click", () => {
      const amount = this.getAmount();
      if (amount !== null) this.sendAction("bet", amount);
    });
    this.raiseBtn.addEventListener("click", () => this.sendAction("raise"));
    this.allInBtn.addEventListener("click", () => this.sendAction("all-in"));
    this.endRoundBtn.addEventListener("click", () => {
      this.socket.emit("endRound", this.roomId);
    });
    // Botão para voltar à seleção de mesas
    this.backButton.addEventListener("click", () => {
      window.location.href = `lobby.html?nick=${encodeURIComponent(
        this.nick
      )}&chips=${this.localChips}`;
    });
  }

  getAmount() {
    const amount = parseInt(this.betAmountInput.value, 10);
    if (isNaN(amount) || amount <= 0) {
      alert("Informe um valor válido.");
      return null;
    }
    if (this.localChips < amount) {
      alert("Você não tem fichas suficientes.");
      return null;
    }
    this.betAmountInput.value = "";
    return amount;
  }

  sendAction(action, amount) {
    const payload = { roomId: this.roomId, action };
    if (amount !== undefined) payload.amount = amount;
    this.socket.emit("playerAction", payload);
  }

  updatePlayers(data) {
    if (!data || !data.players) return;
    this.roomInfo.textContent = `Mesa: ${this.roomId} | Jogadores: ${data.players.length}`;
    this.playersContainer.innerHTML = "";
    data.players.forEach((player) => {
      const div = document.createElement("div");
      div.className = "player";
      div.textContent = player.nick;
      this.playersContainer.appendChild(div);
    });
  }

  updateGameState(gs) {
    if (!gs) return;

    this.communityCardsDiv.innerHTML = "";
    
    // Define um array de cartas comunitárias, com 5 espaços sempre preenchidos
    const revealedCards = gs.communityCards || [];
    
    for (let i = 0; i < 5; i++) {
        const img = document.createElement("img");
        if (revealedCards[i]) {
            img.src = getCardImagePath(revealedCards[i]); // Carta real revelada
        } else {
            img.src = "images/card-back.png"; // Fundo padrão para cartas não reveladas
        }
        img.alt = "Carta Comunitária";
        img.className = "card-img";
        this.communityCardsDiv.appendChild(img);
    }

    // Se estivermos no início de nova rodada (WAITING) e o jogador local não estiver na lista de jogadores
    // (por ter sido espectador) ou tiver 0 fichas, redireciona para o lobby.
    const localPlayer = gs.players.find((p) => p.id === this.socket.id);
    if (gs.stage === "WAITING" && (!localPlayer || localPlayer.chips === 0)) {
      alert(
        "Você está fora da partida ou ficou sem fichas. Voltando para o lobby."
      );
      window.location.href = `lobby.html?nick=${encodeURIComponent(this.nick)}`;
      return;
    }

    this.stageInfo.textContent = `Fase: ${gs.stage}`;
    this.potInfo.textContent = `Pote: ${gs.pot}`;

    // Se não for sua vez, oculta a área de ações.
    if (gs.stage === "WAITING") {
      this.iniciarContainer.style.display = "block";
      this.acoesContainer.style.display = "none";
      this.endRoundBtn.style.display = "none";
    } else {
      this.iniciarContainer.style.display = "none";
      if (
        gs.players[gs.currentPlayerIndex].id === localPlayer.id &&
        gs.stage !== "SHOWDOWN"
      ) {
        this.acoesContainer.style.display = "block";
      } else {
        this.acoesContainer.style.display = "none";
      }
    }
    if (gs.stage === "SHOWDOWN") {
      this.endRoundBtn.style.display = "block";
    } else {
      this.endRoundBtn.style.display = "none";
    }

    // Atualiza as cartas comunitárias
    this.communityCardsDiv.innerHTML = "";
    gs.communityCards.forEach((card) => {
      const img = document.createElement("img");
      img.src = getCardImagePath(card);
      img.alt = `${card.value}${card.suit}`;
      img.className = "card-img";
      this.communityCardsDiv.appendChild(img);
    });

    // Atualiza os dados dos jogadores
    const maxBet = Math.max(...gs.players.map((p) => p.betAmount));
    const callAmount = localPlayer ? maxBet - localPlayer.betAmount : 0;
    this.playersContainer.innerHTML = "";
    gs.players.forEach((player, idx) => {
      const playerDiv = document.createElement("div");
      playerDiv.className = "playerInfo";
      if (idx === gs.currentPlayerIndex && gs.stage !== "SHOWDOWN") {
        playerDiv.classList.add("highlight");
      }
      playerDiv.innerHTML = `<strong>${player.nick}${
        player.folded ? " (FOLD)" : ""
      }</strong>
                             <p>Fichas: ${player.chips} | Aposta: ${
        player.betAmount
      }</p>
                             <p>Ação: ${player.lastAction}</p>`;
      if (player.id === this.socket.id || gs.stage === "SHOWDOWN") {
        const cardsDiv = document.createElement("div");
        cardsDiv.className = "cardsContainer";
        player.cards.forEach((card) => {
          const img = document.createElement("img");
          img.src = getCardImagePath(card);
          img.alt = `${card.value}${card.suit}`;
          img.className = "card-img";
          cardsDiv.appendChild(img);
        });
        playerDiv.appendChild(cardsDiv);

        if (player.id === this.socket.id) this.localChips = player.chips;
      }
      this.playersContainer.appendChild(playerDiv);
    });
    this.myChipsInfo.textContent = `Você tem: ${this.localChips} fichas`;

    // Exibe a área de ações somente se for sua vez
    if (
      gs.players[gs.currentPlayerIndex].id === localPlayer.id &&
      gs.stage !== "WAITING" &&
      gs.stage !== "SHOWDOWN"
    ) {
      this.turnInfo.textContent = "É a sua vez!";
      if (maxBet === 0) {
        this.betAmountInput.style.display = "inline-block";
        this.betBtn.style.display = "inline-block";
        this.callBtn.style.display = "none";
        this.raiseBtn.style.display = "none";
        this.checkBtn.style.display = "none";
      } else {
        if (localPlayer.betAmount === maxBet) {
          this.checkBtn.style.display = "inline-block";
          if (localPlayer.chips > 0) {
            this.betAmountInput.style.display = "inline-block";
            this.betBtn.style.display = "inline-block";
          } else {
            this.betAmountInput.style.display = "none";
            this.betBtn.style.display = "none";
          }
          this.callBtn.style.display = "none";
          this.raiseBtn.style.display = "none";
        } else {
          if (callAmount > 0 && localPlayer.chips >= callAmount) {
            this.callBtn.style.display = "inline-block";
          } else {
            this.callBtn.style.display = "none";
          }
          if (callAmount > 0 && localPlayer.chips > callAmount) {
            this.raiseBtn.style.display = "inline-block";
          } else {
            this.raiseBtn.style.display = "none";
          }
          this.checkBtn.style.display = "none";
          this.betAmountInput.style.display = "none";
          this.betBtn.style.display = "none";
        }
      }
    } else {
      this.turnInfo.textContent = "";
    }
  }

  startPolling() {
    setInterval(() => {
      fetch(`/api/gameState?roomId=${this.roomId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.stage) this.updateGameState(data);
        })
        .catch(() => {});
    }, 3000);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new GameClient();
});
