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

## Push policy — ask every time (NOT auto-push)

Unlike the football `Mapping_Movement_ARTIFACT` repo, the user does **not**
want standing auto-push authorization here. Whenever Claude edits one of the
four files above (e.g. tweaking `viz.js`, regenerating `chord_data.json`,
adjusting styling), commit locally if useful, but always ask the user before
running `git push` to `origin/main` — even though the SSH remote is fully
configured and pushing is technically one command away. Wait for an explicit
yes each time.

If the source of truth for these files is regenerated elsewhere in the
parent project (`../build_chord_data.py` → `../chord_data.json`, or
`../viz.js` / `../chord_diagram_template.html`), copy the updated file(s)
into this folder before committing — this folder, not the parent directory,
is what's wired to GitHub Pages. When copying `../viz.js`, remember to swap
its last line `boot(CHORD_DATA);` for the fetch-based boot call this repo's
`viz.js` uses instead (see the bottom of the file).
