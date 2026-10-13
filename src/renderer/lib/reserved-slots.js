// reserved-slots.toml checks. No DOM here, so tests can import it.
import schema from '../../catalog/reserved-slots-schema.json' with { type: 'json' };

const ID_RE = /^[0-9a-f]{64}$/i;

/** The first [[server]]'s player limit from dedicated.toml (the panel's Max Players variable can still change it). */
export function firstServerMaxPlayers(dedicated) {
  const s = dedicated?.server?.[0] || {};
  return s.max_players ?? dedicated?.defaults?.max_players ?? 16;
}

/** Issues for reserved-slots.toml, checked against dedicated.toml when it's given. */
export function validateReservedSlots(data, dedicated) {
  const issues = [];
  const error = (text) => issues.push({ level: 'error', text });
  const warning = (text) => issues.push({ level: 'warning', text });
  const slots = data.slots ?? 0;
  const whitelist = data.whitelist || [];

  for (const id of whitelist) {
    if (!ID_RE.test(id)) error(`Whitelist: "${id.length > 16 ? `${id.slice(0, 16)}…` : id}" isn't a player ID (64 hexadecimal characters)`);
  }
  if (data.password && /\s/.test(data.password)) error('The reserved password can\'t contain spaces');
  for (const rule of data.bump_order || []) {
    if (!schema.bumpRules.includes(rule)) error(`Bump order: "${rule}" isn't one of ${schema.bumpRules.join(', ')}`);
  }
  if (!slots) return issues;

  // Required even when the panel's Reserved Password is set, which overrides it anyway.
  if (!data.password) error('Set a reserved password: without one, reserved slots stay off');
  if (!dedicated) return issues;
  const server = dedicated.server?.[0];
  if (!server) {
    warning('dedicated.toml has no [[server]] to reserve slots on');
    return issues;
  }
  const max = firstServerMaxPlayers(dedicated);
  if (slots >= max) error(`${slots} reserved slot${slots === 1 ? '' : 's'} leave no public slots: ${server.name || 'the first server'} has max players ${max}`);
  const joinPassword = 'password' in server ? server.password : dedicated.defaults?.password;
  if (joinPassword) warning(`${server.name || 'The first server'} has a join password: reserved slots stay off until it's empty`);
  if (!dedicated.rcon?.password && !server.rcon_password) warning('Reserved slots need an RCON password: set one under Remote console, or the panel\'s RCON Password');
  if (!whitelist.length && !(dedicated.admins || []).length && !(server.admins || []).length) warning('Nobody is whitelisted and there are no admins');
  return issues;
}
