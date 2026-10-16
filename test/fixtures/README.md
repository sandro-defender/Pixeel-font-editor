# Test fixtures

- `Lato-Regular.ttf` — Lato by Łukasz Dziedzic, from the google/fonts
  repository (https://github.com/google/fonts, ofl/lato), licensed under the
  SIL Open Font License 1.1. Redistribution permitted by the OFL; see OFL.txt.
- `Lato-Regular.woff`, `Lato-Regular.woff2` — the Lato TTF above re-packaged with
  fontTools (`TTFont.flavor = 'woff'` / `'woff2'`, brotli), i.e. by a tool
  independent of this project. Same license as the TTF (OFL). Used to prove
  client-side WOFF/WOFF2 decoding against files Pixeel did not produce.
- `Quantico-Bold.ttf` — Quantico by Matthew Desmond (madtype), from the
  google/fonts repository (https://github.com/google/fonts, ofl/quantico),
  licensed under the SIL Open Font License 1.1; see OFL-Quantico.txt. One of
  the fonts the ESPHome MAX7219 matrix clock ships. It carries the three cmap
  subtables a classic font tool writes — Unicode (0,3) format 4, **legacy
  Macintosh (1,0) format 0** and Windows (3,1) format 4 — and a `post`
  format-2 table with real glyph names, which is what makes it the fixture for
  reading code points from the Unicode subtables only.
- `spleen-8x16.bdf` — Spleen 8×16 by Frederic Cambus (https://www.cambus.net/),
  licensed under the BSD 2-Clause license; see Spleen-LICENSE.txt. A genuine
  bitmap font used to verify pixel-font detection and lossless conversion
  against data that did not come out of Pixeel.
