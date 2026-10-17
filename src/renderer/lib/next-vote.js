// next-vote.toml checks. No DOM here, so tests can import it.
import schema from '../../catalog/next-vote-schema.json' with { type: 'json' };

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
  const seen = new Set();
  choices.forEach((c, i) => {
    if (!String(c.map || '').trim()) error(`Game ${i + 1} has no map`);
    if (!String(c.game || '').trim()) error(`Game ${i + 1} has no game type`);
    const key = `${String(c.map).toLowerCase()}|${String(c.game).toLowerCase()}`;
    if (seen.has(key)) warning(`Game ${i + 1} repeats an earlier map and game type`);
    seen.add(key);
  });
  // Only a number set on purpose: the default simply offers what the list has.
  const perVote = data.choices_per_vote;
  if (perVote > choices.length && choices.length >= schema.minChoices) {
    warning(`Games per vote (${perVote}) is more than the list has: every vote offers all ${choices.length}`);
  }

  const first = dedicated?.server?.[0];
  if (dedicated && !first?.rcon_password && !dedicated.rcon?.password) {
    warning('The vote works through RCON: set an RCON password in dedicated.toml, or the egg\'s RCON Password variable');
  }
  return issues;
}

/** What players read for a game: its name, else "<game> on <map>" as the egg writes it. */
export function choiceLabel(c) {
  return String(c.name || '').trim() || `${c.game} on ${c.map}`;
}
