import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { validateNextVote, choiceLabel } from '../src/renderer/lib/next-vote.js';

const require = createRequire(import.meta.url);
const { patchToml, parseToml } = require('../src/main/toml-patch');

const dedicated = { server: [{ name: 'A', port: 49176, rcon_password: 'longenough' }] };
const texts = (issues) => issues.map((i) => `${i.level}: ${i.text}`);

test('an empty next-vote.toml is simply not set up', () => {
  assert.deepStrictEqual(validateNextVote({}, dedicated), []);
});

test('a usable list passes, and problems are named', () => {
  const ok = { vote_seconds: 60, choice: [{ map: 'Guardian', game: 'Slayer' }, { map: 'Valhalla', game: 'Game Modes/snipers.json', name: 'Snipers' }] };
  assert.deepStrictEqual(validateNextVote(ok, dedicated), []);
  assert.deepStrictEqual(texts(validateNextVote({ vote_seconds: 5, choice: [{ map: 'Guardian', game: '' }] }, { server: [{}] })), [
    'error: Vote time must be 15 to 300',
    'error: List at least 2 games',
    'error: Game 1 has no game type',
    'warning: The vote works through RCON: set an RCON password in dedicated.toml, or the egg\'s RCON Password variable',
  ]);
  const repeat = { choice: [{ map: 'Guardian', game: 'Slayer' }, { map: 'guardian', game: 'slayer' }], choices_per_vote: 4 };
  assert.deepStrictEqual(texts(validateNextVote(repeat, dedicated)), [
    'warning: Game 2 repeats an earlier map and game type',
    'warning: Games per vote (4) is more than the list has: every vote offers all 2',
  ]);
});

test('an ODST first server is named, since the vote can\'t queue games on it', () => {
  const list = { choice: [{ map: 'Guardian', game: 'Slayer' }, { map: 'Valhalla', game: 'Slayer' }] };
  const odst = { server: [{ name: 'FF', port: 49176, rcon_password: 'longenough', odst: { mode: 'firefight', mission: 6100, insertion: 4 } }] };
  assert.deepStrictEqual(texts(validateNextVote(list, odst)), [
    'warning: The first server plays Halo 3: ODST, whose game the console can\'t change: the vote won\'t start on it',
  ]);
});

test('choice labels match what the egg posts in chat', () => {
  assert.strictEqual(choiceLabel({ map: 'Guardian', game: 'Gun Game' }), 'Gun Game on Guardian');
  assert.strictEqual(choiceLabel({ map: 'Guardian', game: 'Slayer', name: ' Guardian FFA ' }), 'Guardian FFA');
});

test('[[choice]] tables are written into a new file and removed again', () => {
  const header = '# next-vote.toml\n';
  const d = { vote_seconds: 45, choice: [{ map: 'Guardian', game: 'Slayer' }, { name: 'Snipers', map: 'Valhalla', game: 'Game Modes/snipers.json' }] };
  let out = patchToml(header, d);
  assert.match(out, /^# next-vote\.toml/);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parseToml(out))), d);
  d.choice.splice(0, 1);
  out = patchToml(out, d);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parseToml(out))).choice, [{ name: 'Snipers', map: 'Valhalla', game: 'Game Modes/snipers.json' }]);
});
