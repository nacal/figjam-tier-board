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
      switch the palette, name a board. The id is now the one Figma assigned
      (`1677535397231689072`), so remove any older copy from Plugins →
      Development first to avoid running the wrong one.
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

## Security disclosure form

Answers verified against the code, not from memory. **Re-check them whenever
anything is added that talks to the network or stores data somewhere new.**

| Question | Answer |
| --- | --- |
| 1. Backend service? | No, I do not host a backend service |
| 2. Network requests to services you do not host? | Does not make any network requests |
| 3. User authentication? | No |
| 4. Store data read/derived from the plugin API? | Yes, locally (`figma.clientStorage`, `node.setPluginData`) |
| 5. Updates? | Solo developer |

Notes on the two that are easy to get wrong:

**Q2.** No `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon` or `EventSource`
in `src` or in either bundle, and `networkAccess.allowedDomains` is `["none"]`.
The only `http(s)` strings in the build are XML namespace identifiers Preact
uses for SVG and MathML, plus a comment URL inside a dependency — none of them
requests are made to.

**Q4 is not "No".** The plugin stores twelve `setPluginData` keys on nodes — row
and board identity, palette, width and row height, the row that owns a tier
label, the row a sticky last belonged to, and the board name a person typed —
plus one `figma.clientStorage` key for the auto-arrange toggle. Row ids come
from the plugin API and the board name is user input. All of it stays in the
file and on the machine; none of it leaves. The third option, storing somewhere
not covered by the above, stays unchecked.

**Q5.** There is no review gate on this repository; commits go straight to
`main`. "Reviewed by a separate person before publishing" would not be true.

## After submitting

- [ ] Tag the release in git so the published build is identifiable.
- [ ] Note the listing URL in `README.md`.
