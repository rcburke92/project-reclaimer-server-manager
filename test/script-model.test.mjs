import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readScript, writeScript } from '../src/renderer/lib/script-model.js';

const bundled = path.join(os.homedir(), 'Documents', 'My Games', 'Project Reclaimer', 'Game Modes', 'Project Reclaimer');

test('bundled scripts survive an unchanged round trip', { skip: !fs.existsSync(bundled) }, () => {
  for (const f of fs.readdirSync(bundled).filter((n) => n.endsWith('.json'))) {
    const data = JSON.parse(fs.readFileSync(path.join(bundled, f), 'utf8'));
    const model = readScript(data.script);
    const out = writeScript(data.script, model.rows, data.script.name);
    assert.deepStrictEqual(out, data.script, f);
  }
});

test('adding traits upgrades to version 2 with logic', () => {
  const model = readScript(undefined);
  model.rows.push({ event: 'on_spawn', action: { simple: true, op: 'traits', value: { gravity: 1 }, condition: 'always' } });
  const out = writeScript(undefined, model.rows, 'Low Grav');
  assert.deepStrictEqual(out, { version: 2, name: 'Low Grav', initial: [], on_spawn: [{ op: 'traits', values: { gravity: 1 } }], logic: {} });
});

test('simple actions round-trip with conditions', () => {
  const script = { version: 1, name: 'x', initial: [], on_kill: [{ op: 'score', when: ['kill.melee', 0, '=='], value: [2] }, { op: 'weapon', index: [0], choices: ['magnum'] }] };
  const model = readScript(script);
  assert.ok(model.rows.every((r) => r.action.simple));
  assert.deepStrictEqual(writeScript(script, model.rows, 'x'), script);
});

test('removing every action drops the script', () => {
  assert.strictEqual(writeScript({ version: 1, name: 'x', initial: [] }, [], 'x'), undefined);
});
