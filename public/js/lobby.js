// Recupera parâmetros da URL
const urlParams = new URLSearchParams(window.location.search);
const nick = urlParams.get('nick');
const chips = urlParams.get('chips');

function renderTables(tables) {
  const container = document.getElementById('tablesContainer');
  tables.forEach(table => {
    const div = document.createElement('div');
    div.className = 'table';
    div.innerHTML = `
      <h3>${table.name}</h3>
      <p>Jogadores: ${table.players.join(', ') || 'Nenhum'}</p>
      <p>Vagas disponíveis: ${table.availableSpots}</p>
    `;
    div.addEventListener('click', () => {
      window.location.href = `game.html?roomId=${table.id}&nick=${encodeURIComponent(nick)}&chips=${chips}`;
    });
    container.appendChild(div);
  });
}

fetch('/api/roomsWithPlayers')
  .then(response => response.json())
  .then(data => renderTables(data))
  .catch(err => console.error('Erro ao carregar mesas:', err));
