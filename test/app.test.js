import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { emptyState, league } from '../core.js';
import { STORAGE_KEY, BASELINE_KEY } from '../storage.js';

async function rosterFixture() {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  state.rounds = [];
  // Retain the superseded duplicate roster for tests of held-card safeguards.
  state.teams.find(team => team.name === 'Team 10').players[0] = 'Colin Owens';
  for (const team of state.teams.filter(team => ['Team 10', 'Team 37'].includes(team.name)))
    team.heldPlayers = ['Colin Owens'];
  return state;
}

let instance = 0;
async function workspace(t, source = null, published = emptyState(), baseline = null, lastModified = null) {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const nodes = new Map();
  const downloads = [];
  class Node {
    constructor(tagName = '') {
      this.tagName = tagName; this.attributes = new Map();
      this.value = ''; this.textContent = ''; this.files = []; this.hidden = false;
      this.checked = false; this.open = false; this.children = []; this.listeners = new Map();
      this.style = {}; this.scrollLeft = 0; this.scrollTop = 0; this.clientWidth = 0; this.scrollWidth = 0;
      this.classList = { toggle() {} };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    querySelectorAll(tagName) {
      return this.children.flatMap(child => [...(child.tagName === tagName ? [child] : []), ...child.querySelectorAll(tagName)]);
    }
    focus() { document.activeElement = this; }
    click() { this.clicked = true; }
    remove() {}
    addEventListener(event, listener) { this.listeners.set(event, listener); }
    removeEventListener(event, listener) { if (this.listeners.get(event) === listener) this.listeners.delete(event); }
    scrollTo(options) {
      this.lastScroll = options;
      this.scrollLeft = Math.max(0, Math.min(this.scrollWidth - this.clientWidth, options.left));
      return this.emit('scroll');
    }
    async emit(event, properties = {}) { await this.listeners.get(event)?.({ preventDefault() {}, target: this, currentTarget: this, ...properties }); }
  }
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const node = new Node(match[1]);
    for (const attribute of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attribute[1], attribute[2]);
    node.hidden = /\bhidden\b/.test(match[2]);
    node.open = /\bopen\b/.test(match[2]);
    nodes.set(match[3], node);
  }
  nodes.get('import-type').value = 'scores';
  const values = new Map(source === null ? [] : [[STORAGE_KEY, source]]);
  if (baseline) values.set(BASELINE_KEY, JSON.stringify({ draft: JSON.parse(source), published: baseline }));
  const original = Object.fromEntries(['document', 'window', 'fetch', 'confirm', 'ResizeObserver'].map(key => [key, globalThis[key]]));
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  };
  globalThis.document = {
    getElementById: id => nodes.get(id), createElement: tagName => new Node(tagName),
    querySelectorAll: selector => selector === '[role="tab"]' ? [...nodes.values()].filter(node => node.getAttribute('role') === 'tab') : [],
    body: { append: node => downloads.push(node) },
    head: { append: node => queueMicrotask(() => node.onload()) }
  };
  const windowListeners = new EventEmitter(), motion = { matches: false };
  globalThis.window = {
    addEventListener: (event, listener) => windowListeners.on(event, listener),
    removeEventListener: (event, listener) => windowListeners.off(event, listener),
    matchMedia: () => motion,
    localStorage: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)
  } };
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(published),
    headers: { get: name => name.toLowerCase() === 'last-modified' ? lastModified : null },
    arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer });
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
  async function reload() {
    await import(`../app.js?test=${++instance}`);
    await new Promise(resolve => setImmediate(resolve));
  }
  const contents = node => [node.textContent, ...node.children.map(contents)].join('\n');
  return { $, values, preview, reload, contents, downloads, observers, motion, windowListeners,
    resize: () => windowListeners.emit('resize'), setPublished: state => { published = state; },
    setLastModified: value => { lastModified = value; } };
}
function renderedTable($, id = 'league-table') {
  const wrapper = $(id).children.find(node => node.className === 'table-wrap'), table = wrapper.children[0];
  const head = table.children[1], body = table.children[2];
  return { wrapper, head, body, buttons: head.querySelectorAll('button'), rows: body.children.map(row => row.children.map(cell => cell.textContent)) };
}
function sortingFixture() {
  const state = emptyState();
  state.teams = [10, 2, 3].map(number => ({ name: `Team ${number}`, players: ['Alpha', 'Beta', 'Gamma'].map(name => `${name} ${number}`) }));
  state.rounds = [{ date: '2026-10-31', name: 'SYNTHETIC first round', qualifying: true, canceled: false,
    cards: [{ player: 'Alpha 10', score: 9, handicap: 9 }, { player: 'Alpha 2', score: 20, handicap: 20 }, { player: 'Alpha 3', score: 0, handicap: 0 },
      { player: 'Beta 10', score: 0 }] }];
  return state;
}
function scrollControls($, id = 'league-table') {
  const controls = $(id).children[0], [actions, track] = controls.children;
  const [left, right] = actions.children, wrapper = renderedTable($, id).wrapper;
  return { controls, track, left, right, wrapper };
}
test('landing page shows the server publication timestamp in Irish winter and summer time, not draft or refresh time', async t => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="last-updated"') < html.indexOf('class="tabs"'));
  assert.match(html, /class="publication-details"><strong id="view-label">[^<]+<\/strong><span id="last-updated"/);
  assert.match(html, /<script type="module" src="\.\/app\.js\?v=[^"]+"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css\?v=[^"]+">/);
  const { $, setLastModified } = await workspace(t, null, emptyState(), null, 'Thu, 12 Nov 2026 13:45:43 GMT');
  assert.equal($('last-updated').hidden, false);
  assert.equal($('last-updated').textContent, 'Last updated: 12 Nov 2026, 13:45 (Irish time)');
  assert.equal($('status').hidden, true);
  setLastModified('Mon, 01 Jun 2026 12:00:00 GMT');
  await $('refresh').emit('click');
  assert.equal($('last-updated').textContent, 'Last updated: 1 Jun 2026, 13:00 (Irish time)');
  assert.equal($('status').hidden, true);
  const updated = $('last-updated').textContent;
  await $('start-draft').emit('click');
  assert.equal($('last-updated').textContent, updated);
  assert.equal($('status').hidden, false);
  globalThis.fetch = async () => { throw new Error('Offline'); };
  await $('refresh').emit('click');
  assert.equal($('last-updated').textContent, updated);
  assert.equal($('status').hidden, false);
  assert.match($('status').textContent, /Offline/);
});
test('missing or invalid server publication timestamps are unavailable rather than an invented current time', async t => {
  const { $, setLastModified } = await workspace(t);
  assert.equal($('last-updated').textContent, 'Last updated: unavailable');
  setLastModified('not a date');
  await $('refresh').emit('click');
  assert.equal($('last-updated').textContent, 'Last updated: unavailable');
});
test('leaderboard scroll buttons, keyboard and both native scrollbars stay synchronised at bounds', async t => {
  const { $, resize, motion } = await workspace(t, null, sortingFixture());
  const { controls, track, left, right, wrapper } = scrollControls($);
  Object.assign(wrapper, { clientWidth: 400, scrollWidth: 1400 });
  resize();
  assert.equal(controls.hidden, false);
  assert.equal(track.children[0].style.width, '1400px');
  assert.equal(left.textContent, 'Scroll left');
  assert.equal(right.textContent, 'Scroll right');
  assert.equal(left.getAttribute('aria-controls'), wrapper.id);
  assert.equal(track.tabIndex, 0);
  assert.equal(left.disabled, true);
  assert.equal(right.disabled, false);
  await right.emit('click');
  assert.equal(wrapper.scrollLeft, 300);
  assert.equal(wrapper.lastScroll.behavior, 'smooth');
  assert.equal(track.scrollLeft, 300);
  assert.equal(left.disabled, false);
  let prevented = false;
  motion.matches = true;
  await track.emit('keydown', { key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(wrapper.scrollLeft, 600);
  assert.equal(wrapper.lastScroll.behavior, 'instant');
  await wrapper.emit('keydown', { key: 'ArrowRight', target: renderedTable($).buttons[0] });
  assert.equal(wrapper.scrollLeft, 600); // Sorting buttons retain their own keyboard behaviour.
  await right.emit('click'); await right.emit('click');
  assert.equal(wrapper.scrollLeft, 1000);
  assert.equal(track.scrollLeft, 1000);
  assert.equal(right.disabled, true);
  await left.emit('click');
  assert.equal(wrapper.scrollLeft, 700);
  track.scrollLeft = 125;
  await track.emit('scroll');
  assert.equal(wrapper.scrollLeft, 125);
  wrapper.scrollLeft = 0;
  await wrapper.emit('scroll');
  assert.equal(track.scrollLeft, 0);
  assert.equal(left.disabled, true);
  await wrapper.emit('keydown', { key: 'ArrowLeft' });
  assert.equal(wrapper.scrollLeft, 0);
});
test('scroll controls refresh on resize, tab reveal and content resize, without touching admin tables', async t => {
  const { $, resize, observers } = await workspace(t, null, sortingFixture());
  const view = scrollControls($), singles = scrollControls($, 'singles-table');
  Object.assign(view.wrapper, { clientWidth: 600, scrollWidth: 600 });
  resize();
  assert.equal(view.controls.hidden, true);
  assert.equal(view.left.disabled, true);
  assert.equal(view.right.disabled, true);
  view.wrapper.scrollWidth = 1600;
  observers.find(observer => observer.targets.includes(view.wrapper)).callback();
  assert.equal(view.controls.hidden, false);
  assert.equal(view.right.disabled, false);
  view.wrapper.clientWidth = 1600;
  resize();
  assert.equal(view.controls.hidden, true);
  assert.equal(singles.controls.hidden, true);
  Object.assign(singles.wrapper, { clientWidth: 320, scrollWidth: 900 });
  await $('tab-singles').emit('click');
  assert.equal(singles.controls.hidden, false);
  assert.equal(singles.track.children[0].style.width, '900px');
  await singles.right.emit('click');
  assert.equal(singles.wrapper.scrollLeft, 240);
  assert.equal(singles.track.scrollLeft, 240);
  assert.equal($('teams-table').children[0].className, 'table-wrap');
});
test('changed tables reset left and release observers and listeners; unchanged renders and sorting preserve position', async t => {
  const state = sortingFixture();
  const { $, resize, observers, windowListeners, setPublished } = await workspace(t, null, state);
  const old = scrollControls($), oldObserver = observers.find(observer => observer.targets.includes(old.wrapper));
  Object.assign(old.wrapper, { clientWidth: 400, scrollWidth: 1400, scrollLeft: 250 });
  resize();
  await $('pdf-format').emit('change');
  assert.equal(renderedTable($).wrapper, old.wrapper);
  assert.equal(old.wrapper.scrollLeft, 250);
  await renderedTable($).buttons[5].emit('click');
  const sorted = scrollControls($);
  assert.equal(sorted.wrapper.scrollLeft, 250);
  assert.equal(sorted.track.scrollLeft, 250);
  assert.equal(document.activeElement, renderedTable($).buttons[5]);
  assert.equal(oldObserver.disconnected, true);
  assert.equal(old.wrapper.listeners.has('scroll'), false);
  assert.equal(old.track.listeners.has('scroll'), false);
  assert.equal(windowListeners.listenerCount('resize'), 2);
  const next = structuredClone(state);
  next.rounds[0].cards[0].score++;
  setPublished(next);
  await $('refresh').emit('click');
  assert.notEqual(renderedTable($).wrapper, sorted.wrapper);
  assert.equal(renderedTable($).wrapper.scrollLeft, 0);
  assert.equal(windowListeners.listenerCount('resize'), 2);
  setPublished(emptyState());
  await $('refresh').emit('click');
  assert.equal(windowListeners.listenerCount('resize'), 0);
  assert.ok(observers.every(observer => observer.disconnected));
});
test('Singles defaults to cumulative cards and historical review disables official exports without changing Teams', async t => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  state.rounds.push({ date: '2026-11-14', name: 'Cancelled review', canceled: true, qualifying: true,
    cards: [{ player: 'Synthetic Player', score: 99 }] });
  const { $, contents } = await workspace(t, null, state);
  const teams = renderedTable($).rows;
  assert.equal($('singles-weekend').value, '');
  assert.match($('singles-summary').textContent, /197 players across 2 active/);
  assert.equal($('export-singles-pdf').disabled, false);
  assert.equal(renderedTable($, 'singles-table').rows.length, 197);
  $('singles-weekend').value = '2026-11-14';
  await $('singles-weekend').emit('change');
  assert.match($('singles-summary').textContent, /Historical review only/);
  assert.equal($('export-singles-pdf').disabled, true);
  assert.equal($('export-singles-csv').disabled, true);
  assert.match(contents($('singles-table')), /Synthetic Player/);
  assert.deepEqual(renderedTable($).rows, teams);
  $('singles-weekend').value = '';
  await $('singles-weekend').emit('change');
  assert.equal(renderedTable($, 'singles-table').rows.length, 197);
});
test('standings precede collapsed review details, with honest live counts and short accessible round headings', async t => {
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const { $, contents } = await workspace(t, null, state);
  assert.ok(html.indexOf('id="league-table"') < html.indexOf('id="matching-review"'));
  assert.ok(html.indexOf('id="league-table"') < html.indexOf('id="team-review"'));
  for (const id of ['matching-review', 'team-review']) {
    assert.doesNotMatch(html.match(new RegExp(`<details[^>]+id="${id}"[^>]*>`))[0], /\bopen\b/);
    assert.equal($(id).open, false);
  }
  assert.equal($('review-notice').hidden, false);
  assert.match($('review-count').textContent, /^91 cards not counted for teams; \d+ team entries need review\.$/);
  const view = renderedTable($);
  assert.equal(view.rows.length, 46);
  const firstRound = view.head.children[0].children[6];
  assert.equal(firstRound.textContent, 'Round 1\n31 Oct');
  assert.match(firstRound.title, /2026-10-31.*Mens Winter League singles/);
  for (const team of ['Team 15', 'Team 27']) {
    const row = view.rows.find(row => row[1] === team);
    assert.equal(row[5], team === 'Team 15' ? '90' : '98');
    assert.equal(row[9], '49');
  }
  assert.equal(view.rows.find(row => row[1] === 'Team 15')[8], '18');
  assert.doesNotMatch(contents($('matching-table')), /Owens, Colin|Halion, Colin/);
});
test('member landing keeps admin workflows in an inactive secondary tab and supports keyboard navigation', async t => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const state = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const { $, values } = await workspace(t, JSON.stringify(state), state);
  const adminStart = html.indexOf('<section id="admin-panel"');
  for (const id of ['resume-notice', 'upload-results', 'upload-panel', 'results-upload', 'member-update',
    'member-team-csv', 'member-singles-csv', 'pdf-format', 'export-leaderboard-pdf', 'singles-weekend',
    'export-singles-csv', 'results-review', 'review-notice', 'matching-review', 'team-review', 'cards-table', 'unassigned-table', 'report',
    'final-template', 'settings-form', 'backup', 'publication', 'start-draft', 'delete-draft']) {
    assert.ok(html.indexOf(`id="${id}"`) > adminStart, `${id} must be inside Admin / committee`);
  }
  assert.ok(html.indexOf('href="./README.html"') > adminStart);
  assert.equal($('admin-panel').hidden, true);
  assert.equal($('more-views').open, false);
  assert.equal($('league-panel').hidden, false);
  assert.equal($('singles-panel').hidden, true);
  assert.equal($('view-label').textContent, 'PUBLISHED: club results');
  assert.equal($('member-team-pdf').disabled, false);
  assert.match($('league-summary').textContent, /2026-10-31, 2026-11-07/);
  const stored = values.get(STORAGE_KEY);
  await $('tab-league').emit('keydown', { key: 'ArrowRight' });
  assert.equal($('singles-panel').hidden, false);
  assert.equal(document.activeElement, $('tab-singles'));
  await $('tab-singles').emit('keydown', { key: 'End' });
  assert.equal($('more-views').open, true);
  assert.equal($('admin-panel').hidden, false);
  assert.equal($('league-panel').hidden, true);
  await $('upload-results').emit('click');
  assert.equal($('admin-panel').hidden, false);
  assert.equal($('upload-panel').open, true);
  assert.equal(document.activeElement, $('import-files'));
  await $('tab-admin').emit('keydown', { key: 'Home' });
  assert.equal($('admin-panel').hidden, true);
  assert.equal($('league-panel').hidden, false);
  assert.equal($('tab-league').getAttribute('aria-selected'), 'true');
  assert.equal(values.get(STORAGE_KEY), stored);
});
test('table headers sort numeric points and natural team names both ways without changing ranks or stored state', async t => {
  const state = sortingFixture(), original = JSON.stringify(state);
  const { $, values } = await workspace(t, null, state);
  assert.equal($('review-notice').hidden, true);
  const ranks = new Map(league(state).rows.map(row => [row.team.name, String(row.rank)]));
  let view = renderedTable($);
  assert.equal(view.wrapper.tabIndex, 0);
  assert.equal(view.wrapper.attributes.get('role'), 'region');
  assert.equal(view.wrapper.attributes.get('aria-describedby'), 'points-help');
  assert.equal(view.head.children[0].children[6].scope, 'colgroup');
  assert.equal(view.head.children[0].children[6].colSpan, 4);
  assert.equal(view.head.children[0].children[0].rowSpan, 2);
  assert.equal(view.buttons.every(button => button.tagName === 'button' && button.type === 'button'), true);
  assert.equal(view.buttons[0].listeners.has('keydown'), false); // Native buttons provide Enter and Space.
  await view.buttons[5].emit('click');
  view = renderedTable($);
  assert.deepEqual(view.rows.map(row => row[5]), ['0', '9', '20']);
  assert.equal(view.head.children[0].children[5].attributes.get('aria-sort'), 'ascending');
  assert.equal(view.head.children[0].children[0].attributes.get('aria-sort'), 'none');
  assert.match(view.buttons[5].attributes.get('aria-label'), /sort descending/);
  assert.equal(document.activeElement, view.buttons[5]);
  view.wrapper.scrollLeft = 120;
  await view.buttons[5].emit('click');
  view = renderedTable($);
  assert.deepEqual(view.rows.map(row => row[5]), ['20', '9', '0']);
  assert.equal(view.wrapper.scrollLeft, 120);
  assert.equal(view.head.children[0].children[5].attributes.get('aria-sort'), 'descending');
  await view.buttons[1].emit('click');
  assert.deepEqual(renderedTable($).rows.map(row => row[1].split('\n')[0]), ['Team 2', 'Team 3', 'Team 10']);
  await renderedTable($).buttons[1].emit('click');
  view = renderedTable($);
  assert.deepEqual(view.rows.map(row => row[1].split('\n')[0]), ['Team 10', 'Team 3', 'Team 2']);
  for (const row of view.rows) assert.equal(row[0], ranks.get(row[1].split('\n')[0]));
  assert.equal(JSON.stringify(state), original);
  assert.equal(values.has(STORAGE_KEY), false);
  for (const id of ['singles-table', 'teams-table', 'rounds-table', 'cards-table', 'unassigned-table', 'awaiting-table']) {
    if ($(id).querySelectorAll('table').length) {
      const { head, buttons } = renderedTable($, id);
      assert.equal(buttons.length, head.querySelectorAll('th').length, id);
      assert.equal(head.querySelectorAll('th').every(th => th.scope === 'col' && th.attributes.has('aria-sort')), true, id);
    }
  }
});

