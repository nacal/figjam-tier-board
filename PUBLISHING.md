# Publishing to the Figma Community

Publishing happens in the **Figma desktop app**: click the Figma logo (upper
left) → **Plugins** → **Manage plugins** → this plugin → publish. There is no
API or CLI for it, so the steps below are for a person to carry out.

A submission is reviewed by Figma before it appears publicly. Approval times
vary; if the security disclosure form is involved, that review alone can take up
to two weeks.

## Before submitting

- [ ] `npm test` passes and `npm run typecheck` is clean.
- [ ] `npm run build` (the minified build, not `build:test`).
- [ ] **Import the built `manifest.json` and use the plugin on a real FigJam
      board.** Create a board, drop stickies in, reorder rows, resize the board,
      switch the palette, name a board. The plugin id changed to
      `figjam-tier-board`, so remove any older copy from Plugins → Development
      first to avoid running the wrong one.
- [ ] Check the panel renders and every control works. This is the one thing
      that automated tests cannot cover: they drive the plugin through UI events
      and never render the panel.

## Listing fields

| Field | Value |
| --- | --- |
| Name | Tier Board |
| Tagline | Rank anything with plain FigJam stickies |
| Category | Design tools |
| Icon | `assets/icon.png` (128×128) |
| Thumbnail | `assets/cover.png` (1920×1080) |
| Support contact | *fill in an address you are willing to publish* |
| Publisher | *yourself, or the team/organization* |
| Playground file | optional — a FigJam file with a pool of stickies ready to rank |

### Description

> Tier Board makes the rows of a tier list and leaves the ranking to you.
>
> The things you rank are plain FigJam stickies. Write them with FigJam itself,
> drag them into a row, and they pack to the left in the order you dropped them
> — the position you drop something in is its rank. Drag a sticky onto another
> and they trade places.
>
> **What it does**
>
> - Creates a board of five rows, S through D. Add, delete, rename and recolour
>   rows, and put as many boards on a page as you like.
> - Packs each row from the left as you drag, so a row never needs tidying.
>   Turn it off if you would rather place things by hand.
> - Reorder rows by dragging them up and down on the canvas, or from the panel.
> - The board is one section: grab it to move the whole table, or drag its
>   corner to scale it.
> - Name a board and the name appears as a heading on the canvas, so everyone
>   looking at the file can see it.
> - Picks a light or dark palette from the canvas it is created on, and lets you
>   switch.
>
> Nothing leaves your file — the plugin makes no network requests.

## After submitting

- [ ] Tag the release in git so the published build is identifiable.
- [ ] Note the listing URL in `README.md`.
