// next-vote.toml checks. No DOM here, so tests can import it.
import schema from '../../catalog/next-vote-schema.json' with { type: 'json' };
import server from '../../catalog/server-schema.json' with { type: 'json' };

// The names an ODST server's maps and modes list, which its nextmap takes (0.9.21+).
const ODST_MAPS = new Set([...server.odst.missions, ...server.odst.firefightMaps].map((m) => m.label.toLowerCase()));
const ODST_MISSIONS = new Set(server.odst.missions.map((m) => m.label.toLowerCase()));
const ODST_GAMES = new Set(server.odst.variants.flatMap((v) => [v.value, v.label]).map((n) => n.toLowerCase()));

/** Issues for next-vote.toml, checked against dedicated.toml when it's given. */
export function validateNextVote(data, dedicated) {
  const issues = [];
  const error = (text) => issues.push({ level: 'error', text });
  const warning = (text) => issues.push({ level: 'warning', text });
  const choices = Array.isArray(data.choice) ? data.choice : [];
  // An empty file is "not set up", not an error: the egg starts the vote only when the file exists.
  if (!choices.length && data.vote_seconds === undefined && data.choices_per_vote === undefined) return issues;

  for (const f of schema.fields) {
    const v = data[f.key];
    if (v !== undefined && (!Number.isInteger(v) || v < f.min || v > f.max)) error(`${f.label} must be ${f.min} to ${f.max}`);
  }
  if (choices.length < schema.minChoices) error(`List at least ${schema.minChoices} games`);
  const first = dedicated?.server?.[0];
  const odst = !!first?.odst;
  const seen = new Set();
  choices.forEach((c, i) => {
    const map = String(c.map || '').trim().toLowerCase();
    const game = String(c.game || '').trim().toLowerCase();
    if (!map) error(`Game ${i + 1} has no map`);
    // An ODST mission has no game type; the egg leaves it out of nextmap.
    if (!game && !odst) error(`Game ${i + 1} has no game type`);
    if (odst && map && !ODST_MAPS.has(map)) warning(`Game ${i + 1}: "${c.map}" isn't an ODST mission or Firefight map, which the first server plays`);
    if (odst && game && !ODST_GAMES.has(game)) warning(`Game ${i + 1}: "${c.game}" isn't a Firefight game type`);
    if (odst && game && ODST_MISSIONS.has(map)) warning(`Game ${i + 1}: ${c.map} is a mission, which takes no game type`);
    const key = `${map}|${game}`;
    if (seen.has(key)) warning(`Game ${i + 1} repeats an earlier map and game type`);
    seen.add(key);
  });
  // Only a number set on purpose: the default simply offers what the list has.
  const perVote = data.choices_per_vote;
  if (perVote > choices.length && choices.length >= schema.minChoices) {
    warning(`Games per vote (${perVote}) is more than the list has: every vote offers all ${choices.length}`);
  }

  if (dedicated && !first?.rcon_password && !dedicated.rcon?.password) {
    warning('The vote works through RCON: set an RCON password in dedicated.toml, or the egg\'s RCON Password variable');
  }
  return issues;
}

/** What players read for a game: its name, else "<game> on <map>" (or the map alone) as the egg writes it. */
export function choiceLabel(c) {
  return String(c.name || '').trim() || (c.game ? `${c.game} on ${c.map}` : String(c.map));
}
