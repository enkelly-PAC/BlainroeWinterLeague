import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyState } from '../core.js';
import { STORAGE_KEY } from '../storage.js';

let instance = 0;
async function workspace(t, source = null, published = emptyState()) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const nodes = new Map();
  class Node {
    constructor() {
      this.value = ''; this.textContent = ''; this.files = []; this.hidden = false;
      this.checked = false; this.children = []; this.listeners = new Map();
      this.classList = { toggle() {} };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    focus() { document.activeElement = this; }
    addEventListener(event, listener) { this.listeners.set(event, listener); }
    async emit(event) { await this.listeners.get(event)?.({ preventDefault() {} }); }
  }
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) nodes.set(match[1], new Node());
  nodes.get('import-type').value = 'scores';
  const values = new Map(source === null ? [] : [[STORAGE_KEY, source]]);
  const original = Object.fromEntries(['document', 'window', 'fetch', 'confirm'].map(key => [key, globalThis[key]]));
  globalThis.document = {
    getElementById: id => nodes.get(id), createElement: () => new Node(), querySelectorAll: () => []
  };
  globalThis.window = { localStorage: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)
  } };
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(published) });
  globalThis.confirm = () => true;
  t.after(() => { for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  } });
  await import(`../app.js?test=${++instance}`);
  await new Promise(resolve => setImmediate(resolve));
  const $ = id => nodes.get(id);
  async function preview(content = 'Played on,08/11/2026\nPlayer,Score\nSynthetic Player,29') {
    $('import-files').files = [{ name: 'synthetic-results.csv', size: content.length, text: async () => content }];
    await $('import-files').emit('change');
  }
  return { $, values, preview };
}
test('published roster is opt-in for older saved drafts and keeps existing scores and settings', async t => {
  const published = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const state = emptyState(); state.settings.maxRounds = 12;
  state.rounds = [{ date: '2026-10-31', name: 'Saved scores', qualifying: false, canceled: false,
    cards: [{ player: 'Paddy Daly', score: 25 }] }];
  const source = JSON.stringify(state);
  const { $, values } = await workspace(t, source, published);
  assert.equal(values.get(STORAGE_KEY), source);
  assert.equal($('view-label').textContent, 'Published club results');
  globalThis.confirm = () => false;
  await $('use-published-roster').emit('click');
  assert.equal(values.get(STORAGE_KEY), source);
  globalThis.confirm = () => true;
  await $('use-published-roster').emit('click');
  const saved = JSON.parse(values.get(STORAGE_KEY));
  assert.deepEqual(saved.teams, published.teams);
  assert.deepEqual(saved.rounds, state.rounds);
  assert.deepEqual(saved.settings, state.settings);
  $('roster-select').value = 'Team 34';
  await $('roster-select').emit('change');
  assert.equal($('roster-name').readOnly, true);
  assert.equal($('roster-player3').value, '');
  await $('roster-form').emit('submit');
  assert.equal(JSON.parse(values.get(STORAGE_KEY)).teams.find(t => t.name === 'Team 34').players.length, 2);
  await $('published-view').emit('click');
  assert.equal($('view-label').textContent, 'Published club results');
  assert.match($('roster-warning').textContent, /Eugene McCrystal .*eligibility pending/);
});
test('editor saves changes and new teams without touching raw cards; duplicate and incomplete saves are atomic', async t => {
  const state = emptyState();
  state.teams = [{ name: 'Team 2', players: ['Synthetic One', 'Synthetic Two', 'Synthetic Three'] }];
  state.rounds = [{ date: '2026-10-31', name: 'Saved scores', qualifying: true, canceled: false,
    cards: [{ player: 'Synthetic One', score: 25 }] }];
  const { $, values } = await workspace(t, JSON.stringify(state));
  $('roster-select').value = 'Team 2'; await $('roster-select').emit('change');
  $('roster-player1').value = 'One, Synthetic';
  $('roster-notes').value = 'Synthetic pending committee review';
  await $('roster-form').emit('submit');
  let saved = JSON.parse(values.get(STORAGE_KEY));
  assert.equal(saved.teams[0].players[0], 'One, Synthetic');
  assert.equal(saved.teams[0].notes, 'Synthetic pending committee review');
  assert.deepEqual(saved.rounds, state.rounds);
  $('roster-select').value = ''; await $('roster-select').emit('change');
  assert.equal($('roster-name').readOnly, false);
  $('roster-name').value = 'Team 47'; $('roster-player1').value = 'Synthetic Four'; $('roster-player2').value = 'Synthetic Five';
  const before = values.get(STORAGE_KEY);
  await $('roster-form').emit('submit');
  assert.equal(values.get(STORAGE_KEY), before);
  assert.match($('status').textContent, /three named players/);
  $('roster-player3').value = 'SYNTHETIC TWO';
  await $('roster-form').emit('submit');
  assert.equal(values.get(STORAGE_KEY), before);
  assert.match($('status').textContent, /duplicate/);
  $('roster-player3').value = 'Synthetic Six';
  await $('roster-form').emit('submit');
  saved = JSON.parse(values.get(STORAGE_KEY));
  assert.equal(saved.teams.length, 2);
  assert.deepEqual(saved.rounds, state.rounds);
  assert.equal($('roster-select').value, 'Team 47');
});

