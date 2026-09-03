# Community assets

| File | Size | Where it goes |
| --- | --- | --- |
| `icon.png` | 128×128 | Plugin icon on the Community listing |
| `cover.png` | 1920×960 | Cover image on the Community listing |

Editable sources live in <https://www.figma.com/design/CVnPV1rkiUZyaO1om7cF0D>,
page `Tier Board assets`. Re-export at scale 1; both frames are already the
exact size the listing asks for.

Both show the board with stickies thinning out down the rows, which is what
reads as a ranking. The icon carries two in S and one in A; the cover runs
6/4/3/2/1. Sticky colours are the FigJam palette in the same order in both.

## Why light, not dark

FigJam's default canvas is light — `#F5F5F5` with a 24px dot grid, measured off
a real board — so the palette a new board picks up is the light one. Showing a
dark board would advertise something most people will not get.

The dotted ground is a 24×24 tile used as a `TILE` image fill, at
`scalingFactor: 1`. Placing individual dots would mean about 3,200 nodes on the
cover. Note that an upload defaults to `scalingFactor: 0.5`, which halves the
pitch; it has to be set explicitly.

## Notes on the icon

The icon is the size-constrained asset, so every choice here is about surviving
at 32–48px on a light background, which is where the listing and the in-editor
plugin menu show it.

- The board is inset from the frame. Run to the edge, its white rows dissolve
  into a light UI and only the coloured column is left floating.
- The letters stay. Colour bars alone could be a chart or a palette rather than
  a tier list.
- The letters are Inter Medium, matching the plugin. A tier label is a FigJam
  `ShapeWithText` left at its default weight, and the plugin never changes it,
  so anything heavier here would misrepresent the product.
- The tier cell takes a third of the width, not half. Half left too little room
  for two stickies, which shrank them and made the row look crowded.
- Stickies are one size across the whole icon, taken from the row height and
  capped so the busiest row fits — as on a real board, where every sticky is the
  same size no matter how many share a row.
- Checked by downscaling to 48px and 32px over white.