test('round columns preserve actual player order, held and zero cards, vacancies and best-two discarded totals', async t => {
  const state = sortingFixture();
  state.settings.complete = true; state.settings.discardCount = 1;
  state.teams[0].heldPlayers = ['Alpha 10'];
  state.teams.push({ name: 'Team 34', players: ['Vacancy Alpha', 'Vacancy Beta'] });
  state.rounds[0].cards.push({ player: 'Gamma 10', score: 5 });
  state.rounds[0].cards[0].score = 99;
  state.rounds.push({ date: '2026-11-07', name: 'SYNTHETIC second round', qualifying: true, canceled: false,
    cards: [{ player: 'Gamma 10', score: 6 }, { player: 'Beta 10', score: 8 }, { player: 'Vacancy Alpha', score: 0 }] },
  { date: '2026-11-14', name: 'SYNTHETIC cancelled', qualifying: true, canceled: true, cards: [{ player: 'Alpha 2', score: 50 }] },
  { date: '2026-11-21', name: 'SYNTHETIC excluded', qualifying: false, canceled: false, cards: [{ player: 'Alpha 2', score: 50 }] });
  const { $, contents } = await workspace(t, null, state);
  const view = renderedTable($), row = view.rows.find(row => row[1] === 'Team 10');
  assert.deepEqual(row.slice(2, 5), ['Alpha 10', 'Beta 10', 'Gamma 10']);
  assert.deepEqual(row.slice(5), ['14', '99 H', '0', '5', '5 D', 'NA H', '8', '6', '14']);
  const discarded = view.body.children.find(row => row.children[1].textContent === 'Team 10').children[9];
  assert.match(discarded.attributes.get('aria-label'), /discarded weekend, excluded from Total/);
  const cells = view.body.children.find(row => row.children[1].textContent === 'Team 10').children;
  assert.match(cells[6].className, /non-counting-card/);
  assert.match(cells[6].attributes.get('aria-label'), /held, not counted/);
  assert.match(cells[7].className, /counting-card/);
  assert.match(cells[7].attributes.get('aria-label'), /best-two counting card; weekend discarded/);
  assert.match(cells[8].className, /counting-card/);
  const vacant = view.rows.find(row => row[1] === 'Team 34');
  assert.equal(vacant[4], 'Vacant');
  assert.deepEqual(vacant.slice(6), ['NA', 'NA', 'NA', '0 D', '0', 'NA', 'NA', '0']);
  assert.equal(view.head.children[0].children.filter(th => th.scope === 'colgroup').length, 2);
  assert.doesNotMatch(contents($('league-table')), /SYNTHETIC cancelled|SYNTHETIC excluded/);
  assert.match(contents($('rounds-table')), /Canceled for everyone/);
  assert.match(contents($('rounds-table')), /Excluded \/ nonqualifying/);
  await view.buttons[6].emit('click');
  assert.deepEqual(renderedTable($).rows.map(row => row[6]), ['0', '20', '99 H', 'NA']);
  await renderedTable($).buttons[6].emit('click');
  assert.deepEqual(renderedTable($).rows.map(row => row[6]), ['99 H', '20', '0', 'NA']);
});

