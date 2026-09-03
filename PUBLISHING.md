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

Five at most, comma or tab separated. Paste:

```
tier list, ranking, prioritization, workshop, sticky notes
```

With only five slots, each one should buy a different way in rather than another
phrasing of the same one.

| Tag | What it reaches |
| --- | --- |
| `tier list` | the name of the thing, and what someone already looking will type |
| `ranking` | the same intent worded differently, which is common enough to be worth a slot of its own |
| `prioritization` | people with work to order who would never search for a tier list |
| `workshop` | facilitators browsing for something to run a session with |
| `sticky notes` | what the plugin actually operates on, which is what sets it apart |

Left out, and why:

- `tier list maker` — nearly the same string as `tier list`. If tags match as
  whole phrases it only catches that exact wording; if they are tokenised it is
  redundant. Either way it spends a slot on nothing.
- `sorting` — too broad. It competes with layout and sorting plugins and would
  disappoint whoever arrives.
- `facilitation` — overlaps `workshop`, which is the more common search.
- `tiermaker` — someone else's brand. Trading on it invites the confusion the
  name `Tier Board` was chosen to avoid, and a review can object.
- `voting` — tier boards do get used to vote, but the plugin counts nothing, and
  a tag that implies a missing feature sets up the wrong expectation.
- `figjam` — redundant; the listing is already filtered by editor.

## After submitting

- [ ] Tag the release in git so the published build is identifiable.
- [ ] Note the listing URL in `README.md`.
