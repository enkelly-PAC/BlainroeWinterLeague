import { ECLECTIC_HOLES, ECLECTIC_PARS, ECLECTIC_INDEXES } from '../eclectic.js';

const csv = rows => rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
const naturalDate = date => new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
}).format(new Date(`${date}T12:00:00Z`));

export function sourceCard(player, gross = [...ECLECTIC_PARS], net = gross, handicap = 0) {
  const points = gross.map((value, i) => value === null ? 0 : Math.max(0, ECLECTIC_PARS[i] + 2 - net[i]));
  return { player, gross, points, score: points.reduce((sum, value) => sum + value, 0), handicap };
}

export function grossCSV(date, cards) {
  return csv([
    ['Blainroe Golf Club'], ['Competition Scorecards'],
    [`Hole by Hole scores returned in the synthetic competition round played on ${naturalDate(date)} at Blainroe`],
    ['Summary of Scores returned'],
    ['Player(s)', '', ...Array.from({ length: 18 }, (_, i) => i + 1), 'Total', 'Page'],
    ...cards.map(card => [card.player, '', ...Array.from({ length: 18 }, (_, i) => {
      const index = ECLECTIC_HOLES.indexOf(i + 1);
      return index < 0 ? '-' : card.gross[index] ?? 'PU';
    }), card.gross.includes(null) ? 'NR' : card.gross.reduce((sum, value) => sum + value, 0), '']),
    ...cards.flatMap(card => [
      ['Competition Scorecard'], ['', 'Competition:', 'Synthetic round'],
      ['', 'Date:', naturalDate(date)], ['', 'Venue:', 'Blainroe'],
      ['', 'Player A:', card.player], ['', 'Hole', 'Par', 'S.I.', 'A\r\nStrokes', 'Points'],
      ...ECLECTIC_HOLES.map((hole, i) => ['', hole, ECLECTIC_PARS[i], ECLECTIC_INDEXES[i], card.gross[i] ?? 'PU', card.points[i]]),
      ['', 'TOTAL', 48, '', card.gross.includes(null) ? 'N/R' : card.gross.reduce((sum, value) => sum + value, 0), card.score]
    ])
  ]);
}

export function weekendFixture(date, saturday, sunday, excluded = []) {
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const accepted = [...saturday, ...sunday].filter(card => !excluded.includes(card.player));
  return {
    round: { date, name: 'Synthetic weekend', qualifying: true, canceled: false,
      cards: accepted.map(({ player, score, handicap }) => ({ player, score, handicap })) },
    gross: [{ path: `${date}-Saturday.csv`, source: grossCSV(date, saturday) },
      { path: `${date}-Sunday.csv`, source: grossCSV(next, sunday) }],
    net: { path: `${date}-Net.csv`, source: csv([
      [`Played on ${naturalDate(date)}`], ['Player', 'Score', 'Handicap'],
      ...accepted.map(card => [card.player, card.score, card.handicap])
    ]) }
  };
}