test('sort choices survive rerenders, ties stay stable, removed round columns reset to official rank order', async t => {
  const state = sortingFixture();
  state.rounds[0].cards[1].score = 9;
  const { $, setPublished } = await workspace(t, null, state);
  await renderedTable($).buttons[6].emit('click');
  assert.deepEqual(renderedTable($).rows.map(row => row[6]), ['0', '9', '9']);
  const tied = renderedTable($).rows.filter(row => row[6] === '9').map(row => row[1]);
  await renderedTable($).buttons[6].emit('click');
  assert.deepEqual(renderedTable($).rows.filter(row => row[6] === '9').map(row => row[1]), tied);
  await $('refresh').emit('click');
  assert.equal(renderedTable($).head.children[1].children[0].attributes.get('aria-sort'), 'descending');
  const next = structuredClone(state);
  next.rounds[0].date = '2026-11-07';
  setPublished(next);
  await $('refresh').emit('click');
  assert.equal(renderedTable($).head.children[0].children[0].attributes.get('aria-sort'), 'ascending');
  assert.deepEqual(renderedTable($).rows.map(row => row[0]), league(next).rows.map(row => String(row.rank)));
});

test('ordinary tables sort dates chronologically and metadata numerically with absent values last', async t => {
  const state = sortingFixture();
  for (const [index, player] of ['zed', 'alpha', 'Beta'].entries()) {
    state.teams[index].players[0] = player;
    state.rounds[0].cards[index].player = player;
  }
  state.rounds.push({ date: '2026-11-07', name: 'SYNTHETIC later', qualifying: true, canceled: false, cards: [{ player: 'Beta 2', score: 5 }] });
  state.rounds.reverse();
  const { $ } = await workspace(t, null, state);
  await renderedTable($, 'rounds-table').buttons[0].emit('click');
  assert.deepEqual(renderedTable($, 'rounds-table').rows.map(row => row[0]), ['2026-10-31', '2026-11-07']);
  await renderedTable($, 'rounds-table').buttons[0].emit('click');
  assert.deepEqual(renderedTable($, 'rounds-table').rows.map(row => row[0]), ['2026-11-07', '2026-10-31']);
  await renderedTable($, 'cards-table').buttons[4].emit('click');
  assert.deepEqual(renderedTable($, 'cards-table').rows.map(row => row[4]), ['0', '9', '20', 'Not supplied', 'Not supplied']);
  await renderedTable($, 'cards-table').buttons[4].emit('click');
  assert.deepEqual(renderedTable($, 'cards-table').rows.map(row => row[4]), ['20', '9', '0', 'Not supplied', 'Not supplied']);
  await renderedTable($, 'cards-table').buttons[1].emit('click');
  assert.deepEqual(renderedTable($, 'cards-table').rows.map(row => row[1]), ['alpha', 'Beta', 'Beta 2', 'Beta 10', 'zed']);
  await renderedTable($, 'cards-table').buttons[1].emit('click');
  assert.deepEqual(renderedTable($, 'cards-table').rows.map(row => row[1]), ['zed', 'Beta 10', 'Beta 2', 'Beta', 'alpha']);
});

