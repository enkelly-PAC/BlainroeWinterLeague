export const MAX_BYTES = 2 * 1024 * 1024;
export const emptyState = () => ({
  version: 1, settings: { maxRounds: 10, discardCount: 2, complete: false, finalScoring: 'best2' },
  teams: [], rounds: [], final: null
});
const fail = message => { throw new Error(message); };
const shape = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: expected an object.`);
  const extra = Object.keys(value).filter(key => !keys.includes(key));
  if (extra.length) fail(`${label}: unsupported field "${extra[0]}". Remove extra fields before publication.`);
};
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\u0000-\u001f]/u.test(value))
    fail(`${label}: provide a nonempty name of at most 160 characters.`);
  return value.trim();
};
export function canonical(value) {
  let name = String(value).trim();
  if (name.includes(',')) {
    const [surname, ...given] = name.split(',');
    name = `${given.join(' ')} ${surname}`;
  }
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
const header = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const unique = (values, label) => {
  const seen = new Set();
  for (const value of values) {
    const key = canonical(text(value, label));
    if (!key) fail(`${label}: a name must contain letters or numbers.`);
    if (seen.has(key)) fail(`${label}: duplicate "${value}". Check spelling and surname-first names.`);
    seen.add(key);
  }
};
const integer = (value, label, max = 300) => {
  if (!Number.isInteger(value) || value < 0 || value > max) fail(`${label}: expected a whole number from 0 to ${max}.`);
};
export function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Date: enter an explicit ISO date (YYYY-MM-DD).');
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(`Invalid date "${value}".`);
  return value;
}
export function weekendDate(value) {
  const date = new Date(`${isoDate(value)}T12:00:00Z`);
  if (![0, 6].includes(date.getUTCDay())) fail('Weekend date must be a Saturday or Sunday. Use the relevant weekend, not the upload date.');
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
export function validateTeams(teams) {
  if (!Array.isArray(teams) || teams.length > 500) fail('Teams: expected an array of at most 500 teams.');
  unique(teams.map(t => t?.name), 'Team');
  const members = new Map();
  for (const team of teams) {
    shape(team, ['name', 'players', 'notes', 'heldPlayers'], 'Team');
    if (!Array.isArray(team.players) || (team.players.length !== 3 && !(canonical(team.name) === 'team34' && team.players.length === 2)))
      fail(`Team "${team.name}" must have exactly 3 players. Only existing Team 34 may have 2 with a vacant third place.`);
    unique(team.players, 'Player within team');
    if (team.notes !== undefined && team.notes !== '') text(team.notes, 'Team notes');
    if (team.heldPlayers !== undefined) {
      if (!Array.isArray(team.heldPlayers)) fail('Held players: expected an array.');
      unique(team.heldPlayers, 'Held player');
      if (team.heldPlayers.some(p => !team.players.some(member => canonical(member) === canonical(p))))
        fail('Held players must be named members of this team.');
    }
    for (const player of team.players) {
      const key = canonical(player);
      if (!members.has(key)) members.set(key, []);
      members.get(key).push({ team, player });
    }
  }
  for (const entries of members.values()) {
    if (entries.length > 1 && entries.some(({ team, player }) => !isHeld(team, player)))
      fail(`Player (globally unique): duplicate "${entries[0].player}". Correct the names or explicitly hold score matching in every affected team.`);
  }
}
export const isHeld = (team, player) => (team.heldPlayers || []).some(p => canonical(p) === canonical(player));
export function assignments(teams) {
  const assigned = new Map();
  for (const team of teams) for (const player of team.players) {
    const key = canonical(player);
    if (isHeld(team, player)) assigned.set(key, 'Unassigned (team list name held for confirmation)');
    else assigned.set(key, team.name);
  }
  return assigned;
}
export function rosterStatus(team) {
  return [team.players.length < 3 ? 'Player 3 vacant' : '',
    team.heldPlayers?.length ? `Score matching held: ${team.heldPlayers.join(', ')}` : '', team.notes || ''].filter(Boolean).join('. ') || 'No team list notes';
}
export function replaceTeams(state, teams) {
  const next = structuredClone(state);
  next.teams = teams.map(team => {
    const old = state.teams.find(t => canonical(t.name) === canonical(team.name));
    const updated = structuredClone(team);
    if (old?.notes && updated.notes === undefined) updated.notes = old.notes;
    if (old?.heldPlayers && updated.heldPlayers === undefined)
      updated.heldPlayers = old.heldPlayers.filter(p => updated.players.some(member => canonical(p) === canonical(member)));
    return updated;
  });
  return validateState(next);
}
export function editTeam(state, originalName, team) {
  if (originalName !== null && team.name !== originalName) fail('Keep the existing team name / number unchanged.');
  if (originalName !== null && !state.teams.some(t => t.name === originalName)) fail('Team no longer exists. Reload the roster editor.');
  const teams = originalName === null ? [...state.teams, team] : state.teams.map(t => t.name === originalName ? team : t);
  return replaceTeams(state, teams);
}
export function validateState(state) {
  if (!state || state.version !== 1) fail('Unsupported state version. Expected version 1.');
  shape(state, ['version', 'settings', 'teams', 'rounds', 'final'], 'State');
  const settings = state.settings;
  shape(settings, ['maxRounds', 'discardCount', 'complete', 'finalScoring'], 'Settings');
  if (!settings || typeof settings.complete !== 'boolean' || !['best2', 'all3'].includes(settings.finalScoring))
    fail('Settings: complete must be boolean; finalScoring must be best2 or all3.');
  integer(settings.maxRounds, 'Maximum rounds', 52);
  if (settings.maxRounds < 1) fail('Maximum rounds must be at least 1.');
  integer(settings.discardCount, 'Discard count', 51);
  if (settings.discardCount >= settings.maxRounds) fail('Discard count must be less than maximum rounds.');
  validateTeams(state.teams);
  if (!Array.isArray(state.rounds) || state.rounds.length > 200) fail('Rounds: expected at most 200 weekends.');
  const dates = new Set();
  let active = 0;
  for (const round of state.rounds) {
    shape(round, ['date', 'name', 'qualifying', 'canceled', 'cards'], 'Round');
    if (!round || weekendDate(round.date) !== round.date) fail('Round dates must use the Saturday ISO weekend key.');
    if (dates.has(round.date)) fail(`Duplicate weekend ${round.date}. Merge or explicitly replace it.`);
    dates.add(round.date);
    text(round.name, 'Round name');
    if (typeof round.qualifying !== 'boolean' || typeof round.canceled !== 'boolean') fail('Round qualifying and canceled must be booleans.');
    if (round.qualifying && !round.canceled) active++;
    if (!Array.isArray(round.cards) || round.cards.length > 5000) fail('Round cards: expected at most 5000 cards.');
    unique(round.cards.map(c => c?.player), `Player in ${round.date}`);
    for (const card of round.cards) {
      shape(card, ['player', 'score', 'handicap'], 'Score card');
      integer(card.score, `Score for ${card.player}`);
      if (card.handicap !== undefined && (typeof card.handicap !== 'number' || !Number.isFinite(card.handicap) || Math.abs(card.handicap) > 100))
        fail(`Invalid handicap for ${card.player}.`);
    }
  }
  if (active > settings.maxRounds) fail(`There are ${active} qualifying weekends, above the configured maximum ${settings.maxRounds}.`);
  if (settings.complete && active === 0) fail('Complete qualification requires at least one active qualifying weekend.');
  if (state.final !== null) validateFinal(state, state.final);
  if (new TextEncoder().encode(JSON.stringify(state, null, 2) + '\n').length > MAX_BYTES)
    fail('Combined state exceeds the 2 MB backup/publication limit. Remove unnecessary rounds or metadata before adding more data.');
  return state;
}
export function parseJSON(source) {
  if (new TextEncoder().encode(source).length > MAX_BYTES) fail('JSON exceeds the 2 MB limit.');
  let state;
  try { state = JSON.parse(source.replace(/^\uFEFF/, '')); } catch { fail('Invalid JSON. Restore a version 1 backup or publication file.'); }
  return validateState(state);
}
export function parseCSV(source) {
  if (new TextEncoder().encode(source).length > MAX_BYTES) fail('CSV exceeds the 2 MB limit.');
  source = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], cell = '', quoted = false, closed = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; }
      } else cell += char;
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else if (char === ',' || char === '\r' || char === '\n') {
      row.push(cell.trim()); cell = ''; closed = false;
      if (char !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === '\r' && source[i + 1] === '\n') i++;
      }
    } else {
      if (char === '"' || (closed && !/\s/.test(char))) fail('Malformed CSV quotes. Quote the entire cell and double embedded quotes.');
      cell += char;
    }
  }
  if (quoted) fail('CSV contains an unclosed quoted field.');
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}
function locate(rows, predicate, label) {
  const index = rows.findIndex(row => predicate(row.map(header)));
  if (index < 0) fail(`${label}: required CSV header not found.`);
  return { columns: rows[index].map(header), data: rows.slice(index + 1) };
}
export function parseTeams(source) {
  const { columns, data } = locate(parseCSV(source), h => (h.includes('team') || h.includes('teamname')) && h.includes('player1'), 'Teams');
  const teamIndex = columns.findIndex(h => h === 'team' || h === 'teamname');
  const indices = [1, 2, 3].map(n => columns.indexOf(`player${n}`));
  if (indices.includes(-1)) fail('Teams CSV requires Team Name, Player1, Player2, Player3.');
  const teams = data.map(row => {
    const team = { name: text(row[teamIndex], 'Team'), players: indices.slice(0, 2).map(i => text(row[i], 'Player')) };
    if (row[indices[2]]) team.players.push(text(row[indices[2]], 'Player'));
    if (columns.includes('notes')) team.notes = row[columns.indexOf('notes')] || '';
    if (columns.includes('heldplayers')) team.heldPlayers = (row[columns.indexOf('heldplayers')] || '').split('|').map(p => p.trim()).filter(Boolean);
    return team;
  });
  if (!teams.length) fail('Teams CSV has no teams.');
  validateTeams(teams);
  return teams;
}
function metadataDate(rows) {
  const dates = [];
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  for (const row of rows) {
    const line = row.join(' ');
    if (/^\s*printed\b/i.test(line) || !/played\s*(on)?|date/i.test(line)) continue;
    for (const match of line.matchAll(/\b(?:(\d{4}-\d{2}-\d{2})|(\d{1,2})[/.](\d{1,2})[/.](\d{4})|(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4}))\b/gi)) {
      dates.push(isoDate(match[1] || (match[2]
        ? `${match[4]}-${match[3].padStart(2, '0')}-${match[2].padStart(2, '0')}`
        : `${match[7]}-${String(months.indexOf(match[6].toLowerCase()) + 1).padStart(2, '0')}-${match[5].padStart(2, '0')}`)));
    }
  }
  const distinct = [...new Set(dates)];
  if (distinct.length < 2) return distinct[0] || null;
  const weekends = [...new Set(distinct.map(weekendDate))];
  if (weekends.length !== 1) fail('Score metadata contains different weekends. Use a separate Aggregated Net Result report for each weekend.');
  return weekends[0];
}
function grossScorecardRows(rows) {
  return rows.some(row => row.some(cell => /^competition scorecards?$/i.test(cell) || /hole by hole scores returned/i.test(cell))) ||
    rows.some(row => {
      const h = row.map(header);
      return h.some(c => ['players', 'player', 'name'].includes(c)) && h.includes('1') && h.includes('18') && h.includes('total');
    });
}
export function classifyScoreCSV(source) {
  const rows = parseCSV(source);
  if (rows.some(row => row.some(cell => /^Aggregated Results\b/i.test(cell))) ||
      rows.some(row => header(row[0] || '') === 'overallposition')) return 'results';
  return grossScorecardRows(rows) ? 'scorecards' : 'results';
}
function metadataName(rows) {
  const names = [];
  for (const row of rows) {
    if (row.map(header).some(cell => ['player', 'name', 'overallposition'].includes(cell))) break;
    if (/^(competition(?: name)?|round(?: name)?)$/i.test(row[0]) && row[1])
      names.push(row[1]);
    const title = row[0]?.match(/^(?:competition(?: name| result)?|round(?: name)?)\s*:\s*(.+)$/i);
    if (title) names.push(title[1]);
  }
  const distinct = [...new Set(names.map(name => name.trim()))];
  return distinct.length === 1 ? text(distinct[0], 'Competition name') : null;
}
export function parseScores(source) {
  const rows = parseCSV(source);
  if (grossScorecardRows(rows)) fail('Competition Scorecards contain gross hole-by-hole strokes, PU and NR, not Winter League net Stableford results. Use Competition Report (Aggregated Net Result) instead. No scores were converted.');
  const aggregateHeader = h => h[0] === 'overallposition' && h[1] === '' && h.some(c => c.startsWith('scoreplay'));
  let { columns, data } = locate(rows, h => aggregateHeader(h) || (h.includes('player') || h.includes('name')) && h.some(c => c === 'score' || c.startsWith('scoreplay') || c === 'stableford'), 'Scores');
  if (columns.some(c => /stroke|gross|medal/.test(c))) fail('Only net Stableford scores are accepted, not stroke/medal/gross exports.');
  const aggregate = aggregateHeader(columns);
  const scoreIndex = columns.findIndex(h => h === 'score' || h.startsWith('scoreplay') || h === 'stableford');
  const omitted = { noReturn: 0, disqualified: 0 };
  if (aggregate) {
    if (!rows.some(row => row.some(cell => /^Aggregated Results\s*-\s*Net Scores$/i.test(cell))))
      fail('Aggregated report must identify Net Scores. Use Competition Report (Aggregated Net Result).');
    const records = [];
    let reportedCount = null;
    for (const row of data) {
      const values = row.filter(Boolean), label = values[0] || '';
      const count = label.match(/^Number of Cards Processed\s*=\s*(\d+)\b/i);
      if (count) { reportedCount = Number(count[1]); break; }
      if (values.length === 1 && /^(Competition Format|Ties|Disqualifications|Twos):$/i.test(label)) break;
      if (aggregateHeader(row.map(header))) {
        if (row.map(header).join(',') !== columns.join(',')) fail('Repeated aggregated report header changed columns.');
        continue;
      }
      if (values.length === 1 && /^(Overall Winners|Division \d+|\(Handicap Indexes.*\))$/i.test(label)) continue;
      if (!/^(?:\d+|-)$/u.test(row[0] || '')) fail('Unexpected aggregated result row. Use the complete Competition Report (Aggregated Net Result) CSV.');
      text(row[1], 'Aggregated result player');
      records.push(row);
    }
    if (reportedCount !== null && reportedCount !== records.length)
      fail(`Aggregated report says ${reportedCount} cards processed but contains ${records.length} result rows. Use the complete report; no partial import was accepted.`);
    unique(records.map(row => row[1]), 'Player in aggregated results');
    data = records.filter(row => {
      const score = row[scoreIndex] || '';
      if (/^(No Return|N\/?R|Withdrawn|W\/?D)$/i.test(score)) { omitted.noReturn++; return false; }
      if (/^(DQ|Disqualified)$/i.test(score) || row.some(cell => /^(DQ\b|Disqualified\b)/i.test(cell))) {
        omitted.disqualified++; return false;
      }
      if (row[0] === '-') fail('Unranked aggregated result has no explicit No Return or DQ status. Confirm the result before importing.');
      return true;
    });
  }
  const playerIndex = aggregate ? 1 : columns.findIndex(h => h === 'player' || h === 'name');
  const handicapIndex = columns.findIndex(h => ['handicap', 'playinghandicap', 'playhcap'].includes(h));
  const cards = data.map((row, index) => {
    const player = text(row[playerIndex], `Player at score row ${index + 1}`);
    if (aggregate && !/^\d+\s*pts\b/i.test(row[scoreIndex] || ''))
      fail('Aggregated net result requires explicit pts values, not gross strokes or blank scores.');
    const match = (row[scoreIndex] || '').match(/^(\d+)(?:\s*pts)?(?:\s*\(([+-]?\d+(?:\.\d+)?)\))?$/i);
    if (!match) fail(`Invalid Stableford score "${row[scoreIndex]}" for ${player}. Use a whole number or "42 pts (10)"; blank/NR cards should be omitted.`);
    const card = { player, score: Number(match[1]) };
    integer(card.score, `Score for ${player}`);
    const handicap = match[2] ?? (handicapIndex >= 0 ? row[handicapIndex] : undefined);
    if (handicap !== undefined && handicap !== '') {
      if (!/^[+-]?\d+(?:\.\d+)?$/.test(handicap) || Math.abs(Number(handicap)) > 100) fail(`Invalid handicap for ${player}.`);
      card.handicap = Number(handicap);
    }
    return card;
  });
  if (!cards.length) fail('Scores CSV has no cards.');
  unique(cards.map(c => c.player), 'Player in uploaded scores');
  const name = metadataName(rows);
  return { cards, playedOn: metadataDate(rows), ...(name ? { name } : {}), ...(aggregate ? { omitted } : {}) };
}
export function importRound(state, input, mode = 'merge') {
  if (!['merge', 'replace'].includes(mode)) fail('Choose merge or replace-weekend mode.');
  const next = structuredClone(state);
  const round = { ...input, date: weekendDate(input.date), cards: structuredClone(input.cards) };
  const index = next.rounds.findIndex(r => r.date === round.date);
  if (index >= 0 && mode === 'merge') {
    const existing = next.rounds[index];
    if (existing.name !== round.name || existing.qualifying !== round.qualifying || existing.canceled !== round.canceled)
      fail('Weekend metadata differs. Edit the existing weekend or explicitly replace the weekend.');
    const cards = new Map(existing.cards.map(c => [canonical(c.player), c]));
    for (const card of round.cards) {
      const previous = cards.get(canonical(card.player));
      if (previous && previous.score !== card.score)
        fail(`Conflicting card for ${card.player}: existing ${previous.score}, uploaded ${card.score}. Use confirmed replace-weekend with the complete corrected CSV.`);
      if (!previous) cards.set(canonical(card.player), card);
    }
    round.cards = [...cards.values()];
  }
  if (index >= 0) next.rounds[index] = round; else next.rounds.push(round);
  return validateState(next);
}
const lex = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] ?? 0) - (a[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
};
export function singles(state, selectedDate = null) {
  const rounds = [...state.rounds].sort((a, b) => b.date.localeCompare(a.date));
  const round = rounds.find(r => r.date === selectedDate) ||
    rounds.find(r => r.qualifying && !r.canceled) || rounds[0] || null;
  const status = !round ? null : round.canceled ? 'Canceled' : round.qualifying ? 'Qualifying' : 'Excluded / nonqualifying';
  const assigned = assignments(state.teams);
  const rows = (round?.cards || []).map(card => ({ player: card.player, score: card.score, team: assigned.get(canonical(card.player)) || 'Unassigned' }));
  rows.sort((a, b) => b.score - a.score || a.player.localeCompare(b.player));
  rows.forEach((row, index) => { row.rank = index && rows[index - 1].score === row.score ? rows[index - 1].rank : index + 1; });
  return { rounds, round, status, rows };
}
export function league(state) {
  const rounds = state.rounds.filter(r => r.qualifying && !r.canceled).sort((a, b) => a.date.localeCompare(b.date));
  const discardCount = state.settings.complete ? Math.min(state.settings.discardCount, Math.max(0, rounds.length - 1)) : 0;
  const rows = state.teams.map(team => {
    const scores = rounds.map(round => {
      const cards = new Map(round.cards.map(c => [canonical(c.player), c.score]));
      const values = team.players.map(player => isHeld(team, player) ? 0 : cards.get(canonical(player)) ?? 0).sort((a, b) => b - a);
      return { date: round.date, total: (values[0] || 0) + (values[1] || 0), missed: 3 - team.players.filter(p => !isHeld(team, p) && cards.has(canonical(p))).length };
    });
    const ordered = scores.map((score, index) => ({ ...score, index })).sort((a, b) => a.total - b.total || a.index - b.index);
    const discarded = ordered.slice(0, discardCount);
    const raw = scores.reduce((sum, r) => sum + r.total, 0);
    return { team, scores: scores.map((s, index) => ({ ...s, discarded: discarded.some(d => d.index === index) })),
      raw, retained: raw - discarded.reduce((sum, s) => sum + s.total, 0),
      discarded: discarded.map(s => s.total).sort((a, b) => b - a) };
  });
  const compare = (a, b) => b.retained - a.retained || lex(a.discarded, b.discarded);
  rows.sort((a, b) => compare(a, b) || a.team.name.localeCompare(b.team.name));
  let previous;
  rows.forEach((row, index) => { row.rank = previous && compare(previous, row) === 0 ? previous.rank : index + 1; previous = row; });
  const cutoffUnresolved = rows.length > 16 && rows[15].rank === rows[16].rank;
  const firstUnresolved = rows.length > 1 && rows[0].rank === rows[1].rank;
  const eligible = cutoffUnresolved ? [] : rows.slice(0, 16).map(r => r.team.name);
  return { rows, rounds, discardCount, cutoffUnresolved, firstUnresolved, eligible };
}
const countbackFields = ['back9', 'back6', 'back3', 'back1'];
export function validateFinal(state, final) {
  const table = league(state);
  if (!state.settings.complete || table.cutoffUnresolved) fail('Final blocked: complete qualification and resolve the top 16 cutoff before entering final cards.');
  if (!final || !Array.isArray(final.cards) || final.cards.length > 48) fail('Final: expected an object with at most 48 cards.');
  shape(final, ['date', 'cards'], 'Final');
  if (final.date !== null) isoDate(final.date);
  unique(final.cards.map(c => c?.player), 'Final player');
  for (const card of final.cards) {
    shape(card, ['team', 'player', 'total', ...countbackFields], 'Final card');
    text(card.team, 'Final team');
    const team = state.teams.find(t => canonical(t.name) === canonical(card.team));
    if (!team || !table.eligible.includes(team.name)) fail(`Final team "${card.team}" is not an eligible registered team.`);
    if (!team.players.some(p => canonical(p) === canonical(card.player))) fail(`Final player "${card.player}" is not registered in "${team.name}".`);
    if (isHeld(team, card.player)) fail(`Final player "${card.player}" has score matching held. Resolve the roster name first.`);
    integer(card.total, `Final total for ${card.player}`);
    let previous = card.total;
    for (const field of countbackFields) {
      if (typeof card[field] !== 'number' || !Number.isFinite(card[field]) || card[field] < 0 || card[field] > previous)
        fail(`${card.player}: ${field} must be finite, nonnegative and no greater than the preceding total/countback.`);
      previous = card[field];
    }
  }
  return final;
}
export function parseFinal(source, state, date = null) {
  const required = ['team', 'player', 'total', ...countbackFields];
  const { columns, data } = locate(parseCSV(source), h => required.every(c => h.includes(c)), 'Final (Team,Player,Total,Back9,Back6,Back3,Back1)');
  const cards = data.map(row => Object.fromEntries(required.map(c => {
    const value = row[columns.indexOf(c)];
    if (c === 'team' || c === 'player') return [c, text(value, c)];
    if (value === undefined || value === '' || !/^\d+(?:\.\d+)?$/.test(value)) fail(`Final ${c}: enter a nonnegative number, not a blank.`);
    return [c, Number(value)];
  })));
  if (!cards.length) fail('Final CSV has no cards.');
  return validateFinal(state, { date: date || null, cards });
}
export function finalTable(state) {
  if (!state.settings.complete || league(state).cutoffUnresolved) return [];
  const rows = league(state).eligible.map(name => {
    const team = state.teams.find(t => t.name === name);
    const cards = (state.final?.cards || []).filter(c => canonical(c.team) === canonical(name));
    const values = cards.map(c => c.total).sort((a, b) => b - a);
    const total = values.slice(0, state.settings.finalScoring === 'best2' ? 2 : 3).reduce((sum, n) => sum + n, 0);
    return { team, cards: cards.length, total, countback: countbackFields.map(f => cards.reduce((sum, c) => sum + c[f], 0)), rank: null };
  });
  const compare = (a, b) => b.total - a.total || lex(a.countback, b.countback);
  const ranked = rows.filter(r => r.cards === 3).sort((a, b) => compare(a, b) || a.team.name.localeCompare(b.team.name));
  ranked.forEach((r, i) => { r.rank = i && compare(ranked[i - 1], r) === 0 ? ranked[i - 1].rank : i + 1; });
  return [...ranked, ...rows.filter(r => r.cards !== 3)];
}
export const csvCell = value => `"${String(value).replaceAll('"', '""')}"`;
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function reportHTML(state, label) {
  validateState(state);
  const table = league(state);
  const headers = ['Rank', 'Team', 'Players', 'Roster status', 'Raw', 'Retained', 'Discarded', ...table.rounds.map(r => r.date)];
  const rowHTML = table.rows.map(r => `<tr>${[r.rank, r.team.name, r.team.players.join(', '), rosterStatus(r.team), r.raw, r.retained, r.discarded.join(', ') || 'None', ...r.scores.map(s => `${s.total}${s.discarded ? ' (discarded)' : ''}; ${s.missed} missed`)].map(v => `<td>${escapeHTML(v)}</td>`).join('')}</tr>`).join('');
  const finals = finalTable(state).map(r => `<tr>${[r.rank ?? 'Unranked', r.team.name, r.cards, r.total, ...r.countback].map(v => `<td>${escapeHTML(v)}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'"><title>Blainroe Winter League report</title><body><h1>Blainroe Men's Winter League 2026/2027</h1><p>Sponsored by Spirit Ford Wicklow</p><p>${escapeHTML(label)}. ${state.settings.complete ? 'Qualification complete' : 'Provisional: no discards yet'}. Discards applied: ${table.discardCount}.</p><p>Committee assumptions: league ties compare discarded scores highest first. Final scoring: ${escapeHTML(state.settings.finalScoring)}, countback uses all 3 cards. Final date: ${escapeHTML(state.final?.date || 'awaiting confirmation')}.</p><p>${table.cutoffUnresolved ? 'Top 16 cutoff unresolved: no confirmed qualifiers.' : 'No cutoff tie across place 16.'} ${table.firstUnresolved ? 'First place unresolved.' : ''}</p><table><caption>League</caption><thead><tr>${headers.map(h => `<th scope="col">${escapeHTML(h)}</th>`).join('')}</tr></thead><tbody>${rowHTML}</tbody></table><h2>Final (zero carryover)</h2><table><thead><tr>${['Rank', 'Team', 'Cards', 'Total', 'Back9', 'Back6', 'Back3', 'Back1'].map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${finals}</tbody></table></body></html>`;
}
