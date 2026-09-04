# Tier Board

A FigJam plugin for building tier boards (ranking tables, like the ones on tiermaker.com).

The things you rank are **plain FigJam stickies**. This plugin only manages the rows: it never creates stickies for you and never aggregates anything.

FigJam only — `editorType` is `["figjam"]`, and the plugin cannot create stickies in a Figma design file anyway.

## What it does

| | |
| --- | --- |
| Create board | Lays out five rows, S / A / B / C / D. Any number of boards per page |
| Move the table | A board is one section; grab it and the whole table moves |
| Add / delete rows | Deleting a row keeps its stickies, moving them onto the canvas |
| Rename | Rename a row |
| Colour | Pick a row colour from a preset list |
| Reorder | Drag a row up or down on the canvas, or use ↑↓ / ⠿ in the panel |
| Pack left | Items in a row pack to the top left; where you drop one is its rank |
| Resize | Drag the board's corner to scale it, or the right edge of any row for width alone |
| Board name | Name a board; the name also appears as a heading on the canvas |
| Palette | Light or dark, seeded from the lightness of the canvas background |

## Design notes

Most of these are things that only became clear after being wrong about them.

### Boards and rows

- A board is a `SectionNode` and so is every row; rows live inside the board section, which is what makes the whole table draggable.
- Sections adopt whatever overlaps them, so membership is a question of `parent` alone, and plugin-made and hand-made stickies are treated alike.
- **Adoption only happens on an editor drag.** Moving a node through the plugin API never triggers it — a sticky placed exactly over a row keeps the page as its parent. So whether a drop lands in the inner row or the outer board is decided by the editor and cannot be probed from a plugin; both are handled. Items that land on a board but in no row are adopted by the row they overlap.
- Rows found outside a board section go back to the board they belong to. **Rows cannot be locked**: `locked` applies to children too ("An object is locked if `.locked == true` for itself or **any** of its parents"), so locking a row would make its stickies unpickable and defeat the point.
- **Dropping one row onto another makes the dragged section swallow the other's contents**, tier label and stickies included. Strays are sent home: a tier label carries its owner row id, and a sticky carries the row it last belonged to. Without owners the stolen label passes as the thief's own, the robbed row builds a replacement, and two rows end up showing the same letter.
- Stickies only go home **right after a row was moved**. Returning them when a person moved a sticky themselves would make tiering impossible.
- New boards are placed below existing content. At the viewport centre the rows would land on top of existing stickies and adopt them.

### Order

- **Row order and the order within a row are both read off the canvas.** Nothing is stored. Whatever was dragged into place is the truth, which is why reordering never needs to be reconciled with a saved list.
- Rows are compared by vertical centre. Comparing top edges would require dragging a row further than its own height before anything changed.
- Restacking is relative to the board section and never moves the board, so reordering leaves the table where it is — including where a user dragged it.
- **Never order items by horizontal centre alone.** Once a row wraps, the leftmost item of the second line sits at the same x as the leftmost of the first, the lines interleave differently on every pass, and the row reflows forever.
- **Lines are detected by top edge, not centre.** Items on a line share a top edge once arranged, whereas a tall sticky shifts the centre far enough to be read as its own line — the same endless reflow.
- The default row is wide enough for exactly ten 240px stickies (2964px). Anything past that wraps and grows the row.

### Auto-arrange

- Changes are picked up on **both** `figma.currentPage.on('nodechange')` and `figma.on('documentchange')`. Betting on one channel means auto-arrange dies silently if that channel delivers nothing. Duplicate delivery is harmless: targets dedupe and the debounce coalesces. `documentAccess: "dynamic-page"` makes `documentchange` wait on `loadAllPagesAsync`, so it is subscribed after that resolves while `nodechange` goes on synchronously — otherwise edits made during the load would be lost. A FigJam file has one page, so there is little to load.
- If neither channel subscribes, the panel says so. Nothing on the canvas would ever be picked up in that case, and the alternative — a silently dead auto-arrange — took a long time to diagnose once already.
- **Only rows that changed are rearranged.** Rearranging untouched rows makes ranks look like they reshuffle themselves whenever a different row is touched.
- Own writes are told apart from a person's edit by **comparing the parent, position and size the last arrange wrote** against the current values. Ignoring a window of time instead drops every sticky moved inside that window.
- **The stamp includes the parent.** Rows are stacked at identical sizes, so position and size alone give (324,24)-in-A and (324,24)-in-S the same stamp, and a sticky dragged exactly one row straight up would pass as the plugin's own echo.
- **Never test for a deleted node with `'removed' in node`.** `BaseNodeMixin` declares `readonly removed: boolean` too, so it is true for live nodes as well; every change is taken for a deletion and no arrange ever runs. Read the value. `'node' in change` is the same trap — switch on `change.type` instead.
- A sticky drag is debounced by 320ms; a row drag waits 420ms, so a reorder cannot cut in while the row is still held.
- `origin: 'REMOTE'` is ignored. Reacting to it would have every collaborator fighting over the same rows.

### Resizing

