/** Tile preview: shows glyph repeated 3×3, useful for pattern fonts and borders. */
import React, { useEffect, useRef } from 'react';
import { Box, Paper, Stack, Typography, Chip, FormControlLabel, Checkbox } from '@mui/material';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { Bitmap } from '../core/bitmap';
import { computeTileStats } from '../core/wand';
import { paintBitmap, toRgba } from '../render/bitmapCanvas';
import { useTheme } from '@mui/material/styles';

export function TilePreview(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const glyphId = useStore((s) => s.ui[slot].glyphId);
  const theme = useStore((s) => s.theme);
  const show = useStore((s) => s.ui[slot].showTilePreview);
  const seamless = useStore((s) => s.ui[slot].seamlessMode ?? false);
  const setSeamless = useStore((s) => s.setSeamlessMode);
  const glyph = doc?.glyphs.find((g) => g.id === glyphId) ?? null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const muiTheme = useTheme();

  const ink = theme === 'dark' ? '#e8eaf2' : '#1c2030';
  const accent = muiTheme.palette.secondary.main;
  const panelBg = muiTheme.palette.background.default;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !glyph?.pixel || !show) return;
    try {
      const bm = Bitmap.fromB64(glyph.pixel.width, glyph.pixel.height, glyph.pixel.cellsB64);
      const tileW = bm.width;
      const tileH = bm.height;
      const cols = 3;
      const rows = 3;
      const cellSize = Math.max(1, Math.floor(120 / Math.max(tileW, tileH)));
      const W = tileW * cellSize * cols;
      const H = tileH * cellSize * rows;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = panelBg;
      ctx.fillRect(0, 0, W, H);

      // Draw 3x3 tiles
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const ox = tx * tileW * cellSize;
          const oy = ty * tileH * cellSize;
          // draw bitmap
          // We need to paint each tile manually because paintBitmap draws whole canvas
          for (let y = 0; y < tileH; y++) {
            for (let x = 0; x < tileW; x++) {
              if (bm.get(x, tileH - 1 - y)) {
                // y is from bottom, but canvas y from top
                ctx.fillStyle = ink;
                ctx.fillRect(ox + x * cellSize, oy + y * cellSize, cellSize, cellSize);
              }
            }
          }
          // seamless highlight: border pixels
          if (seamless) {
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            // highlight edge lit pixels
            for (let y = 0; y < tileH; y++) {
              for (let x = 0; x < tileW; x++) {
                if (!bm.get(x, tileH - 1 - y)) continue;
                const isEdge = x === 0 || x === tileW - 1 || y === 0 || y === tileH - 1;
                if (isEdge) {
                  ctx.strokeStyle = 'rgba(255, 100, 100, 0.9)';
                  ctx.strokeRect(ox + x * cellSize + 0.5, oy + y * cellSize + 0.5, cellSize - 1, cellSize - 1);
                }
              }
            }
            ctx.setLineDash([]);
          }
        }
      }

      // Draw grid between tiles
      ctx.strokeStyle = 'rgba(128,128,128,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < cols; i++) {
        const x = i * tileW * cellSize + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let i = 1; i < rows; i++) {
        const y = i * tileH * cellSize + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();
    } catch {
      // ignore
    }
  }, [glyph, show, seamless, ink, accent, panelBg]);

  if (!show) return null;
  if (!glyph?.pixel) return null;

  const bm = (() => {
    try {
      return Bitmap.fromB64(glyph.pixel!.width, glyph.pixel!.height, glyph.pixel!.cellsB64);
    } catch {
      return null;
    }
  })();

  const edgeCount = (() => {
    if (!bm) return 0;
    let c = 0;
    for (let y = 0; y < bm.height; y++) {
      for (let x = 0; x < bm.width; x++) {
        if (bm.get(x, y) && (x === 0 || x === bm.width - 1 || y === 0 || y === bm.height - 1)) c++;
      }
    }
    return c;
  })();

  return (
    <Paper sx={{ p: 1, display: 'inline-flex', flexDirection: 'column', gap: 0.75, alignItems: 'center' }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          Tile preview 3×3
        </Typography>
        <Chip size="small" label={`${glyph.pixel.width}×${glyph.pixel.height}`} />
      </Stack>
      <Box
        component="canvas"
        ref={canvasRef}
        sx={{ display: 'block', border: 1, borderColor: 'divider', borderRadius: 1, imageRendering: 'pixelated' }}
        aria-label="Tile preview 3x3"
      />
      <FormControlLabel
        control={<Checkbox size="small" checked={seamless} onChange={(e) => setSeamless(slot, e.target.checked)} />}
        label={<Typography variant="caption">Seamless highlight ({edgeCount} edge pixels)</Typography>}
      />
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, maxWidth: 200, textAlign: 'center' }}>
        Shows how glyph tiles. Seamless mode highlights edge pixels that connect to neighbors.
      </Typography>
    </Paper>
  );
}

