import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { emptyState } from '../core.js';
import { STORAGE_KEY } from '../storage.js';

let instance = 0;
async function workspace(t, source = null) {
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
  globalThis.fetch = async () => ({ ok: true, text: async () => JSON.stringify(emptyState()) });
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
    await $('import-form').emit('submit');
  }
  return { $, values, preview };
}

test('results preview is read-only; only a valid explicit apply starts a saved draft', async t => {
  const { $, values, preview } = await workspace(t);
  await preview();
  assert.equal($('preview').hidden, false);
  assert.equal($('weekend-date').value, '2026-11-07');
  assert.equal(values.has(STORAGE_KEY), false);
  await $('apply-form').emit('submit');
  assert.equal(values.has(STORAGE_KEY), false);
  $('net-confirm').checked = true;
  $('round-name').value = 'Synthetic weekend';
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
  await $('import-files').emit('change');
  await $('apply-form').emit('submit');
  assert.equal($('preview').hidden, true);
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
