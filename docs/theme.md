# Theme notes

## What MCC ships
Checked in a Steam install of MCC (`steamapps\common\Halo The Master Chief Collection`).

| Asset | Where | Usable? |
|---|---|---|
| Menu fonts | `Data/ui/config/fontdefinition.xml` maps the title font to **Blender Halo Thick**, body to **Blender Halo**, and nav to **QTypeSquarePro-Light**. The font data itself is embedded in Scaleform files (`Data/ui/Screens/Fonts/fonts_*.gfx`). | No. These are licensed fonts and not loadable by a web page. They aren't installed in Windows either. |
| Halo 3 engine fonts | `halo3/maps/fonts/font_package_*.bin` | No. Engine bitmap fonts. |
| Menu backgrounds | `Data/ui/BackgroundVideos/Images/*.png`, 392×220 RGBA PNGs. Halo 3 ones: `Halo3.png` (Chief), `H3Vignette.png` (the Ark), plus `MainMenu.png` and `Multiplayer.png`. | **Yes.** Loaded at runtime from the user's own install and never copied into the app. |
| Map previews | `Data/ui/texturepacks/levelstexturepack.perm.bin` is a named index of 480-byte entries. Relative to each entry's `bf fa 43 8b` marker: name at +4, width at +52, height at +54, size at +72, offset at +80. The pixels are BC1 in `levelstexturepack.temp.bin`. Halo 3 maps are `H3MP_<NAME>` (316×160) and `H3MP_<NAME>_LARGE` (668×292). | **Yes.** `src/main/mcc-textures.js` decodes them; `assets.js` caches PNGs in `%APPDATA%\Halo 3 Server Manager\map-previews` and extracts them again after an MCC update. Images in `map-images\<file>.png` override them. |

## Decisions
- **Backdrop:** `H3Vignette.png` (the Ark), scaled to cover the window, blurred and darkened under a faint scanline/grid overlay. If MCC isn't found, the app uses a CSS-only gradient instead.
- **Fonts:** free OFL look-alikes, bundled in `src/renderer/fonts/` with their licences.
  - Headings, tabs and buttons: **Rajdhani** 500/600/700, uppercase, wide letter spacing (close to the squared Halo 3 menu lettering).
  - Body and form text: **Titillium Web** 300/400/600.
  - Each font stack lists `Conduit ITC` and `Blender Halo` first, so a user who has those installed gets them automatically.
- **Colours** (CSS variables in `theme.css`):

| Token | Value | Use |
|---|---|---|
| `--bg` | `#05101c` | window background |
| `--bg-2` | `#0c2236` | gradient end, inputs |
| `--panel` | `rgba(16, 38, 60, 0.78)` | panels and cards |
| `--panel-solid` | `#0f2438` | dialogs |
| `--border` | `#3f6f94` | panel borders |
| `--border-bright` | `#7ec8ff` | focus and active outline |
| `--text` | `#cfe6ff` | main text |
| `--text-muted` | `#86a9c8` | labels and help text |
| `--highlight` | `#7ec8ff` | selection glow |
| `--highlight-fill` | `rgba(126, 200, 255, 0.18)` | selected row and active tab |
| `--accent` | `#e8b04a` | Halo amber: unsaved markers, primary emphasis |
| `--danger` | `#d9534f` | delete, errors |
| `--success` | `#5cd17a` | success pills |
| `--warning` | `#f0c341` | warnings |

- **Shapes:** panels have a clipped top-left and bottom-right corner (`clip-path`), like Halo 3's menu frames. Controls have square corners. The selected list row gets a glowing bar across its full width.
