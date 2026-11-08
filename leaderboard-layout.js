import { canonical, isHeld } from './core.js';

export const teamLabel = team => `${team.name} (${[0, 1, 2].map(index => team.players[index] || 'Vacant').join(', ')})`;

// Presentation only: totals, discards and ranking always come from league().
export function weekendCards(team, round) {
  const raw = new Map(round.cards.map(card => [canonical(card.player), card.score]));
  const cards = [0, 1, 2].map(index => {
    const player = team.players[index];
    const score = player ? raw.get(canonical(player)) : undefined;
    const held = Boolean(player && isHeld(team, player));
    return { score, held, text: score === undefined ? held ? 'NA H' : 'NA' : `${score}${held ? ' H' : ''}`, counting: false };
  });
  if (round.qualifying && !round.canceled) {
    // Equal cards use player order for emphasis, not an additional scoring tie rule.
    cards.map((card, index) => ({ ...card, index }))
      .filter(card => card.score !== undefined && !card.held)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 2).forEach(card => { cards[card.index].counting = true; });
  }
  return cards;
}