test('results preview is read-only; only a valid explicit apply starts a saved draft', async t => {
  const { $, values, preview } = await workspace(t);
  assert.equal($('apply-import').disabled, true);
  await preview();
  assert.equal($('preview').hidden, false);
  assert.equal($('weekend-date').value, '2026-11-07');
  assert.equal(values.has(STORAGE_KEY), false);
  await $('apply-form').emit('submit');
  assert.equal(values.has(STORAGE_KEY), false);
  $('net-confirm').checked = true;
  $('round-name').value = 'Synthetic weekend';
  await $('net-confirm').emit('change');
  assert.equal($('apply-import').disabled, false);
  await $('apply-form').emit('submit');
  const saved = JSON.parse(values.get(STORAGE_KEY));
  assert.equal(saved.rounds.length, 1);
  assert.equal(saved.rounds[0].date, '2026-11-07');
  assert.equal(saved.rounds[0].cards[0].score, 29);
  assert.equal($('view-label').textContent, 'Browser-only draft results');
  await $('published-view').emit('click');
  assert.equal($('league-summary').textContent.includes('0 registered teams'), true);
  assert.equal(values.get(STORAGE_KEY), JSON.stringify(saved));
});

test('applying results resumes the saved draft; team switch and confirmation retain cards', async t => {
  const state = emptyState();
  state.settings.maxRounds = 12;
  state.rounds = [{ date: '2026-10-31', name: 'Earlier synthetic weekend', qualifying: false, canceled: false,
    cards: [{ player: 'Earlier Synthetic', score: 20 }] }];
  const original = JSON.stringify(state);
  const { $, values, preview } = await workspace(t, original);
  await preview();
  assert.equal(values.get(STORAGE_KEY), original);
  $('net-confirm').checked = true; $('round-name').value = 'Synthetic weekend';
  await $('apply-form').emit('submit');
  const saved = JSON.parse(values.get(STORAGE_KEY));
  assert.deepEqual(saved.rounds[0], state.rounds[0]);
  assert.equal(saved.rounds.length, 2);
  assert.equal(saved.settings.maxRounds, 12);
  await $('teams-import').emit('click');
  assert.equal($('import-files').multiple, false);
  assert.equal($('import-file-label').textContent, 'Choose team registration CSV');
  await preview('Team,Player1,Player2,Player3\nSynthetic Team,Synthetic Player,Synthetic Two,Synthetic Three');
  const beforeTeams = values.get(STORAGE_KEY);
  globalThis.confirm = () => false;
  await $('apply-form').emit('submit');
  assert.equal(values.get(STORAGE_KEY), beforeTeams);
  globalThis.confirm = () => true;
  await $('apply-form').emit('submit');
  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)).rounds, saved.rounds);
  assert.equal(JSON.parse(values.get(STORAGE_KEY)).teams[0].name, 'Synthetic Team');
});

test('switching type or files invalidates pending and in-flight previews and updates controls', async t => {
  const { $, values, preview } = await workspace(t);
  await preview();
  await $('cancel-preview').emit('click');
  assert.equal(document.activeElement, $('import-files'));
  await preview();
  $('import-type').value = 'restore';
  await $('import-type').emit('change');
  assert.equal($('preview').hidden, true);
  assert.equal($('import-files').accept, '.json,application/json');
  assert.equal($('apply-import').textContent, 'Replace my draft with this JSON');
  await $('apply-form').emit('submit');
  assert.equal(values.has(STORAGE_KEY), false);
  await $('results-import').emit('click');
  let finish;
  $('import-files').files = [{ name: 'slow.csv', size: 40, text: () => new Promise(resolve => { finish = resolve; }) }];
  const reading = $('import-form').emit('submit');
  await $('teams-import').emit('click');
  finish('Player,Score\nSynthetic Player,29');
  await reading;
  assert.equal($('preview').hidden, true);
  assert.equal($('import-heading').textContent, 'Upload team registration CSV');
  await $('results-import').emit('click');
  await preview();
  $('import-files').files = [];
  await $('import-files').emit('change');
  await $('apply-form').emit('submit');
  assert.equal($('preview').hidden, true);
  assert.equal(values.has(STORAGE_KEY), false);
});

