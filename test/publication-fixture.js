import { readFile } from 'node:fs/promises';
import { parseJSON } from '../core.js';

export async function publicationThrough(date) {
  const state = parseJSON(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  state.rounds = state.rounds.filter(round => round.date <= date);
  return state;
}
