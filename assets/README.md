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

Notes on the icon, which is the size-constrained one:

- The letters stay. Colour bars alone could be a chart or a palette rather than
  a tier list.
- The letters are Inter Medium, matching the plugin. A tier label is a FigJam
  `ShapeWithText` left at its default weight, and the plugin never changes it,
  so anything heavier here would misrepresent the product.
- The tier cell takes a third of the width, not half. Half left too little room
  for two stickies, which shrank them to 20px and made the row look crowded.
- Stickies are one size across the whole icon, taken from the row height and
  capped so the busiest row fits — as on a real board, where every sticky is the
  same size no matter how many share a row.
- Checked by downscaling to 48px and 32px, which is the size the listing and the
  in-editor plugin menu actually use.
