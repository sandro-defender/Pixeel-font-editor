# Test fixtures

- `Lato-Regular.ttf` — Lato by Łukasz Dziedzic, from the google/fonts
  repository (https://github.com/google/fonts, ofl/lato), licensed under the
  SIL Open Font License 1.1. Redistribution permitted by the OFL; see OFL.txt.
- `Lato-Regular.woff`, `Lato-Regular.woff2` — the Lato TTF above re-packaged with
  fontTools (`TTFont.flavor = 'woff'` / `'woff2'`, brotli), i.e. by a tool
  independent of this project. Same license as the TTF (OFL). Used to prove
  client-side WOFF/WOFF2 decoding against files Pixeel did not produce.
- `spleen-8x16.bdf` — Spleen 8×16 by Frederic Cambus (https://www.cambus.net/),
  licensed under the BSD 2-Clause license; see Spleen-LICENSE.txt. A genuine
  bitmap font used to verify pixel-font detection and lossless conversion
  against data that did not come out of Pixeel.
