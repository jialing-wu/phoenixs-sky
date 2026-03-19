/**
 * Compute column layout for overlapping events.
 * Returns a map of event.id → { col, totalCols }
 * so each event can be positioned as:
 *   left: (col / totalCols * 100)%
 *   width: (1 / totalCols * 100)%
 */

interface TimeRange {
  id: string;
  startMin: number;
  endMin: number;
}

export interface LayoutInfo {
  col: number;
  totalCols: number;
}

export function layoutOverlapping(
  items: TimeRange[]
): Map<string, LayoutInfo> {
  if (items.length === 0) return new Map();

  // Sort by start, then by longer duration first
  const sorted = [...items].sort((a, b) =>
    a.startMin !== b.startMin
      ? a.startMin - b.startMin
      : (b.endMin - b.startMin) - (a.endMin - a.startMin)
  );

  // Find connected groups of overlapping events
  const groups: TimeRange[][] = [];
  let currentGroup: TimeRange[] = [sorted[0]];
  let groupEnd = sorted[0].endMin;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMin < groupEnd) {
      // Overlaps with current group
      currentGroup.push(sorted[i]);
      groupEnd = Math.max(groupEnd, sorted[i].endMin);
    } else {
      groups.push(currentGroup);
      currentGroup = [sorted[i]];
      groupEnd = sorted[i].endMin;
    }
  }
  groups.push(currentGroup);

  // Assign columns within each group
  const result = new Map<string, LayoutInfo>();

  for (const group of groups) {
    // Greedy column assignment
    const columns: TimeRange[][] = [];

    for (const item of group) {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (lastInCol.endMin <= item.startMin) {
          columns[c].push(item);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([item]);
      }
    }

    const totalCols = columns.length;
    for (let c = 0; c < columns.length; c++) {
      for (const item of columns[c]) {
        result.set(item.id, { col: c, totalCols });
      }
    }
  }

  return result;
}
