# Community assets

| File | Size | Where it goes |
| --- | --- | --- |
| `icon.png` | 128×128 | Plugin icon on the Community listing |
| `cover.png` | 1920×960 | Cover image on the Community listing |

Editable sources live in <https://www.figma.com/design/CVnPV1rkiUZyaO1om7cF0D>,
page `Tier Board assets`. Re-export at scale 1; both frames are already the
exact size the listing asks for.

The icon is the board reduced until it still reads at list size: three flush
rows, a pastel tier cell on the left of each, one sticky in the top row.

- The letters stay. Colour bars alone could be a chart or a palette rather than
  a tier list.
- The letters are Inter Medium, matching the plugin. A tier label is a FigJam
  `ShapeWithText` left at its default weight, and the plugin never changes it,
  so anything heavier here would misrepresent the product.
- The cells take half the width. Narrower ones left the icon mostly dark, and
  the letters too small to survive being shown at 32px.
- Checked by downscaling to 48px and 32px, which is the size the listing and the
  in-editor plugin menu actually use.
