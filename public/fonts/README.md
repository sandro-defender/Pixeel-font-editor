# Local reference fonts

Drop your reference `.ttf` or `.otf` files in this folder (subfolders are fine).
Run `npm run fonts:catalog` and refresh Pixeel; the glyph designer will list them
by filename. The normal app build also scans this folder automatically, so a
Pages/production build always includes the catalog. The browser cannot enumerate
a static folder on its own, which is why the small `catalog.json` is generated.

Example: put `MyGeorgian.ttf` here, then run `npm run fonts:catalog`. Its picker
name will be **MyGeorgian**. The generated catalog can be edited to customize a
picker label if desired; rerunning the command restores the filename-derived
catalog. Font files are ordinary project assets, so only commit/distribute fonts
you have permission to use.

You can also use **Add font file…** in the designer to preview a font directly
from your computer without copying it into this folder. Reference fonts are
loaded locally by the browser; they are not uploaded to a server.
