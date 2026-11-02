import { canonical, validateState } from './core.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const conflict = label => { throw new Error(`Sync conflict: ${label}. Your draft was preserved. Download a backup, compare with published results, then correct the draft or use Replace draft with published data. For score corrections, the owner can explicitly replace the complete weekend with update:results.`); };

function value(local, online, base, label) {
  if (same(local, online) || same(online, base)) return structuredClone(local);
  if (same(local, base)) return structuredClone(online);
  return conflict(label);
}
function fields(local, online, base, keys, label) {
  return Object.fromEntries(keys.map(key => [key, value(local[key], online[key], base?.[key], `${label}, ${key}`)])
    .filter(([, entry]) => entry !== undefined));
}
function entries(local, online, base, key, merge, label, protect = false) {
  const l = new Map(local.map(item => [key(item), item]));
  const o = new Map(online.map(item => [key(item), item]));
  const b = new Map((base || []).map(item => [key(item), item]));
  return [...new Set([...o.keys(), ...l.keys(), ...b.keys()])].flatMap(id => {
    const left = l.get(id), right = o.get(id), old = b.get(id);
    if (left && right) return [merge(left, right, old, `${label} ${id}`)];
    if (right) {
      if (old && protect) conflict(`${label} ${id} was removed locally but is published`);
      const result = old ? value(undefined, right, old, `${label} ${id} was removed locally and changed online`) : right;
      return result ? [structuredClone(result)] : [];
    }
    if (left) {
      const result = old ? value(left, undefined, old, `${label} ${id} was removed online and changed locally`) : left;
      return result ? [structuredClone(result)] : [];
    }
    return [];
  });
}

// A baseline permits independent local and online edits to merge. Legacy drafts
// have no baseline, so differing shared values require an explicit resolution.
export function synchroniseDraft(draft, published, baseline = null) {
  validateState(draft); validateState(published);
  if (baseline) validateState(baseline);
  if (published.teams.length && draft.rounds.some(round => round.date < '2026-10-01' || round.date > '2027-04-30'))
    conflict('this draft contains weekends outside Winter League 2026/2027');
  if (published.teams.length && draft.teams.length) {
    const known = new Set((baseline?.teams || published.teams).map(team => canonical(team.name)));
    if (!draft.teams.some(team => known.has(canonical(team.name))))
      conflict('this draft has an unrelated team list, not the current league');
    const players = new Set(published.teams.flatMap(team => team.players.map(canonical)));
    if (!baseline && !draft.teams.some(team => team.players.some(player => players.has(canonical(player)))))
      conflict('this legacy draft has unrelated players despite reusing current team numbers');
  }
  const next = {
    version: 1,
    settings: baseline ? fields(draft.settings, published.settings, baseline.settings, ['maxRounds', 'discardCount', 'complete', 'finalScoring'], 'settings') : structuredClone(draft.settings),
    teams: !draft.teams.length ? structuredClone(published.teams) : !published.teams.length ? structuredClone(draft.teams) :
      entries(draft.teams, published.teams, baseline?.teams, team => canonical(team.name),
        (local, online, base, label) => base
          ? fields(local, online, base, ['name', 'players', 'notes', 'heldPlayers'], label)
          : structuredClone(local), 'team'),
    rounds: entries(draft.rounds, published.rounds, baseline?.rounds, round => round.date,
      (local, online, base, label) => ({
        ...fields(local, online, base, ['date', 'name', 'qualifying', 'canceled'], label),
        cards: entries(local.cards, online.cards, base?.cards, card => canonical(card.player),
          (l, o, b, name) => fields(l, o, b, ['player', 'score', 'handicap'], name), `${label}, card`, true)
      }), 'weekend', true),
    final: value(draft.final, published.final, baseline?.final ?? null, 'final cards')
  };
  return validateState(next);
}

export function protectPublishedHistory(candidate, published, replacements = []) {
  validateState(candidate); validateState(published);
  if (published.teams.length && !candidate.teams.some(team => published.teams.some(old => canonical(old.name) === canonical(team.name))))
    throw new Error('Unrelated or missing team list. Start from the current published league roster, not another season or demo.');
  const allowed = new Set(replacements);
  for (const date of allowed) {
    if (!published.rounds.some(round => round.date === date) || !candidate.rounds.some(round => round.date === date))
      throw new Error(`Replacement ${date} must name an existing weekend present in both files.`);
  }
  for (const old of published.rounds) {
    const round = candidate.rounds.find(entry => entry.date === old.date);
    if (!round) throw new Error(`Published weekend ${old.date} is missing. Publication cannot remove online history.`);
    if (allowed.has(old.date)) continue;
    for (const key of ['name', 'qualifying', 'canceled'])
      if (old[key] !== round[key]) throw new Error(`Published weekend ${old.date} metadata differs. Use --replace-weekend ${old.date} only after reviewing the complete weekend.`);
    for (const card of old.cards) {
      const next = round.cards.find(entry => canonical(entry.player) === canonical(card.player));
      if (!next || next.score !== card.score || next.handicap !== card.handicap)
        throw new Error(`Published card ${old.date}, ${card.player} differs or is missing. Use --replace-weekend ${old.date} with the complete corrected weekend.`);
    }
  }
  return candidate;
}