test('final pending totals and unranked entries sort last in either direction without inventing results', async t => {
  const state = sortingFixture();
  state.settings.complete = true;
  state.final = { date: null, cards: state.teams[1].players.map(player => ({
    team: 'Team 2', player, total: 20, back9: 15, back6: 10, back3: 5, back1: 1
  })) };
  const { $ } = await workspace(t, null, state);
  for (const column of [0, 3]) {
    await renderedTable($, 'final-table').buttons[column].emit('click');
    let rows = renderedTable($, 'final-table').rows;
    assert.equal(rows[0][1], 'Team 2');
    assert.deepEqual(rows.slice(1).map(row => row[column]), [column ? 'Pending' : 'Unranked (missing cards)', column ? 'Pending' : 'Unranked (missing cards)']);
    await renderedTable($, 'final-table').buttons[column].emit('click');
    rows = renderedTable($, 'final-table').rows;
    assert.equal(rows[0][1], 'Team 2');
  }
});

test('main PDF download follows the visible published or saved draft and never exports a pending preview', async t => {
  const published = await rosterFixture();
  const state = structuredClone(published);
  state.rounds = [{ date: '2026-11-07', name: 'Saved weekend', qualifying: true, canceled: false,
    cards: [{ player: 'Paddy Daly', score: 29 }, { player: 'Timothy Cummins', score: 24 }] }];
  const { $, values, preview, downloads, setPublished } = await workspace(t, JSON.stringify(state), published);
  const definitions = [];
  window.pdfMake = { createPdf: definition => {
    definitions.push(definition);
    return { getStream: () => Object.assign(new EventEmitter(), {
      end() { this.emit('data', new TextEncoder().encode('%PDF-1.3\nsynthetic transport stub')); this.emit('end'); }
    }) };
  } };
  assert.equal($('export-leaderboard-pdf').disabled, false);
  assert.equal($('pdf-format').value, 'detail');
  assert.equal($('export-leaderboard-pdf').textContent, 'Export integrated Team standings PDF');
  $('pdf-format').value = 'standings';
  await $('pdf-format').emit('change');
  assert.equal($('export-leaderboard-pdf').textContent, 'Export member standings PDF');
  assert.match($('pdf-help').textContent, /awaiting qualifying results.*Published view/);
  const saved = values.get(STORAGE_KEY);
  await $('member-team-pdf').emit('click');
  assert.match(downloads.at(-1).download, /published-awaiting-results.pdf$/);
  assert.match(definitions.at(-1).info.title, /Full detail/);
  assert.equal($('pdf-format').value, 'standings');
  assert.equal(values.get(STORAGE_KEY), saved);
  await $('export-leaderboard-pdf').emit('click');
  assert.equal(downloads.at(-1).download, 'blainroe-winter-league-2026-2027-published-standings-awaiting-results.pdf');
  assert.match(definitions.at(-1).info.subject, /PUBLISHED/);
  assert.doesNotMatch(JSON.stringify(definitions.at(-1)), /Saved weekend/);
  await $('resume-results').emit('click');
  await renderedTable($).buttons[5].emit('click');
  assert.equal(renderedTable($).rows[0][5], '0');
  await preview('Played on,15/11/2026\nPlayer,Score\nPaddy Daly,40');
  await $('member-team-pdf').emit('click');
  assert.match(downloads.at(-1).download, /draft-2026-11-07.pdf$/);
  assert.match(definitions.at(-1).info.subject, /DRAFT: saved on this device, not published/);
  assert.doesNotMatch(JSON.stringify(definitions.at(-1)), /15 Nov/);
  assert.equal($('pdf-format').value, 'standings');
  await $('export-leaderboard-pdf').emit('click');
  assert.equal(downloads.at(-1).download, 'blainroe-winter-league-2026-2027-draft-standings-2026-11-07.pdf');
  const definition = definitions.at(-1);
  assert.match(definition.info.subject, /DRAFT: saved on this device, not published/);
  const firstRow = definition.content.find(entry => entry.table).table.body[1];
  assert.equal(firstRow[1].text, 'Team 34');
  assert.equal(firstRow.at(-1).text, '53');
  assert.doesNotMatch(JSON.stringify(definition), /15 Nov/);
  assert.equal(values.get(STORAGE_KEY), saved);
  for (const [format, title, filename] of [
    ['latest', 'Latest weekend results', 'draft-latest-2026-11-07.pdf'],
    ['detail', 'Full detail', 'draft-2026-11-07.pdf']
  ]) {
    $('pdf-format').value = format;
    await $('pdf-format').emit('change');
    await $('export-leaderboard-pdf').emit('click');
    assert.ok(definitions.at(-1).info.title.includes(title));
    assert.ok(downloads.at(-1).download.endsWith(filename));
    assert.match(definitions.at(-1).info.subject, /DRAFT: saved on this device, not published/);
    assert.doesNotMatch(JSON.stringify(definitions.at(-1)), /15 Nov/);
    assert.equal(values.get(STORAGE_KEY), saved);
  }
  $('pdf-format').value = 'standings';
  await $('pdf-format').emit('change');
  await $('published-view').emit('click');
  await $('export-leaderboard-pdf').emit('click');
  assert.match(downloads.at(-1).download, /published-standings-awaiting-results.pdf$/);
  assert.equal($('export-leaderboard-pdf').disabled, false);
  assert.equal($('member-team-pdf').disabled, false);
  const createPdf = window.pdfMake.createPdf;
  window.pdfMake.createPdf = () => { throw new Error('Synthetic PDF failure'); };
  await $('member-team-pdf').emit('click');
  assert.match($('status').textContent, /Synthetic PDF failure/);
  assert.equal($('member-team-pdf').disabled, false);
  await $('export-leaderboard-pdf').emit('click');
  assert.match($('status').textContent, /Synthetic PDF failure/);
  assert.equal($('export-leaderboard-pdf').disabled, false);
  window.pdfMake.createPdf = createPdf;
  await $('export-leaderboard-pdf').emit('click');
  assert.match(downloads.at(-1).download, /published-standings-awaiting-results.pdf$/);
  const count = downloads.length;
  window.pdfMake.createPdf = () => ({ getStream: () => Object.assign(new EventEmitter(), {
    end() { this.emit('error', new Error('Synthetic stream failure')); }
  }) });
  await $('export-leaderboard-pdf').emit('click');
  assert.match($('status').textContent, /Synthetic stream failure/);
  assert.equal(downloads.length, count);
  assert.equal($('export-leaderboard-pdf').disabled, false);
  window.pdfMake.createPdf = createPdf;
  const historical = structuredClone(state);
  historical.rounds.push({ date: '2026-11-14', name: 'Cancelled latest', qualifying: true, canceled: true,
    cards: [{ player: 'Timothy Cummins', score: 99 }] });
  setPublished(historical);
  await $('refresh').emit('click');
  $('pdf-format').value = 'latest';
  await $('pdf-format').emit('change');
  await $('export-leaderboard-pdf').emit('click');
  assert.match(downloads.at(-1).download, /published-latest-2026-11-14.pdf$/);
  assert.match(JSON.stringify(definitions.at(-1)), /CANCELLED/);
  assert.match(definitions.at(-1).info.subject, /PUBLISHED/);
  assert.doesNotMatch(JSON.stringify(definitions.at(-1)), /99 H/);
});

