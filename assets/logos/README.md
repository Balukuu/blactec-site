# Client logos — drop-in folder

The logo wall in the **"Built for businesses like yours"** section loads each logo from
this folder. Until a matching file exists, the site automatically shows a styled text
wordmark instead (handled by `LogoWall` in `src/main.ts`), so the page never shows a
broken-image icon.

## How to add a logo

Save each client logo here using the **exact filename** below. Prefer a transparent
**PNG** or **SVG** (the CSS scales it to ~64px tall and applies a grayscale→colour hover).

| Filename                     | Client                              |
|------------------------------|-------------------------------------|
| `avenue-insurance.png`       | Avenue Insurance Brokers            |
| `stallion-insurance.png`     | Stallion Insurance Brokers Limited  |
| `phs-africa.png`             | PHS-Africa                          |
| `reliance-chemicals.png`     | Reliance Chemicals                  |
| `golden-marketing.png`       | Golden Marketing                    |
| `kaniz-apartments.png`       | Kaniz Apartments                    |

These six clients also appear in the testimonial switcher above the logo wall.

## Using a different format (SVG / WEBP)

If you save an SVG instead of a PNG, update the matching `<img src="...">` in
`index.html` (inside `<div class="logowall" id="logoWall">`) to point at the new
extension — e.g. `assets/logos/golden-marketing.svg`.

## Adding or removing a client

Add/remove the corresponding `<div class="logowall__item">…</div>` block in
`index.html`, and (optionally) a `<button class="trust__tab">` + matching
`<div class="trust__panel">` if the client should also appear in the testimonial switcher.
Keep the `id`/`aria-controls` pairs (`tt-N` ↔ `tp-N`) sequential.
