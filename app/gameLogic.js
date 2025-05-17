const SUITS = ['C', 'D', 'H', 'S'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const VALUE_RANK = VALUES.reduce((obj, v, i) => (obj[v] = i, obj), {});

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ value, suit });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Retorna um score numérico detalhado para desempate
function evaluateHand(cards7) {
  const valueCount = {};
  const suitCount = {};

  cards7.forEach(card => {
    valueCount[card.value] = (valueCount[card.value] || 0) + 1;
    suitCount[card.suit] = (suitCount[card.suit] || 0) + 1;
  });

  // Ordena índices de valores
  const indices = cards7.map(c => VALUE_RANK[c.value]).sort((a, b) => a - b);
  const unique = [...new Set(indices)];

  // Detecta straight
  let longest = 1, curr = 1;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] === unique[i-1] + 1) {
      curr++;
      longest = Math.max(longest, curr);
    } else curr = 1;
  }
  const isStraight = longest >= 5;
  const topStraight = isStraight ? unique.reduce((acc, v, i, arr) => {
    if (i >= 4 && arr[i] === arr[i-1]+1 && arr[i-1]===arr[i-2]+1 && arr[i-2]===arr[i-3]+1 && arr[i-3]===arr[i-4]+1) {
      return Math.max(acc, v);
    }
    return acc;
  }, 0) : -1;

  // Detecta flush
  const flushSuit = Object.keys(suitCount).find(s => suitCount[s] >= 5);
  let flushVals = [];
  if (flushSuit) {
    flushVals = cards7
      .filter(c => c.suit===flushSuit)
      .map(c => VALUE_RANK[c.value])
      .sort((a,b) => b - a)
      .slice(0,5);
  }

  // Conta pares, trincas e quad
  const pairs = [], threes = [], fours = [];
  for (let v in valueCount) {
    if (valueCount[v]===2) pairs.push(VALUE_RANK[v]);
    if (valueCount[v]===3) threes.push(VALUE_RANK[v]);
    if (valueCount[v]===4) fours.push(VALUE_RANK[v]);
  }
  pairs.sort((a,b)=>b-a);
  threes.sort((a,b)=>b-a);
  fours.sort((a,b)=>b-a);

  // Determina categoria
  let category;
  if (isStraight && flushSuit) category = 8;          // Straight flush
  else if (fours.length) category = 7;                  // Four of a kind
  else if (threes.length && pairs.length) category = 6; // Full house
  else if (flushSuit) category = 5;                     // Flush
  else if (isStraight) category = 4;                    // Straight
  else if (threes.length) category = 3;                 // Three of a kind
  else if (pairs.length >= 2) category = 2;             // Two pair
  else if (pairs.length === 1) category = 1;            // One pair
  else category = 0;                                     // High card

  // Tiebreakers
  const tiebreak = [];
  switch(category) {
    case 8: // Straight flush: valor do topo da sequência
      tiebreak.push(topStraight);
      break;
    case 7: // Four of a kind + kicker
      tiebreak.push(fours[0]);
      tiebreak.push(...indices.filter(i => i !== fours[0]).slice(-1));
      break;
    case 6: // Full house (trinca + par)
      tiebreak.push(threes[0]);
      tiebreak.push(pairs[0]);
      break;
    case 5: // Flush: top 5 flush
      tiebreak.push(...flushVals);
      break;
    case 4: // Straight: topStraight
      tiebreak.push(topStraight);
      break;
    case 3: // Three of a kind + 2 kickers
      tiebreak.push(threes[0]);
      tiebreak.push(...indices.filter(i => i !== threes[0]).slice(-2).reverse());
      break;
    case 2: // Two pair + kicker
      tiebreak.push(pairs[0], pairs[1]);
      tiebreak.push(...indices.filter(i => i !== pairs[0] && i !== pairs[1]).slice(-1));
      break;
    case 1: // One pair + 3 kickers
      tiebreak.push(pairs[0]);
      tiebreak.push(...indices.filter(i => i !== pairs[0]).slice(-3).reverse());
      break;
    default: // High card top 5
      tiebreak.push(...indices.slice(-5).reverse());
  }

  // Constrói score: categoria * 1e8 + cada tiebreak
  let score = category * 1e8;
  for (let i = 0; i < Math.min(tiebreak.length, 5); i++) {
    score += tiebreak[i] * Math.pow(1e6, (4 - i) / 4);
  }
  return score;
}

module.exports = { createDeck, shuffleDeck, evaluateHand };