test('PDF export is disabled with an explanation when no team list is available', async t => {
  const { $ } = await workspace(t);
  assert.equal($('export-leaderboard-pdf').disabled, true);
  assert.equal($('member-team-pdf').disabled, true);
  assert.match($('pdf-help').textContent, /needs an available team list/);
});
test('empty member leaderboard stays honest and committee upload opens the shared form', async t => {
  const published = await rosterFixture();
  const { $, values, contents } = await workspace(t, null, published);
  assert.equal($('view-label').textContent, 'PUBLISHED: club results');
  assert.equal($('results-empty').hidden, false);
  assert.equal($('empty-heading').textContent, 'No results uploaded yet');
  assert.equal($('league-table').hidden, true);
  assert.equal($('tie-warning').hidden, true);
  assert.match($('team-review-summary').textContent, /2 team entries need review/);
  assert.match(contents($('awaiting-table')), /Team 34/);
  assert.doesNotMatch(contents($('league-table')), /Team 34/);
  assert.equal($('upload-panel').children.includes($('results-upload')), true);
  await $('upload-results').emit('click');
  assert.equal($('upload-panel').open, true);
  assert.equal($('import-files').clicked, true);
  assert.equal(document.activeElement, $('import-files'));
  assert.equal(values.has(STORAGE_KEY), false);
  assert.equal($('apply-import').textContent, 'Update leaderboard');
});

