# Halo 3 Server Manager

A desktop app for building the files a [Project Reclaimer](https://projectreclaimer.dev/host) Halo 3 dedicated server reads. It replaces looking things up in the docs: every setting is a form control.

- **Game types:** scoring, every game option the server takes for the base mode (objective rules, trait sets, powerups, …) and simple script events.
- **Playlists:** maps (stock, Workshop mod and saved Forge maps), game types, weights and per-entry options, sprint, vote images and team voice, with the server's limits checked as you go.
- **Server:** `dedicated.toml` as forms, campaign co-op and Halo 3: ODST campaign or Firefight servers included (Project Reclaimer 0.9.19+) with their skulls, sprint and Firefight options (0.9.21), the camera setting (0.9.20) and VPN blocking by network (0.9.22). Your comments and layout are kept. Two more documents set up the egg's helpers: `reserved-slots.toml` (reserved slots for whitelisted players) and `next-vote.toml` (the games an admin's `!nextvote` lets players choose the next game from, ODST missions and Firefight maps included).
- **Mods:** an embedded Steam Workshop filtered to Halo 3, plus a list of the Halo 3 mods you're subscribed to, read from Steam's files on this PC. Each mod shows exactly which folder to copy to the server.
- **Export:** a checklist of what to upload to the server, what's changed since last time, and which mods your playlists need.

The app never calls the Steam Web API and never polls Steam. Mods are read from local files. The optional "Sync subscriptions" button loads your Steam subscriptions page once, and only when you click it.

## Run

`Halo3ServerManager-<version>.exe` is a single portable exe: there is no installer, just run it. Download it from the [Releases](../../releases) page, or build it yourself with `npm run dist` (it lands in `out\`).

It's a tool for servers run with the companion Project Reclaimer Pterodactyl egg, but the files it writes work with any Project Reclaimer dedicated server.

Or run from source (Node 20+):

```powershell
npm install
npm start
```

## Workflow

1. **Settings.** Check that the Steam folder and MCC install are found (they're detected automatically).
   - The **workspace folder** (default `Documents\Halo 3 Server Manager\workspace`) is laid out exactly like the server folder: `dedicated.toml`, `reserved-slots.toml`, `playlists/`, `content/Game Modes/`, `content/Maps/`, `content/Images/` (playlist vote images), `content/Mods/`.
2. **Server.** Download `dedicated.toml` from the Pterodactyl File Manager and use **Import dedicated.toml…**, or start from the default. Then edit the servers, what each one plays, and the shared settings. To keep slots free for yourself or other whitelisted players, open the **reserved-slots.toml** tab, and raise the first server's max players by the slots you reserve.
   - Egg variables filled in on the panel override the file. Leave them empty to use the file.
3. **Mods → Workshop.** Sign in to Steam and subscribe to Halo 3 mods. The Steam client downloads them.
4. **Mods → My Halo 3 Mods.** Your downloaded Halo 3 mods, each with:
   - its maps, and the playlist reference for each (`workshop:<id>/<map>`);
   - the folder to copy to the server.
5. **Game Types / Playlists.** Use ＋ to make one, ⧉ to duplicate, ✎ to open (or double-click), and 🗑 to delete.
   - Open items appear as tabs. • marks unsaved changes; **Save** and **Discard** sit at the bottom.
   - In a playlist, **Add entry** opens a map picker. Every setting starts off: switch on what that entry should change.
6. **Export.** Follow the checklist:
   1. Upload the listed files.
   2. Copy the listed mod folders into `content/Mods`.
   3. From Project Reclaimer 0.9.18 the running server applies uploaded settings, playlists, game types and maps by itself within seconds, without dropping players. Restart it from the panel only for new or updated mods.
   4. Press **Mark everything as uploaded**. Next time, only what changed is marked.

## Good to know

- **Bundled modes are read-only.** Gun Game, Growth, One in the Chamber, Zone Control, Flood Infection and UNSC vs Covenant are already on the server, so playlists can use them by name. Duplicate one to make your own version.
  - **Flood Infection** also needs `050_floodvoi.map` from MCC's `halo3\maps` in the server's `game/halo3/maps`. `dedicated init` doesn't copy it and `dedicated check` doesn't ask for it; without it, a vote for that entry passes, the game fails to load and the vote starts over. The Export tab warns when a playlist uses it.
- **Game options** are the server's own (Project Reclaimer 0.9.17): each base mode lists only the options it takes, with the server's names, choices and ranges. Playlists write weapons by name ("Battle rifle"), which the server checks.
  - To confirm everything before uploading, set `project-reclaimer.exe` in Settings and use **Run dedicated check** in the Export tab.
  - Settings the forms don't cover can come from the game client: set them in Game Options, use **Save as variant**, and import the file with ⤓ in Game Types. Unknown options are kept.
- **Playlist entry defaults:** each setting shows the game type's own value until you change it. Base modes (Slayer, CTF, KOTH, …) get theirs from MCC's stock variants in `halo3\game_variants`, decoded by the app. Settings it can't read are left empty, which means "as the game type has it".
- **Script events** with simple values can be edited in forms. Formula-based actions and version 2 `logic` are kept exactly as written.
- **Map pictures:** stock map previews are decoded from MCC's own texture packs (`Data/ui/texturepacks/levelstexturepack`) the first time they're needed, and cached in `%APPDATA%\Halo 3 Server Manager\map-previews`. To use your own picture for a map, put `<file>.png` (for example `riverworld.png`) in the map images folder (Settings tab). Mod maps use the pictures their authors ship.
- **App data:** `%APPDATA%\Halo 3 Server Manager\` holds settings, the mod cache, the upload manifest and the embedded browser's Steam login. Settings → **Clear Steam login** signs out.

## Development

| Command | What it does |
|---|---|
| `npm start` | Run the app. Works from VS Code's terminal: the launcher clears `ELECTRON_RUN_AS_NODE`. |
| `npm test` | Unit tests: VDF parser, `dedicated.toml` patcher, script model, MCC map previews, stock variant defaults, reserved slots checks. |
| `npm run smoke` | Launch, print renderer console output, quit. `SMOKE_SCRIPT=<file.js>` runs a script in the page; `SMOKE_SHOT=<file.png>` saves a screenshot. |
| `npm run icon` | Re-render `build/icon.png` from `build/icon.svg`. |
| `npm run dist` | Build the portable exe into `out/`. Attach it to a GitHub release to publish it. |

Layout:

```
src/main/       Electron main process: settings, Steam discovery (vdf.js, steam.js), mods.js,
                workspace.js, toml-patch.js, server-config.js, export.js, assets.js
src/renderer/   UI (plain ES modules, no bundler): app.js, tabs/, components/, lib/, styles/
scripts/        Dev launcher, icon renderer, and the build hook that drops unused Electron DLLs
src/catalog/    Data the forms are built from: maps, server settings, game type rules/options, limits
docs/theme.md   Where the theme's fonts, colours and art come from
```

## License

[MIT](LICENSE). Halo is a trademark of Microsoft; this project is not affiliated with Microsoft, 343 Industries or Project Reclaimer.