- Dragging the board's corner scales it: width decides how many items fit on a line, height is spread evenly over the rows. `RowMetrics` already parameterised `labelWidth` and `minHeight`, so this is a per-board metrics object rather than a new layout path.
- The tier label is a square whose side is the row height, so a taller board reads as zoomed rather than stretched. A side effect worth knowing: a taller board fits *fewer* items per line, because the label takes more width.
- The board's own size wins over the per-row width. Dragging the corner is the more direct gesture, and the row edge still works for whoever grabs that instead.
- **The floor is what the contents need, not the height of a sticky.** An empty board shrinks to 96px rows; one holding stickies stops at 288px (240 plus padding). Clamping to 288 either way left shrinking indistinguishable from snapping back to the 300px default.
- The tier letter is sized against its cell. At a fixed 96px it would overflow a shrunken one.
- **A large shrink has to be read from the change event.** It pushes the lower rows out of the section, and returning those strays resizes the container back to fit them before the arrange looks at it — so the size the user dragged to no longer exists by then. Without capturing it on arrival, small drags work and large ones appear to do nothing. Removing the capture also stops the arrange from converging at all.

### Palette

- **Canvas fills are document data, so colours cannot follow each viewer's editor theme.** Everyone sees the same board. Figma has the same constraint: its theme setting only picks the default background of *new* files (light `#F5F5F5`, dark `#1E1E1E`), leaving existing files alone.
- So the palette is a per-board choice, seeded from `figma.currentPage.backgrounds`. That beats the editor theme: the main thread cannot read the theme at all (only the UI iframe can, via a `figma-dark` / `figma-light` class), and a hand-painted background is what is actually on screen. FigJam's light default measures `#E5E5E5`.
- Lightness is judged by sRGB relative luminance. A plain average underrates green and reads a pure green background as dark.
- The light face is brighter than the canvas (`#FFFFFF`) so the board reads as a card; matching the canvas would leave nothing but the row borders visible.
- Tier colours are pastel and stay the same on either palette.
- Boards created before palettes existed keep the dark default rather than being recoloured the moment the plugin opens.
- Variable modes are no help: `setExplicitVariableModeForCollection` is explicit by name, a document-side choice, never resolved per viewer.

### Deleting

- Removing a section takes its children with it, so a row's contents move out first — onto the page, below all page content. Left inside the board, or directly beneath it, a restacked row or the next board down would adopt them.
- A board with no rows left goes away entirely, heading included.

### Known limits

- Two people editing the same row at once can conflict.
- The panel is visible only to whoever ran the plugin; the sections it creates are visible to everyone.
- FigJam draws a section's name above it, so a tier letter shows both inside its coloured cell and above the row. There is no API to hide it.

## Development

```sh
npm install
npm run build      # production build (minified)
npm run build:test # unminified, used by the tests
npm run watch
npm test           # build, then run every test
npm run test:watch
npm run typecheck  # src + test
```

Import `manifest.json` (generated by the build) through **Plugins → Development → Import plugin from manifest…** in the Figma desktop app. The plugin makes no network requests (`networkAccess.allowedDomains: ["none"]`).

### Stack

Built with [create-figma-plugin](https://yuanqing.github.io/create-figma-plugin/) (esbuild). Plain `tsc` with `module: "none"` cannot use `import`, which rules out splitting the domain into modules.

- **main** (`src/main.ts`) — the adapter that reads and writes Figma nodes. create-figma-plugin invokes its default export.
- **domain** (`src/domain/*`) — no Figma imports. Rectangles in, rectangles out.
- **UI** (`src/ui.tsx`) — Preact with `@create-figma-plugin/ui`; colours come from Figma's theme variables.
- **events** (`src/events.ts`) — event names and payloads declared once, so `emit` / `on` are typed and a misspelling fails to compile.

`manifest.json` is generated; the configuration lives under the `figma-plugin` key of `package.json`.

### Tests

Two layers.

**Domain tests** (`test/domain/*`) need no mock. Rectangles in, rectangles out — 23 of them run in 7ms. Layout convergence and line detection are pinned here directly.

**Adapter tests** (`test/*.test.ts`) use `test/harness.ts`, a minimal mock of the Plugin API, and load the built `build/main.js` in a `vm`, driving it with UI events. Section adoption is approximated, nesting included, so membership, rescue-on-delete and moving the whole table can all be checked without Figma.

**Keep the mock shaped like the real API.** A node carries `removed` (`false`) while alive; a sticky carries plugin data. Both of those details were wrong in the mock, and both let a real bug pass every test. `ModeledSceneProps` in the harness is checked against the real types, so dropping a modelled property now fails to compile.

## Layout

```
package.json           manifest configuration under the figma-plugin key
src/main.ts            the Figma adapter
src/domain/layout.ts   reading order and wrapping
src/domain/order.ts    row order, board width, row names
src/domain/queue.ts    what the next arrange should touch, and when
src/domain/color.ts    tier colours
src/domain/theme.ts    board palettes and the choice from the canvas background
src/events.ts          main <-> UI event declarations
src/ui.tsx             the panel
src/ui.css             what is specific to the tier board
test/harness.ts        the Plugin API mock
test/domain/*.test.ts  domain tests, no mock
test/*.test.ts         adapter tests, through the harness
```
