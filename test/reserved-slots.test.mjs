import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { validateReservedSlots, firstServerMaxPlayers } from '../src/renderer/lib/reserved-slots.js';

const require = createRequire(import.meta.url);
const { patchToml, parseToml } = require('../src/main/toml-patch');

const OWNER = 'a'.repeat(64);
const dedicated = (server = {}, extra = {}) => ({
  rcon: { password: 'long enough' },
  defaults: { max_players: 16 },
  server: [{ name: 'Halo 3', port: 49176, ...server }],
  ...extra,
});
const texts = (issues, level) => issues.filter((i) => i.level === level).map((i) => i.text);

test('max players: the first server beats [defaults], which beats 16', () => {
  assert.strictEqual(firstServerMaxPlayers(dedicated({ max_players: 12 })), 12);
  assert.strictEqual(firstServerMaxPlayers(dedicated()), 16);
  assert.strictEqual(firstServerMaxPlayers({ server: [{}] }), 16);
  assert.strictEqual(firstServerMaxPlayers(undefined), 16);
});

test('a complete setup has no issues', () => {
  assert.deepStrictEqual(validateReservedSlots({ slots: 1, password: 'vip', whitelist: [OWNER], bump: true, bump_order: ['lowest_score'] }, dedicated()), []);
});

test('off (no slots) only checks the values themselves', () => {
  assert.deepStrictEqual(validateReservedSlots({}, dedicated({ password: 'x' }, { rcon: {} })), []);
  assert.strictEqual(texts(validateReservedSlots({ whitelist: ['nope'] }, dedicated()), 'error').length, 1);
});

test('reserved slots without a password are an error', () => {
  assert.ok(texts(validateReservedSlots({ slots: 1, whitelist: [OWNER] }, dedicated()), 'error').some((e) => e.includes('reserved password')));
});

test('bad values are errors', () => {
  const issues = validateReservedSlots({ slots: 16, password: 'has space', whitelist: [OWNER, 'abc'], bump_order: ['highest_ping'] }, dedicated());
  const errors = texts(issues, 'error');
  assert.strictEqual(errors.length, 4, errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('leave no public slots')));
});

test('setups the egg would refuse are warnings', () => {
  const warnings = texts(validateReservedSlots({ slots: 1, password: 'vip' }, dedicated({ password: 'join' }, { rcon: {} })), 'warning');
  assert.ok(warnings.some((w) => w.includes('join password')));
  assert.ok(warnings.some((w) => w.includes('RCON password')));
  assert.ok(warnings.some((w) => w.includes('Nobody is whitelisted')));
});

test('a new reserved-slots.toml is written below its header comment and reads back', () => {
  const header = '# reserved-slots.toml: header\n';
  const data = { slots: 1, password: 'vip', whitelist: [OWNER], bump: false, bump_order: ['lowest_score', 'least_session_time'] };
  const text = patchToml(header, data);
  assert.ok(text.startsWith(header));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parseToml(text))), data);
  const off = patchToml(text, { slots: 0 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parseToml(off))), { slots: 0 });
});