test('old zero-team scores map to published players on explicit update, retain settings and survive reload', async t => {
  const published = await rosterFixture();
  const state = emptyState(); state.settings.maxRounds = 12;
  state.rounds = [{ date: '2026-10-31', name: 'Existing scores', qualifying: false, canceled: false,
    cards: [{ player: 'Paddy Daly', score: 18 }] }];
  const source = JSON.stringify(state);
  const { $, values, preview, contents, reload } = await workspace(t, source, published);
  assert.equal($('resume-notice').hidden, false);
  await $('upload-results').emit('click');
  await preview('Competition Name,Synthetic weekend\nPlayed on,08/11/2026\nPlayer,Score\n"Daly, Paddy",29\nTimothy Cummins,24\nColin Owens,40\nSynthetic Visitor,33');
  assert.equal($('round-name').value, 'Synthetic weekend');
  assert.match($('preview-summary').textContent, /2 matched, 1 unmatched, 1 held/);
  assert.match($('preview-summary').textContent, /published team list will be added/);
  assert.match(contents($('preview-table')), /Patrick Daly/);
  assert.match(contents($('preview-table')), /Team 10, Team 37/);
  assert.equal(values.get(STORAGE_KEY), source);
  $('net-confirm').checked = true; await $('net-confirm').emit('change');
  assert.equal($('apply-import').disabled, false);
  await $('apply-form').emit('submit');
  const saved = JSON.parse(values.get(STORAGE_KEY));
  assert.deepEqual(saved.teams, published.teams);
  assert.deepEqual(saved.rounds[0], state.rounds[0]);
  assert.deepEqual(saved.settings, state.settings);
  assert.equal(league(saved).rows.find(row => row.team.name === 'Team 34').retained, 53);
  assert.equal(league(saved).rows.find(row => row.team.name === 'Team 10').retained, 0);
  assert.equal(league(saved).rows.find(row => row.team.name === 'Team 37').retained, 0);
  assert.equal($('results-empty').hidden, true);
  assert.equal($('league-table').hidden, false);
  assert.match(contents($('league-table')), /Patrick Daly\nTimothy Cummins\nDavid Sparling/);
  assert.match(contents($('league-table')), /53/);
  assert.doesNotMatch(contents($('league-table')), /\n(?:Raw|Retained|Discarded total|Status)\n/);
  assert.equal($('matching-review').hidden, false);
  assert.equal($('matching-review').open, false);
  assert.match($('matching-summary').textContent, /2 uploaded cards/);
  assert.equal($('review-notice').hidden, false);
  assert.match($('review-count').textContent, /^2 cards not counted for teams;/);
  assert.match(contents($('matching-table')), /Colin Owens/);
  assert.match(contents($('matching-table')), /Synthetic Visitor/);
  assert.equal($('upload-panel').open, false);
  assert.equal(document.activeElement, $('leaderboard-heading'));
  await reload();
  assert.equal($('view-label').textContent, 'PUBLISHED: club results');
  assert.equal($('resume-notice').hidden, false);
  await $('resume-results').emit('click');
  assert.deepEqual(JSON.parse(values.get(STORAGE_KEY)), saved);
  assert.match(contents($('league-table')), /53/);
});

