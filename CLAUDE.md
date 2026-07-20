# Mapping_Movement_ARTIFACT_BBALL — GitHub Pages deploy folder

This folder is the git working copy for https://github.com/agizzie1/Mapping_Movement_ARTIFACT_BBALL
(published, once Pages is enabled, at https://agizzie1.github.io/Mapping_Movement_ARTIFACT_BBALL/).
It's the men's basketball counterpart to the football/`Mapping_Movement_ARTIFACT`
repo, same 4-file split format.

It holds five files, all required together:
- `index.html` — markup, links `style.css`, loads D3 v7 from CDN, then
  `player-search.js`, then `viz.js` (in that order — `viz.js`'s `boot()`
  calls into `player-search.js`, so it must load first)
- `style.css` — all styling
- `player-search.js` — the "search a player by name" feature (box, dropdown,
  click-to-highlight-ribbon, expandable prior-transfer history), factored
  out so it can be dropped into the football diagram's viz.js too. See the
  comment at the top of the file for the host contract a viz.js needs to
  satisfy to use it.
- `viz.js` — D3 rendering logic; fetches `chord_data.json` at load time
- `chord_data.json` — the basketball transfer-portal data (`{ "bball": {...} }`)

## Standing authorization

The user has pre-authorized committing and pushing to `origin/main` in this
repo whenever Claude edits one of the files above as part of a chat request
(e.g. tweaking `viz.js`/`player-search.js`, regenerating `chord_data.json`,
adjusting styling). No need to ask for confirmation before each push — just
push and tell the user it's done. This authorization is scoped to this repo
only. (Changed 2026-07-20 — this repo previously required asking every time,
unlike the football repo; the user removed that requirement and it now
matches the football repo's standing policy.)

If the source of truth for these files is regenerated elsewhere in the
parent project (`../build_chord_data.py` → `../chord_data.json`, or
`../viz.js` / `../chord_diagram_template.html`), copy the updated file(s)
into this folder before committing — this folder, not the parent directory,
is what's wired to GitHub Pages. When copying `../viz.js`, remember to swap
its last line `boot(CHORD_DATA);` for the fetch-based boot call this repo's
`viz.js` uses instead (see the bottom of the file).
