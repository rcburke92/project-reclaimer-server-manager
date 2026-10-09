'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { baseModeDefaults, parseVariant, decodeDefaults } = require('../src/main/mcc-variants');

const MCC = require('./mcc-path');
const DIR = path.join(MCC, 'halo3', 'game_variants');
const have = !!MCC && fs.existsSync(DIR);

// The stock variants whose names state their values are the ground truth.
test('decodes values stated in the stock variant file names', { skip: !have }, () => {
  const d = (f) => decodeDefaults(parseVariant(path.join(DIR, f)));
  assert.strictEqual(d('h3_4v4_hardcoreSlayer_50kills.bin').rules.score_to_win, 50);
  assert.strictEqual(d('h3_2v2_team_hardcoreSlayer_25kills.bin').rules.score_to_win, 25);
  assert.strictEqual(d('h3_ffa_hardcoreSlayer_12min.bin').options['rounds.minutes'], 12);
  assert.strictEqual(d('h3_ffa_hardcoreSlayer_12min.bin').options['rounds.teams'], 0);
  assert.strictEqual(d('h3_4v4_hardcoreFlag_heretic_5points.bin').rules.score_to_win, 5);
  assert.strictEqual(d('h3_4v4_hardcoreFlag_pit_3points.bin').rules.score_to_win, 3);
  assert.strictEqual(d('h3_4v4_hardcoreKing_250points.bin').rules.score_to_win, 250);
  assert.strictEqual(d('h3_4v4_hardcoreBall_250points.bin').rules.score_to_win, 250);
});

test('base mode defaults', { skip: !have }, () => {
  const all = baseModeDefaults(MCC);
  assert.deepStrictEqual(all.Slayer.rules, { score_to_win: 25, kill_points: 1, death_points: 0, suicide_points: -1, betrayal_points: -1 });
  assert.strictEqual(all['Capture the Flag'].rules.score_to_win, 3);
  assert.strictEqual(all['Capture the Flag'].options['rounds.teams'], 1);
  assert.strictEqual(all['King of the Hill'].rules.score_to_win, 100);
  assert.strictEqual(all.Oddball.rules.score_to_win, 50);
  assert.strictEqual(all.Infection.options['rounds.limit'], 3);
  assert.strictEqual(all.Territories.options['rounds.minutes'], 4);
  assert.ok(!('score_to_win' in all.Juggernaut.rules), 'unconfirmed scores are left out');
});
