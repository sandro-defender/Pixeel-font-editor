/** Metrics HUD overlay: live glyph metrics, toggled with H. */
import React, { useMemo } from 'react';
import { Box, Paper, Stack, Typography, Chip, Divider } from '@mui/material';
import { useStore } from '../state/store';
import type { Slot, GlyphDoc, FontDoc } from '../core/types';
import { Bitmap } from '../core/bitmap';
import { contourBoundsTight } from '../core/contours';

function computePixelStats(pixel: GlyphDoc['pixel']): { count: number; w: number; h: number; bbox?: { x0: number; y0: number; x1: number; y1: number } } | null {
  if (!pixel) return null;
  try {
    const bm = Bitmap.fromB64(pixel.width, pixel.height, pixel.cellsB64);
    let count = 0;
    let minX = pixel.width;
    let maxX = -1;
    let minY = pixel.height;
    let maxY = -1;
    for (let y = 0; y < bm.height; y++) {
      for (let x = 0; x < bm.width; x++) {
        if (bm.get(x, y)) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (count === 0) return { count: 0, w: pixel.width, h: pixel.height };
    return {
      count,
      w: pixel.width,
      h: pixel.height,
      bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
    };
  } catch {
    return null;
  }
}

function computeVectorBbox(glyph: GlyphDoc) {
  const bb = contourBoundsTight(glyph.contours);
  if (!bb) return null;
  return bb;
}

export function MetricsHUD(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const glyphId = useStore((s) => s.ui[slot].glyphId);
  const show = useStore((s) => s.ui[slot].showMetricsHud);
  const cursor = useStore((s) => s.ui[slot].cursor);
  const sel = useStore((s) => s.ui[slot].selectionRect);
  const zoom = useStore((s) => s.ui[slot].zoom);

  const glyph = useMemo(() => doc?.glyphs.find((g) => g.id === glyphId) ?? null, [doc, glyphId]);

  const pixelStats = useMemo(() => (glyph?.pixel ? computePixelStats(glyph.pixel) : null), [glyph]);
  const vectorBbox = useMemo(() => (glyph && glyph.contours.length ? computeVectorBbox(glyph) : null), [glyph]);

  if (!show) return null;
  if (!doc || !glyph) return null;

  const adv = glyph.advanceWidth;
  const lsb = glyph.leftSideBearing;
  const bboxWidth = pixelStats?.bbox ? pixelStats.bbox.x1 - pixelStats.bbox.x0 + 1 : vectorBbox ? Math.round(vectorBbox.xMax - vectorBbox.xMin) : null;
  const rsb = bboxWidth !== null ? adv - (lsb + bboxWidth * (glyph.pixel?.unitsPerCell ?? 1)) : null;

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 2,
        p: 1,
        minWidth: 220,
        maxWidth: 300,
        bgcolor: 'background.paper',
        opacity: 0.95,
        pointerEvents: 'none',
      }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            Metrics HUD
          </Typography>
          <Chip size="small" label="H" variant="outlined" sx={{ height: 16, fontSize: 10 }} />
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={`${zoom}×`} />
        </Stack>
        <Divider />
        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 0.5, fontSize: 12 }}>
          <Typography variant="caption" color="text.secondary">
            Advance:
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
            {adv} units
          </Typography>
          <Typography variant="caption" color="text.secondary">
            LSB:
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
            {lsb}
          </Typography>
          {rsb !== null && (
            <>
              <Typography variant="caption" color="text.secondary">
                RSB:
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {Math.round(rsb)}
              </Typography>
            </>
          )}
          {pixelStats && (
            <>
              <Typography variant="caption" color="text.secondary">
                Grid:
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {pixelStats.w}×{pixelStats.h}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Pixels:
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {pixelStats.count} lit
              </Typography>
              {pixelStats.bbox && (
                <>
                  <Typography variant="caption" color="text.secondary">
                    BBox:
                  </Typography>
                  <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                    {pixelStats.bbox.x0},{pixelStats.bbox.y0} → {pixelStats.bbox.x1},{pixelStats.bbox.y1} ({pixelStats.bbox.x1 - pixelStats.bbox.x0 + 1}×
                    {pixelStats.bbox.y1 - pixelStats.bbox.y0 + 1})
                  </Typography>
                </>
              )}
            </>
          )}
          {vectorBbox && (
            <>
              <Typography variant="caption" color="text.secondary">
                Vector BBox:
              </Typography>
              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                {Math.round(vectorBbox.xMin)},{Math.round(vectorBbox.yMin)} → {Math.round(vectorBbox.xMax)},{Math.round(vectorBbox.yMax)}
              </Typography>
            </>
          )}
          <Typography variant="caption" color="text.secondary">
            Cursor:
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
            {cursor ? `${cursor.x}, ${cursor.y}` : '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Selection:
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
            {sel ? `${sel.w}×${sel.h} @ ${sel.x},${sel.y}` : '—'}
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
          Press H to hide · G toggles grid · +/− zoom
        </Typography>
      </Stack>
    </Paper>
  );
}

export function computeMetricsForTest(glyph: GlyphDoc) {
  const adv = glyph.advanceWidth;
  const lsb = glyph.leftSideBearing;
  const pixelStats = glyph.pixel ? computePixelStats(glyph.pixel) : null;
  const vectorBbox = glyph.contours.length ? computeVectorBbox(glyph) : null;
  return { adv, lsb, pixelStats, vectorBbox };
}
