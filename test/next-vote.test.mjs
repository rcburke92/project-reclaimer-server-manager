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

test('on an ODST first server, games are ODST missions and Firefight maps', () => {
  const odst = { server: [{ name: 'FF', port: 49176, rcon_password: 'longenough', odst: { mode: 'firefight', mission: 6100, insertion: 4 } }] };
  const ok = { choice: [{ map: 'Tayari Plaza' }, { map: 'Crater (Night)', game: 'odst_ff_rocketfight_1set' }, { map: 'Last Exit', game: 'Rocketfight' }] };
  assert.deepStrictEqual(validateNextVote(ok, odst), []);
  const wrong = { choice: [{ map: 'Guardian', game: 'Slayer' }, { map: 'Data Hive', game: 'Rocketfight' }] };
  assert.deepStrictEqual(texts(validateNextVote(wrong, odst)), [
    'warning: Game 1: "Guardian" isn\'t an ODST mission or Firefight map, which the first server plays',
    'warning: Game 1: "Slayer" isn\'t a Firefight game type',
    'warning: Game 2: Data Hive is a mission, which takes no game type',
  ]);
  // A Halo 3 server still needs a game type.
  assert.deepStrictEqual(texts(validateNextVote({ choice: [{ map: 'Guardian' }, { map: 'Valhalla', game: 'Slayer' }] }, dedicated)), ['error: Game 1 has no game type']);
});

test('choice labels match what the egg posts in chat', () => {
  assert.strictEqual(choiceLabel({ map: 'Guardian', game: 'Gun Game' }), 'Gun Game on Guardian');
  assert.strictEqual(choiceLabel({ map: 'Guardian', game: 'Slayer', name: ' Guardian FFA ' }), 'Guardian FFA');
  assert.strictEqual(choiceLabel({ map: 'Tayari Plaza' }), 'Tayari Plaza');
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