test('score updates never replace customized teams and combine only the best two mapped cards', async t => {
  const published = await rosterFixture();
  delete published.identityBindings;
  const state = structuredClone(published);
  state.teams.find(team => team.name === 'Team 34').players = ['Synthetic Alpha', 'Synthetic Beta', 'Synthetic Gamma'];
  const { $, values, preview } = await workspace(t, JSON.stringify(state), published);
  await preview('Played on,08/11/2026\nPlayer,Score\nSynthetic Alpha,29\nSynthetic Beta,24\nSynthetic Gamma,20\nPaddy Daly,40');
  assert.equal($('round-name').value, 'Weekend 2026-11-07');
  assert.match($('preview-summary').textContent, /3 matched, 1 unmatched, 0 held/);
  $('net-confirm').checked = true;
  await $('apply-form').emit('submit');
  const saved = JSON.parse(values.get(STORAGE_KEY));
  assert.deepEqual(saved.teams, state.teams);
  assert.equal(league(saved).rows[0].retained, 53);
  assert.equal(saved.rounds[0].cards.length, 4);
});
test('confirmed source names match roster display names in browser preview and saved scores; held cards remain held', async t => {
  const published = await rosterFixture();
  const { $, values, preview } = await workspace(t, null, published);
  await preview('Played on,01/11/2026\nPlayer,Score\nMichael Farrell,14\nJoshua McCall,18\nColin Owens,15');
  assert.match($('preview-summary').textContent, /2 matched, 0 unmatched, 1 held/);
  assert.equal(values.has(STORAGE_KEY), false);
  $('net-confirm').checked = true;
  await $('apply-form').emit('submit');
  const saved = JSON.parse(values.get(STORAGE_KEY));
  assert.deepEqual(saved.identityBindings, published.identityBindings);
  assert.deepEqual(saved.rounds[0].cards.map(card => card.player), ['Michael Farrell', 'Joshua McCall', 'Colin Owens']);
  const rows = renderedTable($).rows;
  assert.equal(rows.find(row => row[1] === 'Team 5')[5], '14');
  assert.equal(rows.find(row => row[1] === 'Team 28')[5], '18');
  for (const team of ['Team 10', 'Team 37']) assert.equal(rows.find(row => row[1] === team)[5], '0');
  const before = values.get(STORAGE_KEY);
  await preview('Played on,08/11/2026\nPlayer,Score\nMichael Farrell,14\nMike Farrell,14');
  assert.equal($('apply-import').disabled, true);
  assert.equal(values.get(STORAGE_KEY), before);
});

test('resume attaches the published team list to old saved scores without needing another upload', async t => {
  const published = await rosterFixture();
  const state = emptyState();
  state.rounds = [{ date: '2026-11-07', name: 'Existing scores', qualifying: true, canceled: false,
    cards: [{ player: 'Paddy Daly', score: 29 }, { player: 'Timothy Cummins', score: 24 }] }];
  const source = JSON.stringify(state);
  const { $, values, contents } = await workspace(t, source, published);
  assert.equal(values.get(STORAGE_KEY), source);
  await $('resume-results').emit('click');
  const saved = JSON.parse(values.get(STORAGE_KEY));
  assert.deepEqual(saved.teams, published.teams);
  assert.deepEqual(saved.rounds, state.rounds);
  assert.equal(league(saved).rows[0].retained, 53);
  assert.match(contents($('league-table')), /53/);
});

test('unmatched-only uploads remain actionable without showing invented all-zero standings', async t => {
  const published = await rosterFixture();
  const { $, values, preview, contents } = await workspace(t, null, published);
  await preview('Played on,08/11/2026\nPlayer,Score\nColin Owens,40\nSynthetic Visitor,33');
  $('net-confirm').checked = true;
  await $('apply-form').emit('submit');
  assert.equal(JSON.parse(values.get(STORAGE_KEY)).rounds[0].cards.length, 2);
  assert.equal($('league-table').hidden, true);
  assert.equal($('empty-heading').textContent, 'No team matches yet');
  assert.equal($('matching-review').hidden, false);
  assert.match(contents($('matching-table')), /Colin Owens/);
  assert.match(contents($('matching-table')), /Synthetic Visitor/);
  assert.equal($('tie-warning').hidden, true);
});

test('missing metadata asks for essentials and does not invent a date or round name', async t => {
  const { $, values, preview } = await workspace(t);
  await preview('Player,Score\nSynthetic Alpha,29');
  assert.equal($('weekend-date').value, '');
  assert.equal($('round-name').value, '');
  $('net-confirm').checked = true; await $('net-confirm').emit('change');
  assert.equal($('apply-import').disabled, true);
  assert.match($('import-apply-help').textContent, /weekend date.*round name/);
  assert.equal(values.has(STORAGE_KEY), false);
});