const grossScorecards = 'Competition Scorecards\nHole by Hole scores returned\nPlayer(s),,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,Total,Page\nSynthetic Player,,5,PU,-,NR';
const netReport = [
  'Competition Result',
  '"Aggregate result of the Competition played on Saturday 31 October 2026 and Sunday 1 November 2026 at Synthetic Club."',
  'Aggregated Results - Net Scores',
  '"Overall Position","","","Score (Play H\'cap)","","","Countback"',
  '"1","Synthetic Alpha","","29 pts (07)"',
  '"2","Synthetic Beta","","24 pts (-01)"',
  '"3","Synthetic Gamma","","0 pts (+03)"',
  '"-","Synthetic NoReturn","","No Return"',
  '"-","Synthetic DQ1","","21 pts (12)","","DQ: Rule 3.3b(2)"',
  '"-","Synthetic DQ2","","12 pts (10)","","DQ: Rule 3.3b(2)"',
  'Number of Cards Processed = 6'
].join('\r\n');

test('choosing a mixed batch automatically previews only net cards and explicitly identifies gross scorecards', async t => {
  const { $, values } = await workspace(t);
  $('import-files').files = [netReport, grossScorecards, grossScorecards].map((content, index) => ({
    name: `synthetic-${index}.csv`, size: content.length, text: async () => content
  }));
  await $('import-files').emit('change');
  assert.equal($('preview').hidden, false);
  assert.equal($('apply-import').disabled, true);
  assert.equal($('weekend-date').value, '2026-10-31');
  assert.match($('recognized-scorecards').textContent, /2 recognized scorecard file/);
  assert.match($('recognized-scorecards').textContent, /synthetic-1.csv, synthetic-2.csv/);
  assert.match($('import-status').textContent, /3 valid net cards/);
  assert.match($('import-status').textContent, /1 no return\/withdrawn; 2 disqualified/);
  assert.equal(values.has(STORAGE_KEY), false);
  $('round-name').value = 'Synthetic round 1'; $('net-confirm').checked = true;
  await $('round-name').emit('input');
  assert.equal($('apply-import').disabled, false);
  await $('apply-form').emit('submit');
  const saved = JSON.parse(values.get(STORAGE_KEY));
  assert.equal(saved.rounds.length, 1);
  assert.deepEqual(saved.rounds[0].cards.map(card => card.score), [29, 24, 0]);
  assert.match($('import-status').textContent, /Net results saved/);
  assert.match($('recognized-scorecards').textContent, /No scorecard data is stored/);
});

test('only gross or good plus malformed results produce nearby actionable errors and cannot save', async t => {
  const { $, values } = await workspace(t);
  $('import-files').files = [{ name: 'synthetic-gross.csv', size: grossScorecards.length, text: async () => grossScorecards }];
  await $('import-files').emit('change');
  assert.equal($('preview').hidden, true);
  assert.equal($('apply-import').disabled, true);
  assert.match($('import-status').textContent, /Only gross scorecards.*Add Competition Report/);
  assert.equal(document.activeElement, $('import-status'));
  $('import-files').files = [
    { name: 'synthetic-good.csv', size: netReport.length, text: async () => netReport },
    { name: 'synthetic-bad.csv', size: 30, text: async () => 'Player,Score\nSynthetic Broken,strokes' }
  ];
  await $('import-files').emit('change');
  assert.match($('import-status').textContent, /synthetic-bad.csv: Invalid Stableford score/);
  assert.equal($('preview').hidden, true);
  assert.equal($('apply-import').disabled, true);
  assert.equal(values.has(STORAGE_KEY), false);
});

test('a newer file selection owns automatic preview even when an older asynchronous read finishes later', async t => {
  const { $, values, preview } = await workspace(t);
  let finish;
  $('import-files').files = [{ name: 'synthetic-slow.csv', size: 30, text: () => new Promise(resolve => { finish = resolve; }) }];
  const older = $('import-files').emit('change');
  assert.match($('import-status').textContent, /Reading 1 selected file/);
  await preview('Played on,15/11/2026\nPlayer,Score\nSynthetic New,0');
  finish(netReport);
  await older;
  assert.equal($('weekend-date').value, '2026-11-14');
  assert.match($('preview-summary').textContent, /synthetic-results.csv/);
  assert.equal($('apply-import').disabled, true);
  assert.equal(values.has(STORAGE_KEY), false);
});

test('corrupt storage survives results preview and failed apply; JSON replacement requires confirmation', async t => {
  const corrupt = '{ unreadable draft';
  const { $, values, preview } = await workspace(t, corrupt);
  await preview();
  assert.equal($('preview').hidden, false);
  $('net-confirm').checked = true; $('round-name').value = 'Synthetic weekend';
  await $('apply-form').emit('submit');
  assert.equal(values.get(STORAGE_KEY), corrupt);
  assert.match($('status').textContent, /Unreadable draft preserved/);
  $('import-type').value = 'restore';
  await $('import-type').emit('change');
  await preview(JSON.stringify(emptyState()));
  globalThis.confirm = () => false;
  await $('apply-form').emit('submit');
  assert.equal(values.get(STORAGE_KEY), corrupt);
  globalThis.confirm = () => true;
  await $('apply-form').emit('submit');
  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)), emptyState());
});
