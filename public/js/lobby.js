// public/js/lobby.js
// Defina a URL do backend (Render Web Service)
const BACKEND_URL = 'https://poker-online-free.onrender.com';

// Recupera parâmetros da URL para prefixar nick e chips em navegação
const urlParams = new URLSearchParams(window.location.search);
const nick = urlParams.get('nick') || '';
const chips = urlParams.get('chips') || '';

// Função para renderizar as mesas na tela
function renderTables(tables) {
  const container = document.getElementById('tablesContainer');
  container.innerHTML = '';// limpa conteúdo anterior

  tables.forEach(table => {
    const div = document.createElement('div');
    div.className = 'table';
    div.innerHTML = `
      <h3>${table.name}</h3>
      <p>Jogadores: ${table.players.join(', ') || 'Nenhum'}</p>
      <p>Vagas disponíveis: ${table.availableSpots}</p>
    `;
    div.addEventListener('click', () => {
      // Redireciona ao game.html apontando para o backend
      window.location.href = `${BACKEND_URL}/game.html?roomId=${table.id}&nick=${encodeURIComponent(nick)}&chips=${chips}`;
    });
    container.appendChild(div);
  });
}

// Fetch absoluto para garantir chamada ao Web Service
fetch(`${BACKEND_URL}/api/roomsWithPlayers`)
  .then(response => {
    if (!response.ok) throw new Error('Erro na resposta do servidor');
    return response.json();
  })
  .then(data => renderTables(data))
  .catch(err => console.error('Erro ao carregar mesas:', err));
