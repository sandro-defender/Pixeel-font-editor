/**
 * A scrolling grid that only mounts the rows near the viewport. Large imported
 * fonts can contain thousands of glyphs; rendering them all would make every
 * edit and scroll slow. Before the container has a size (first paint, hidden
 * panes) every item is rendered so nothing is missing.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useElementSize } from './ui';

const PAD = 8;
const GAP = 6;
const OVERSCAN_ROWS = 3;

export function VirtualGrid<T>(props: {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  /** minimum width of one cell; the number of columns follows the container */
  minCellWidth?: number;
  cellHeight?: number;
  ariaLabel: string;
}) {
  const { items, itemKey, renderItem, minCellWidth = 78, cellHeight = 92 } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const { width, height } = useElementSize(scrollRef);

  const layout = useMemo(() => {
    const inner = Math.max(0, width - PAD * 2);
    const cols = Math.max(1, Math.floor((inner + GAP) / (minCellWidth + GAP)));
    const cellWidth = Math.max(0, (inner - GAP * (cols - 1)) / cols);
    const rowH = cellHeight + GAP;
    const rows = Math.ceil(items.length / cols);
    const totalHeight = rows === 0 ? PAD * 2 : PAD * 2 + rows * rowH - GAP;
    let first = 0;
    let last = rows - 1;
    if (height > 0) {
      first = Math.max(0, Math.floor((scrollTop - PAD) / rowH) - OVERSCAN_ROWS);
      last = Math.min(rows - 1, Math.ceil((scrollTop + height - PAD) / rowH) + OVERSCAN_ROWS);
    }
    return { cols, cellWidth, rowH, totalHeight, first, last };
  }, [width, height, scrollTop, items.length, minCellWidth, cellHeight]);

  const visible: React.ReactNode[] = [];
  for (let r = layout.first; r <= layout.last; r++) {
    for (let c = 0; c < layout.cols; c++) {
      const i = r * layout.cols + c;
      if (i >= items.length) break;
      const item = items[i];
      visible.push(
        <Box
          key={itemKey(item)}
          sx={{ position: 'absolute', left: PAD + c * (layout.cellWidth + GAP), top: PAD + r * layout.rowH, width: layout.cellWidth, height: cellHeight }}
        >
          {renderItem(item)}
        </Box>,
      );
    }
  }

  return (
    <Box
      ref={scrollRef}
      role="list"
      aria-label={props.ariaLabel}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      sx={{ flex: 1, minHeight: 120, overflowY: 'auto', position: 'relative', bgcolor: 'background.default' }}
    >
      <Box sx={{ position: 'relative', height: layout.totalHeight, width: '100%' }}>{visible}</Box>
    </Box>
  );
}
