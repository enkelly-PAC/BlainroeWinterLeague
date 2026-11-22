import { canonical, cumulativeSingles, parseCSV, parseScores, playerKey, weekendDate } from './core.js?v=20261115-1';

export const ECLECTIC_HOLES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15];
export const ECLECTIC_PARS = [4, 4, 4, 5, 5, 4, 4, 3, 4, 4, 4, 3];
export const ECLECTIC_INDEXES = [9, 1, 2, 12, 10, 4, 7, 6, 11, 5, 8, 3];
const fail = message => { throw new Error(message); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const activeRounds = state => cumulativeSingles(state).rounds;
const normalized = value => String(value).replace(/\s+/g, ' ').trim();
const filename = path => path.split(/[\\/]/).at(-1);

export async function sha256(source) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function eclecticFingerprint(state) {
  // Include original names and supplied handicaps as well as resolved identities, not team scoring rules.
  return sha256(JSON.stringify({
    teams: state.teams.map(team => ({ name: team.name, players: team.players })),
    bindings: state.identityBindings || [],
    rounds: [...state.rounds].sort((a, b) => a.date.localeCompare(b.date)).map(round => ({
      date: round.date, qualifying: round.qualifying, canceled: round.canceled,
      cards: round.qualifying && !round.canceled ? round.cards.map(card => ({
        key: playerKey(card.player, state.identityBindings), player: card.player,
        score: card.score, handicap: card.handicap ?? null
      })).sort((a, b) => a.key.localeCompare(b.key)) : []
    }))
  }));
}

function playedDate(value) {
  const match = value.match(/\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b/);
  if (!match) fail('Missing exact played-on date in scorecard metadata.');
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(match[2]) + 1;
  const date = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  weekendDate(date);
  return date;
}
function stroke(value) {
  if (/^[1-9]\d*$/.test(value)) return Number(value);
  if (['', '-', 'PU', 'NP', 'NR', 'N/R'].includes(value.toUpperCase())) return null;
  fail(`Invalid gross hole value "${value}".`);
}
const totalToken = value => value.toUpperCase().replace('/', '');

export function parseGrossScorecards(source) {
  const rows = parseCSV(source);
  const metadata = rows.filter(row => /hole by hole scores returned/i.test(row.join(' ')));
  if (metadata.length !== 1) fail('Expected one Competition Scorecards played-on heading.');
  const date = playedDate(metadata[0].join(' '));
  if (date !== weekendDate(date) && new Date(`${date}T12:00:00Z`).getUTCDay() !== 0)
    fail('Scorecards must be played on Saturday or Sunday.');
  const summaryHead = rows.findIndex(row => row[0] === 'Player(s)');
  const firstBlock = rows.findIndex(row => row[0] === 'Competition Scorecard');
  if (summaryHead < 0 || firstBlock <= summaryHead ||
      !same(rows[summaryHead].slice(2, 20), Array.from({ length: 18 }, (_, i) => String(i + 1))))
    fail('Expected the exact 18-hole scorecard summary header.');
  const summaries = new Map();
  for (const row of rows.slice(summaryHead + 1, firstBlock)) {
    if (row.length !== 22 || !row[0]) fail('Malformed scorecard summary row.');
    const key = canonical(row[0]);
    if (summaries.has(key)) fail(`Duplicate summary card for ${row[0]}.`);
    summaries.set(key, { gross: ECLECTIC_HOLES.map(hole => stroke(row[hole + 1])), total: totalToken(row[20]) });
    for (let hole = 1; hole <= 18; hole++)
      if (!ECLECTIC_HOLES.includes(hole) && stroke(row[hole + 1]) !== null)
        fail(`Unexpected played hole ${hole} for ${row[0]}.`);
  }
  const cards = [], seen = new Set();
  for (let start = firstBlock; start < rows.length;) {
    let end = start + 1;
    while (end < rows.length && rows[end][0] !== 'Competition Scorecard') end++;
    const block = rows.slice(start + 1, end);
    const players = block.filter(row => /^Player [A-Z]:$/.test(row[1] || ''));
    const dates = block.filter(row => row[1] === 'Date:');
    const headers = block.filter(row => row[1] === 'Hole');
    const totals = block.filter(row => row[1] === 'TOTAL');
    if (players.length !== 1 || players[0][1] !== 'Player A:' || !players[0][2] ||
        dates.length !== 1 || playedDate(dates[0][2]) !== date ||
        headers.length !== 1 || !same(headers[0].map(normalized), ['', 'Hole', 'Par', 'S.I.', 'A Strokes', 'Points']) ||
        totals.length !== 1) fail('Invalid player, date, stroke header or total in scorecard block.');
    const player = players[0][2], key = canonical(player);
    if (seen.has(key)) fail(`Duplicate detailed scorecard for ${player}.`);
    seen.add(key);
    const holes = block.filter(row => /^\d+$/.test(row[1] || ''));
    if (holes.length !== 12 || !same(holes.map(row => Number(row[1])), ECLECTIC_HOLES) ||
        !same(holes.map(row => Number(row[2])), ECLECTIC_PARS) ||
        !same(holes.map(row => Number(row[3])), ECLECTIC_INDEXES))
      fail(`Invalid 12-hole structure, pars or stroke indexes for ${player}.`);
    const gross = holes.map(row => stroke(row[4]));
    if (holes.some(row => row.length !== 6 || !/^\d+$/.test(row[5]))) fail(`Invalid points row for ${player}.`);
    const points = holes.map(row => Number(row[5]));
    const total = totals[0];
    if (Number(total[2]) !== 48 || !/^\d+$/.test(total[5]) ||
        points.reduce((sum, value) => sum + value, 0) !== Number(total[5]))
      fail(`Invalid points or par total for ${player}.`);
    const summary = summaries.get(key);
    const emptyTotal = gross.every(value => value === null) && summary?.total === '0' && total[4] === '';
    if (!summary || !same(summary.gross, gross) || summary.total !== totalToken(total[4]) && !emptyTotal)
      fail(`Summary and detailed gross scorecard disagree for ${player}.`);
    if (/^\d+$/.test(total[4]) && (gross.some(value => value === null) ? Number(total[4]) !== 0 :
      gross.reduce((sum, value) => sum + value, 0) !== Number(total[4])))
      fail(`Gross total disagrees with recorded holes for ${player}.`);
    cards.push({ player, gross, points, score: Number(total[5]), date });
    start = end;
  }
  if (!cards.length || cards.length !== summaries.size) fail('Missing summary or detailed scorecards.');
  return { date, cards };
}

export function allocatedStrokes(handicap, index) {
  if (!Number.isInteger(handicap) || Math.abs(handicap) > 100 || !Number.isInteger(index) || index < 1 || index > 12)
    fail('Net eclectic requires an exact integer playing handicap and 12-hole stroke index.');
  if (handicap >= 0) return Math.floor(handicap / 12) + Number(index <= handicap % 12);
  const plus = -handicap;
  return -(Math.floor(plus / 12) + Number(index > 12 - plus % 12)) || 0;
}

export async function buildEclectic(state, grossFiles, netFiles) {
  const rounds = activeRounds(state), pool = cumulativeSingles(state).rows;
  if (!rounds.length || !pool.length) fail('No accepted active qualifying cards for an eclectic.');
  const key = player => playerKey(player, state.identityBindings);
  const days = new Map(), reports = new Map();
  for (const file of grossFiles) {
    try {
      const parsed = parseGrossScorecards(file.source), weekend = weekendDate(parsed.date);
      if (!rounds.some(round => round.date === weekend)) fail('Scorecards do not match an active published weekend.');
      if (!days.has(weekend)) days.set(weekend, []);
      if (days.get(weekend).some(day => day.date === parsed.date)) fail('Duplicate scorecard day; supply one authoritative file per day.');
      days.get(weekend).push({ ...parsed, file: filename(file.path), sha256: await sha256(file.source) });
    } catch (error) { fail(`${file.path}: ${error.message}`); }
  }
  for (const file of netFiles) {
    try {
      const parsed = parseScores(file.source);
      if (!parsed.playedOn) fail('Net report lacks played-on metadata.');
      const date = weekendDate(parsed.playedOn);
      if (!rounds.some(round => round.date === date) || reports.has(date)) fail('Unexpected or duplicate net report weekend.');
      const cards = new Map();
      for (const card of parsed.cards) {
        if (cards.has(key(card.player))) fail(`Duplicate confirmed net identity for ${card.player}.`);
        cards.set(key(card.player), card);
      }
      reports.set(date, { cards, file: filename(file.path), sha256: await sha256(file.source) });
    } catch (error) { fail(`${file.path}: ${error.message}`); }
  }
  const players = new Map(pool.map(row => [row.key, {
    key: row.key, gross: ECLECTIC_HOLES.map(() => null), net: ECLECTIC_HOLES.map(() => null)
  }]));
  const coverage = [];
  for (const round of rounds) {
    const sources = days.get(round.date), report = reports.get(round.date);
    if (sources?.length !== 2 || !sources.some(day => day.date === round.date) || !report)
      fail(`${round.date}: supply both days' gross scorecards and the authoritative net report.`);
    const raw = new Map(), acceptedByDay = new Map(sources.map(day => [day.date, 0]));
    for (const day of sources) for (const card of day.cards) {
      if (raw.has(key(card.player))) fail(`${round.date}: duplicate confirmed scorecard for ${card.player}.`);
      raw.set(key(card.player), card);
    }
    for (const accepted of round.cards) {
      const identity = key(accepted.player), card = raw.get(identity), net = report.cards.get(identity);
      if (!card || !net) fail(`${round.date}: missing source card or playing handicap for ${accepted.player}.`);
      if (card.score !== accepted.score || net.score !== accepted.score ||
          accepted.handicap !== undefined && accepted.handicap !== net.handicap)
        fail(`${round.date}: published card and authoritative sources disagree for ${accepted.player}.`);
      const values = card.gross.map((gross, i) => {
        const allocated = allocatedStrokes(net.handicap, ECLECTIC_INDEXES[i]);
        if (gross === null) {
          if (card.points[i] !== 0) fail(`${accepted.player}: missing gross hole has positive points.`);
          return null;
        }
        const value = gross - allocated;
        if (Math.max(0, ECLECTIC_PARS[i] + 2 - value) !== card.points[i])
          fail(`${round.date}: playing handicap allocation disagrees with hole ${ECLECTIC_HOLES[i]} points for ${accepted.player}.`);
        return value;
      });
      const row = players.get(identity);
      if (!row.latestPlayingHandicap || card.date > row.latestPlayingHandicap.date)
        row.latestPlayingHandicap = { value: net.handicap, date: card.date };
      for (const [field, scores] of [['gross', card.gross], ['net', values]])
        scores.forEach((value, i) => {
          if (value !== null && (row[field][i] === null || value < row[field][i])) row[field][i] = value;
        });
      acceptedByDay.set(card.date, acceptedByDay.get(card.date) + 1);
    }
    coverage.push({
      date: round.date, acceptedCards: round.cards.length,
      days: sources.sort((a, b) => a.date.localeCompare(b.date)).map(day => ({
        date: day.date, file: day.file, sha256: day.sha256, rawCards: day.cards.length, acceptedCards: acceptedByDay.get(day.date)
      })),
      netReport: { file: report.file, sha256: report.sha256 }
    });
  }
  return {
    version: 1, sourceFingerprint: await eclecticFingerprint(state),
    holes: [...ECLECTIC_HOLES], pars: [...ECLECTIC_PARS],
    acceptedCards: rounds.reduce((sum, round) => sum + round.cards.length, 0),
    coverage, players: [...players.values()].sort((a, b) => a.key.localeCompare(b.key))
  };
}

export function validateEclectic(data, state, fingerprint) {
  if (!data || data.version !== 1 || !/^[a-f0-9]{64}$/.test(data.sourceFingerprint || '') ||
      data.sourceFingerprint !== fingerprint) fail('Eclectic data does not match the current published cards, roster and bindings. Owner refresh required.');
  const rounds = activeRounds(state), pool = cumulativeSingles(state).rows;
  if (!same(data.holes, ECLECTIC_HOLES) || !same(data.pars, ECLECTIC_PARS) ||
      !Array.isArray(data.coverage) || data.coverage.length !== rounds.length ||
      data.acceptedCards !== rounds.reduce((sum, round) => sum + round.cards.length, 0))
    fail('Invalid eclectic holes or accepted round coverage.');
  data.coverage.forEach((entry, i) => {
    const round = rounds[i];
    if (entry.date !== round.date || entry.acceptedCards !== round.cards.length ||
        !Array.isArray(entry.days) || entry.days.length !== 2 ||
        entry.days[0].date !== round.date ||
        entry.days[1].date !== new Date(Date.parse(`${round.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10) ||
        entry.days.reduce((sum, day) => sum + day.acceptedCards, 0) !== entry.acceptedCards ||
        [...entry.days, entry.netReport].some(source => !source || !/^[a-f0-9]{64}$/.test(source.sha256) ||
          typeof source.file !== 'string' || !source.file || /[\\/:]/.test(source.file)) ||
        entry.days.some(day => !Number.isInteger(day.acceptedCards) || day.acceptedCards < 0 ||
          !Number.isInteger(day.rawCards) || day.rawCards < day.acceptedCards))
      fail('Invalid eclectic source coverage.');
  });
  if (!Array.isArray(data.players) || data.players.length !== pool.length ||
      new Set(data.players.map(row => row.key)).size !== pool.length) fail('Invalid eclectic player pool.');
  const keys = new Set(pool.map(row => row.key));
  const latestCards = new Map();
  for (const round of rounds) for (const card of round.cards)
    latestCards.set(playerKey(card.player, state.identityBindings), { card, date: round.date });
  for (const row of data.players) {
    if (!keys.has(row.key)) fail('Unknown eclectic identity.');
    for (const field of ['gross', 'net'])
      if (!Array.isArray(row[field]) || row[field].length !== 12 ||
          row[field].some(value => value !== null && (!Number.isInteger(value) || value < (field === 'gross' ? 1 : -100) || value > 1000)))
        fail('Invalid eclectic hole values.');
    if (row.gross.some((value, i) => (value === null) !== (row.net[i] === null))) fail('Gross and net missing holes disagree.');
    if (row.latestPlayingHandicap !== undefined) {
      const latest = row.latestPlayingHandicap, accepted = latestCards.get(row.key);
      const sunday = new Date(Date.parse(`${accepted.date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
      if (!latest || typeof latest !== 'object' || Array.isArray(latest) ||
          Object.keys(latest).some(key => !['value', 'date'].includes(key)) ||
          !Number.isInteger(latest.value) || Math.abs(latest.value) > 100 ||
          ![accepted.date, sunday].includes(latest.date) ||
          accepted.card.handicap !== undefined && latest.value !== accepted.card.handicap)
        fail('Invalid latest accepted playing handicap metadata.');
    }
  }
  return data;
}

export function playingHandicapLabel(value) {
  if (value === undefined) return 'Hcap unavailable';
  return value < 0 ? `+${Math.abs(value)}` : String(value);
}

export function eclecticStandings(state, data, field) {
  if (!['gross', 'net'].includes(field)) fail('Unknown eclectic view.');
  const names = new Map(cumulativeSingles(state).rows.map(row => [row.key, row.player]));
  const rows = data.players.map(row => {
    const values = row[field], complete = values.every(value => value !== null);
    return { key: row.key, player: names.get(row.key), holes: [...values],
      total: complete ? values.reduce((sum, value) => sum + value, 0) : null, rank: null };
  }).sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity) || a.player.localeCompare(b.player));
  rows.forEach((row, index) => {
    if (row.total !== null) row.rank = index && rows[index - 1].total === row.total ? rows[index - 1].rank : index + 1;
  });
  return { rows, complete: rows.filter(row => row.total !== null).length, incomplete: rows.filter(row => row.total === null).length };
}

export const ECLECTIC_CATEGORIES = [
  { key: 'eagle', label: 'Eagle+ (2 under or better)' },
  { key: 'birdie', label: 'Birdie (1 under)' },
  { key: 'par', label: 'Par' },
  { key: 'bogey', label: 'Bogey (1 over)' },
  { key: 'double', label: 'Double bogey (2 over)' },
  { key: 'worse', label: '3 over or worse' }
];

export function eclecticCategory(score, par) {
  if (score === null || score === undefined) return null;
  const diff = score - par;
  return diff <= -2 ? 'eagle' : diff === -1 ? 'birdie' : diff === 0 ? 'par'
    : diff === 1 ? 'bogey' : diff === 2 ? 'double' : 'worse';
}

export function eclecticSubtotal(scores) {
  return scores.some(score => score === null || score === undefined)
    ? null : scores.reduce((sum, score) => sum + score, 0);
}

export function eclecticDisplayRows(state, data, field) {
  const rounds = new Map(cumulativeSingles(state).rows.map(row => [row.key, Object.keys(row.scores).length]));
  return eclecticStandings(state, data, field).rows.map(row => ({
    ...row, rounds: rounds.get(row.key), out: eclecticSubtotal(row.holes.slice(0, 9)),
    in: eclecticSubtotal(row.holes.slice(9))
  }));
}

export function eclecticInsights(state, data, field) {
  const rows = eclecticDisplayRows(state, data, field), complete = rows.filter(row => row.total !== null);
  const counts = () => Object.fromEntries(ECLECTIC_CATEGORIES.map(category => [category.key, 0]));
  const categories = counts();
  const holes = ECLECTIC_HOLES.map((hole, index) => {
    const scores = rows.filter(row => row.holes[index] !== null && row.holes[index] !== undefined);
    const distribution = counts();
    let sum = 0;
    for (const row of scores) {
      const score = row.holes[index];
      sum += score;
      const category = eclecticCategory(score, ECLECTIC_PARS[index]);
      distribution[category]++;
      categories[category]++;
    }
    const best = scores.length ? Math.min(...scores.map(row => row.holes[index])) : null;
    const average = scores.length ? sum / scores.length : null;
    return {
      hole, par: ECLECTIC_PARS[index], index: ECLECTIC_INDEXES[index], count: scores.length,
      average, averageToPar: average === null ? null : average - ECLECTIC_PARS[index],
      categories: distribution, best,
      bestPlayers: scores.filter(row => row.holes[index] === best).map(row => row.player),
      parOrBetter: scores.length ? (distribution.eagle + distribution.birdie + distribution.par) / scores.length * 100 : null
    };
  });
  const awards = rows.map(row => {
    const distribution = counts(), missing = [];
    row.holes.forEach((score, i) => {
      const category = eclecticCategory(score, ECLECTIC_PARS[i]);
      if (category === null) missing.push(ECLECTIC_HOLES[i]);
      else distribution[category]++;
    });
    const recorded = 12 - missing.length;
    return { ...row, categories: distribution, missing, recorded,
      parRate: recorded ? distribution.par / recorded * 100 : null };
  });
  const byCategory = category => [...awards].sort((a, b) =>
    b.categories[category] - a.categories[category] || a.player.localeCompare(b.player));
  const byDifficulty = holes.filter(hole => hole.count).sort((a, b) =>
    b.averageToPar - a.averageToPar || a.hole - b.hole);
  const groupRecord = group => {
    if (!complete.length) return { score: null, players: [] };
    const score = Math.min(...complete.map(row => row[group]));
    return { score, players: complete.filter(row => row[group] === score).map(row => row.player) };
  };
  return {
    players: rows.length, complete: complete.length, incomplete: rows.length - complete.length,
    recorded: holes.reduce((sum, hole) => sum + hole.count, 0), categories, holes, awards,
    best: complete[0]?.total ?? null, leaders: complete.filter(row => row.rank === 1).map(row => row.player),
    averageTotal: complete.length ? complete.reduce((sum, row) => sum + row.total, 0) / complete.length : null,
    hardest: byDifficulty.slice(0, 3),
    easiest: [...byDifficulty].sort((a, b) => a.averageToPar - b.averageToPar || a.hole - b.hole).slice(0, 3),
    mostBirdies: byCategory('birdie').slice(0, 5), mostPars: byCategory('par').slice(0, 5),
    eaglePlayers: byCategory('eagle').filter(row => row.categories.eagle > 0),
    oneToGo: awards.filter(row => row.missing.length === 1),
    threeUnder: rows.flatMap(row => row.holes.flatMap((score, i) =>
      score !== null && score !== undefined && score - ECLECTIC_PARS[i] <= -3
        ? [{ player: row.player, hole: ECLECTIC_HOLES[i], par: ECLECTIC_PARS[i], score, relativeToPar: score - ECLECTIC_PARS[i] }] : [])),
    outRecord: groupRecord('out'), inRecord: groupRecord('in'),
    composite: holes.map(hole => hole.best), compositeTotal: eclecticSubtotal(holes.map(hole => hole.best))
  };
}