test('a failed storage write does not claim updated results were saved on this device', async t => {
  const { $, values, preview } = await workspace(t);
  window.localStorage.setItem = () => { throw new Error('Synthetic quota failure'); };
  await preview();
  $('net-confirm').checked = true;
  await $('apply-form').emit('submit');
  assert.equal(values.has(STORAGE_KEY), false);
  assert.match($('status').textContent, /in memory only.*backup/);
  assert.doesNotMatch($('status').textContent, /Saved on this device|Net results saved/);
  assert.match($('draft-banner').textContent, /Not saved/);
});
test('explicit team-list replacement requires confirmation and keeps existing scores and settings', async t => {
  const published = await rosterFixture();
  const state = emptyState(); state.settings.maxRounds = 12;
  state.rounds = [{ date: '2026-10-31', name: 'Saved scores', qualifying: false, canceled: false,
    cards: [{ player: 'Paddy Daly', score: 25 }] }];
  const source = JSON.stringify(state);
  const { $, values } = await workspace(t, source, published);
  assert.equal(values.get(STORAGE_KEY), source);
  assert.equal($('view-label').textContent, 'PUBLISHED: club results');
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
  assert.equal($('roster-player3').value, 'David Sparling');
  $('roster-player3').value = '';
  await $('roster-form').emit('submit');
  assert.equal(JSON.parse(values.get(STORAGE_KEY)).teams.find(t => t.name === 'Team 34').players.length, 2);
  await $('published-view').emit('click');
  assert.equal($('view-label').textContent, 'PUBLISHED: club results');
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
  assert.equal($('view-label').textContent, 'DRAFT: results on this device');
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
  await new Promise(resolve => setImmediate(resolve));
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
  await new Promise(resolve => setImmediate(resolve));
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

test('public landing loads real accumulated results, never resumes an older local draft automatically', async t => {
  const published = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const old = await rosterFixture();
  old.rounds = [{ date: '2026-11-07', name: 'Local only', qualifying: true, canceled: false, cards: [{ player: 'Paddy Daly', score: 30 }] }];
  const { $, contents, values } = await workspace(t, JSON.stringify(old), published);
  assert.equal($('view-label').textContent, 'PUBLISHED: club results');
  assert.equal($('league-table').hidden, false);
  assert.match($('league-summary').textContent, /46 teams. 2 qualifying weekends/);
  assert.match(contents($('league-table')), /Team 15/);
  assert.match(contents($('league-table')), /49/);
  assert.doesNotMatch(contents($('league-table')), /Local only/);
  assert.equal(values.get(STORAGE_KEY), JSON.stringify(old));
});
test('member draft export snapshots the published view without resuming or saving a local draft', async t => {
  const published = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const old = await rosterFixture();
  const source = JSON.stringify(old);
  const { $, values, downloads } = await workspace(t, source, published);
  assert.equal($('member-update').disabled, false);
  await $('member-update').emit('click');
  assert.equal(downloads.at(-1).download, 'blainroe-member-update-draft-2026-11-07.html');
  assert.match($('status').textContent, /newsletter prose only/);
  for (const [id, filename] of [
    ['member-team-csv', 'blainroe-team-standings-2026-11-07.csv'],
    ['member-singles-csv', 'blainroe-singles-cumulative-2026-11-07.csv']
  ]) {
    assert.equal($(id).disabled, false);
    await $(id).emit('click');
    assert.equal(downloads.at(-1).download, filename);
  }
  assert.equal(values.get(STORAGE_KEY), source);
  assert.match($('status').textContent, /Nothing was published or sent/);
});
test('browser applies weekly results on top of current online history and preserves current-league draft edits', async t => {
  const published = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const old = await rosterFixture();
  old.settings.maxRounds = 12;
  old.teams.find(team => team.name === 'Team 34').notes = 'Local committee note';
  old.rounds = [{ date: '2026-11-14', name: 'Local only', qualifying: true, canceled: false, cards: [{ player: 'Paddy Daly', score: 30 }] }];
  const source = JSON.stringify(old);
  const { $, values, preview, setPublished } = await workspace(t, source, published);
  await preview('Played on,22/11/2026\nPlayer,Score\nPaddy Daly,31');
  assert.equal(values.get(STORAGE_KEY), source);
  const newer = structuredClone(published);
  newer.rounds.push({ date: '2026-11-28', name: 'Published during preview', qualifying: true, canceled: false, cards: [{ player: 'Timothy Cummins', score: 32 }] });
  setPublished(newer);
  $('net-confirm').checked = true;
  await $('apply-form').emit('submit');
  const saved = JSON.parse(values.get(STORAGE_KEY));
  assert.deepEqual(saved.rounds.find(round => round.date === '2026-10-31'), published.rounds[0]);
  assert.deepEqual(saved.rounds.map(round => round.date).sort(), ['2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
  assert.equal(saved.settings.maxRounds, 12);
  assert.equal(saved.teams.find(team => team.name === 'Team 34').notes, 'Local committee note');
  assert.deepEqual(JSON.parse(values.get(BASELINE_KEY)).published, newer);
});
test('publication download fetches the latest seed and includes online weekends missing from a saved draft', async t => {
  const nativeFetch = globalThis.fetch;
  const published = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const local = structuredClone(published); local.teams[0].notes = 'Local review';
  const { $, downloads, setPublished, values } = await workspace(t, JSON.stringify(local), published, published);
  const newer = structuredClone(published);
  newer.rounds.push({ date: '2026-11-14', name: 'Later online result', qualifying: true, canceled: false, cards: [{ player: 'Paddy Daly', score: 30 }] });
  setPublished(newer);
  await $('publication').emit('click');
  assert.equal(downloads.at(-1).download, 'published.json');
  const exported = await (await nativeFetch(downloads.at(-1).href)).json();
  assert.equal(exported.rounds.length, 3);
  assert.deepEqual(exported.rounds[2], newer.rounds[2]);
  assert.equal(exported.teams[0].notes, 'Local review');
  assert.equal(values.get(STORAGE_KEY), JSON.stringify(local));
  assert.match($('status').textContent, /No server data was changed/);
});
test('conflicting online and local score edits block resume, apply and publication without losing the backup', async t => {
  const published = JSON.parse(await readFile(new URL('../data/published.json', import.meta.url), 'utf8'));
  const local = structuredClone(published), newer = structuredClone(published);
  local.rounds[0].cards[0].score++;
  newer.rounds[0].cards[0].score += 2;
  const source = JSON.stringify(local);
  const { $, values, downloads, preview } = await workspace(t, source, newer, published);
  await $('resume-results').emit('click');
  assert.match($('status').textContent, /Sync conflict.*preserved.*backup/);
  assert.equal($('view-label').textContent, 'PUBLISHED: club results');
  await preview();
  assert.match($('import-status').textContent, /Sync conflict/);
  assert.equal($('apply-import').disabled, true);
  await $('publication').emit('click');
  assert.equal(downloads.length, 0);
  assert.equal(values.get(STORAGE_KEY), source);
  await $('backup').emit('click');
  assert.equal(downloads.at(-1).download, 'blainroe-draft-backup.json');
});
test('unrelated saved team list cannot erase the current roster, and unavailable latest data blocks publication', async t => {
  const published = await rosterFixture(), unrelated = emptyState();
  unrelated.teams = [{ name: 'Other season team', players: ['One', 'Two', 'Three'] }];
  const source = JSON.stringify(unrelated);
  const { $, preview, values, downloads } = await workspace(t, source, published);
  await preview();
  assert.match($('import-status').textContent, /unrelated team list/);
  assert.equal(values.get(STORAGE_KEY), source);
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  await $('publication').emit('click');
  assert.match($('status').textContent, /latest published.*503/);
  assert.equal(downloads.length, 0);
  assert.equal(values.get(STORAGE_KEY), source);
});
