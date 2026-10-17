'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { patchToml, parseToml } = require('../src/main/toml-patch');

// The example from https://projectreclaimer.dev/host "The configuration file".
const SAMPLE = `game = "game"
content = "content"
public_address = ""          # empty: detect this machine's public address
upnp = false
auto_update = false          # true: install each new release and restart
host_name = "My Community"
admins = [
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
]

[master]
enabled = true
port = 49175

[rcon]
password = ""             # set one to turn on the remote console
address = "127.0.0.1"

[defaults]
voice = true
text_chat = true
votes = true
max_players = 16
anti_cheat = "enforce"     # the default; see Anti-cheat
block_vpn = true           # the default; see VPN blocking

[[server]]
name = "Community Rotation"
port = 49176
playlist = "playlists/community.playlist.json"

[[server]]
name = "Snipers Only"
port = 49177
map = "Valhalla"
game = "Game Modes/snipers.bin"
max_players = 8
`;

test('no changes returns the same text', () => {
  assert.strictEqual(patchToml(SAMPLE, parseToml(SAMPLE)), SAMPLE);
});

test('changing a value keeps its comment and everything else', () => {
  const d = parseToml(SAMPLE);
  d.defaults.max_players = 12;
  d.defaults.anti_cheat = 'detect';
  const out = patchToml(SAMPLE, d);
  assert.match(out, /^max_players = 12$/m);
  assert.match(out, /^anti_cheat = "detect"     # the default; see Anti-cheat$/m);
  assert.strictEqual(out.split('\n').length, SAMPLE.split('\n').length);
  assert.match(out, /# true: install each new release and restart/);
});

test('multi-line arrays are replaced whole', () => {
  const d = parseToml(SAMPLE);
  d.admins = ['a'.repeat(64), 'b'.repeat(64)];
  const out = patchToml(SAMPLE, d);
  assert.deepStrictEqual(parseToml(out).admins, d.admins);
  assert.ok(!out.includes('0123456789abcdef'));
});

test('add and remove keys, tables and servers', () => {
  const d = parseToml(SAMPLE);
  delete d.upnp;
  d.stats_server = 'off';
  d.workshop = { items: ['2899741683'], update_check_minutes: 0 };
  delete d.master;
  d.server[1].password = 'secret';
  delete d.server[1].map;
  delete d.server[1].game;
  d.server[1].playlist = 'playlists/x.playlist.json';
  d.server.push({ name: 'Third', port: 49178, variant: 'content/Game Modes/momentum.json' });
  d.server.splice(0, 1);
  const out = patchToml(SAMPLE, d);
  const back = parseToml(out);
  assert.strictEqual(back.stats_server, 'off');
  assert.ok(!('upnp' in back));
  assert.ok(!('master' in back));
  assert.deepStrictEqual(back.workshop.items, ['2899741683']);
  assert.strictEqual(back.server.length, 2);
  assert.strictEqual(back.server[1].name, 'Third');
  // [workshop] is placed before the [[server]] blocks
  assert.ok(out.indexOf('[workshop]') < out.indexOf('[[server]]'));
  // comments outside edited lines survive
  assert.match(out, /# set one to turn on the remote console/);
});

test('creates a file from nothing', () => {
  const d = { host_name: 'X', defaults: { max_players: 8 }, server: [{ name: 'A', port: 49176, map: 'Guardian', game: 'Slayer' }] };
  const out = patchToml('', d);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(parseToml(out))), d);
});

test('strings with quotes and backslashes round-trip', () => {
  const d = parseToml(SAMPLE);
  d.workshop = { steamcmd: 'C:\\steamcmd\\steamcmd.exe' };
  d.host_name = 'Bob\'s "Best" Server';
const back = parseToml(patchToml(SAMPLE, d));
  assert.strictEqual(back.workshop.steamcmd, 'C:\\steamcmd\\steamcmd.exe');
  assert.strictEqual(back.host_name, 'Bob\'s "Best" Server');
});

test('campaign inline tables are written, changed and removed in place', () => {
  const plain = (t) => JSON.parse(JSON.stringify(parseToml(t)));
  const d = plain(SAMPLE);
  d.server[1] = { name: 'Co-op', port: 49177, max_players: 16, campaign: { mission: 3010, difficulty: 'heroic' } };
  let out = patchToml(SAMPLE, d);
  assert.match(out, /^campaign = \{ mission = 3010, difficulty = "heroic" \}$/m);
  assert.deepStrictEqual(plain(out).server[1].campaign, { mission: 3010, difficulty: 'heroic' });

  d.server[1].campaign.modifiers = { health_percent: 150, damage_percent: 125 };
  out = patchToml(out, d);
  assert.match(out, /modifiers = \{ health_percent = 150, damage_percent = 125 \}/);
  assert.deepStrictEqual(plain(out).server[1].campaign.modifiers, { health_percent: 150, damage_percent: 125 });
  assert.match(out, /# set one to turn on the remote console/);

  delete d.server[1].campaign;
  d.server[1].map = 'Guardian';
  d.server[1].game = 'Slayer';
  out = patchToml(out, d);
  assert.doesNotMatch(out, /campaign/);
  assert.strictEqual(plain(out).server[1].map, 'Guardian');
});

test('welcome takes one line or a list', () => {
  const d = JSON.parse(JSON.stringify(parseToml(SAMPLE)));
  d.defaults.welcome = 'Welcome to {server}, {name}!';
  d.server[0].welcome = ['Welcome, {name}!', 'Discord: discord.gg/example'];
  d.server[1].welcome = '';
  const back = parseToml(patchToml(SAMPLE, d));
  assert.strictEqual(back.defaults.welcome, 'Welcome to {server}, {name}!');
  assert.deepStrictEqual(back.server[0].welcome, ['Welcome, {name}!', 'Discord: discord.gg/example']);
  assert.strictEqual(back.server[1].welcome, '');
});
