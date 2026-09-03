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

### Tags

The docs do not state whether tags are free-form or how many are allowed, so the
form is the authority. They are listed here in priority order — cut from the
bottom to fit whatever limit it imposes.

1. `tier list` — the name of the thing being made, and what someone will type
2. `ranking`
3. `tier list maker`
4. `sticky notes` — what the plugin actually operates on
5. `prioritization` — how a team would use it rather than what it does
6. `sorting`
7. `workshop`
8. `facilitation`
9. `team ranking`

Two words left out on purpose:

- `tiermaker`, the brand behind tiermaker.com. Trading on it invites confusion
  and is the sort of thing a review can object to.
- `voting`. Tier boards do get used to vote, but the plugin counts nothing, and
  a tag that implies a feature it does not have sets up the wrong expectation.

`figjam` is redundant: the listing is already filtered by editor.

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
