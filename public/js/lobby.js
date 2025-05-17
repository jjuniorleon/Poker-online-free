// public/js/lobby.js

// Usa o host atual como backend
const BACKEND_URL = window.location.origin;

// Captura parâmetros da URL (nick e chips)
const urlParams = new URLSearchParams(window.location.search);
const nick = urlParams.get('nick') || '';
const chips = urlParams.get('chips') || '';

// Função para renderizar as mesas
function renderTables(tables) {
  const container = document.getElementById('tablesContainer');
  container.innerHTML = ''; // limpa listas anteriores

  tables.forEach(table => {
    const div = document.createElement('div');
    div.className = 'table';
    div.innerHTML = `
      <h3>${table.name}</h3>
      <p>Jogadores: ${table.players.length > 0 ? table.players.join(', ') : 'Nenhum'}</p>
      <p>Vagas disponíveis: ${table.availableSpots}</p>
    `;

    div.addEventListener('click', () => {
      // Redireciona para a página de jogo relativa ao host atual
      window.location.href = 
        `game.html?roomId=${table.id}` +
        `&nick=${encodeURIComponent(nick)}` +
        `&chips=${encodeURIComponent(chips)}`;
    });

    container.appendChild(div);
  });
}

// Carrega as mesas via fetch relativo
fetch(`/api/roomsWithPlayers`)
  .then(response => {
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
  })
  .then(data => renderTables(data))
  .catch(error => {
    console.error('Erro ao carregar mesas:', error);
    const container = document.getElementById('tablesContainer');
    container.innerHTML = '<p>Não foi possível carregar as mesas. Tente novamente mais tarde.</p>';
  });
