'use client';

import { useMemo, useRef, useCallback, useEffect } from 'react';
import styles from './MonthView.module.css';
import { CalendarEvent, CALENDAR_META } from '@/lib/mockData';
import { CalendarSource } from '@/lib/calendarConfig';

interface MonthViewProps {
  date: Date;
  events: CalendarEvent[];
  onDayClick: (date: Date) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onEventMove?: (id: string, newStart: string, newEnd: string) => void;
  onContextMenu?: (event: CalendarEvent, x: number, y: number) => void;
  showEditorial?: boolean;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CellData { date: Date; dateStr: string; isCurrentMonth: boolean; }

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00');
  const db = new Date(b + 'T12:00:00');
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function getMonthGrid(year: number, month: number): CellData[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const cells: CellData[] = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: d, dateStr: toDateStr(d), isCurrentMonth: false });
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const d = new Date(year, month, day);
    cells.push({ date: d, dateStr: toDateStr(d), isCurrentMonth: true });
  }

  while (cells.length % 7 !== 0 || cells.length < 35) {
    const d = new Date(year, month + 1, cells.length - startOffset - lastDay.getDate() + 1);
    cells.push({ date: d, dateStr: toDateStr(d), isCurrentMonth: false });
  }

  return cells;
}

interface ProcessedEvent {
  event: CalendarEvent;
  startDate: string;
  endInclusive: string;
  isMultiDay: boolean;
}

function processEvents(events: CalendarEvent[]): ProcessedEvent[] {
  return events.map(e => {
    const startDate = e.start.split('T')[0];
    const endDate = e.end.split('T')[0];
    let endInclusive = startDate;

    if (endDate > startDate) {
      const isDateOnly = !e.start.includes('T');
      if (isDateOnly) {
        const d = new Date(endDate + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        endInclusive = toDateStr(d);
      } else {
        endInclusive = endDate;
      }
    }

    return { event: e, startDate, endInclusive, isMultiDay: endInclusive > startDate };
  });
}

interface SpanBar {
  event: CalendarEvent;
  startCol: number;
  span: number;
  row: number;
}

type DragMode = 'move-single' | 'move-span' | 'resize-start' | 'resize-end';

interface DragState {
  mode: DragMode;
  event: CalendarEvent;
  originDateStr: string;     // date where drag started
  eventStartDate: string;    // original event start date
  eventEndDate: string;      // original event end date (exclusive for allDay, inclusive for timed)
  isDateOnly: boolean;
}

export default function MonthView({ date, events, onDayClick, onEventClick, onEventMove, onContextMenu, showEditorial }: MonthViewProps) {
  const cells = useMemo(() => getMonthGrid(date.getFullYear(), date.getMonth()), [date]);
  const todayStr = toDateStr(new Date());
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const hasDragged = useRef(false);

  const weeks = useMemo(() => {
    const w: CellData[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      w.push(cells.slice(i, i + 7));
    }
    return w;
  }, [cells]);

  const processed = useMemo(() => processEvents(events), [events]);

  const weekData = useMemo(() => {
    const multiDay = processed.filter(p => p.isMultiDay);
    const singleDay = processed.filter(p => !p.isMultiDay);

    const singleByDate: Record<string, CalendarEvent[]> = {};
    for (const p of singleDay) {
      if (!singleByDate[p.startDate]) singleByDate[p.startDate] = [];
      singleByDate[p.startDate].push(p.event);
    }

    return weeks.map(week => {
      const weekStart = week[0].dateStr;
      const weekEnd = week[6].dateStr;
      const bars: SpanBar[] = [];

      for (const p of multiDay) {
        if (p.endInclusive < weekStart || p.startDate > weekEnd) continue;
        const startCol = p.startDate <= weekStart ? 0 : week.findIndex(c => c.dateStr === p.startDate);
        const endCol = p.endInclusive >= weekEnd ? 6 : week.findIndex(c => c.dateStr === p.endInclusive);
        if (startCol < 0 || endCol < 0) continue;
        const span = endCol - startCol + 1;

        let row = 0;
        const occupied = new Set<number>();
        for (const b of bars) {
          const bEnd = b.startCol + b.span - 1;
          if (startCol <= bEnd && endCol >= b.startCol) occupied.add(b.row);
        }
        while (occupied.has(row)) row++;

        bars.push({ event: p.event, startCol, span, row });
      }

      return { week, bars, singleByDate };
    });
  }, [processed, weeks]);

  // Find which date a mouse position corresponds to
  const getDateFromPoint = useCallback((clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    // Walk up to find data-date attribute
    let node: Element | null = el;
    while (node && !node.getAttribute('data-date')) {
      node = node.parentElement;
    }
    return node?.getAttribute('data-date') || null;
  }, []);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent, mode: DragMode, event: CalendarEvent, originDateStr: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const startDate = event.start.split('T')[0];
    const endDate = event.end.split('T')[0];
    const isDateOnly = !event.start.includes('T');

    dragRef.current = {
      mode,
      event,
      originDateStr,
      eventStartDate: startDate,
      eventEndDate: endDate,
      isDateOnly,
    };
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    hasDragged.current = false;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current || !dragStartPos.current) return;
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        hasDragged.current = true;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      dragStartPos.current = null;

      if (!drag || !onEventMove) return;

      if (!hasDragged.current) {
        // It was a click, not a drag
        if (onEventClick) onEventClick(drag.event);
        return;
      }

      const targetDate = getDateFromPoint(e.clientX, e.clientY);
      if (!targetDate) return;

      const { mode, event, originDateStr, eventStartDate, eventEndDate, isDateOnly } = drag;

      if (mode === 'move-single' || mode === 'move-span') {
        const dayDelta = daysBetween(originDateStr, targetDate);
        if (dayDelta === 0) return;

        const newStartDate = addDays(eventStartDate, dayDelta);
        const newEndDate = addDays(eventEndDate, dayDelta);

        if (isDateOnly) {
          onEventMove(event.id, newStartDate, newEndDate);
        } else {
          // Preserve time part
          const timePart = event.start.substring(10); // includes T and timezone
          const endTimePart = event.end.substring(10);
          onEventMove(event.id, newStartDate + timePart, newEndDate + endTimePart);
        }
      } else if (mode === 'resize-end') {
        // Extend/shrink end date
        if (targetDate <= eventStartDate) return;
        if (isDateOnly) {
          // allDay end is exclusive: targetDate is the last visible day, so end = targetDate + 1
          onEventMove(event.id, event.start, addDays(targetDate, 1));
        } else {
          const endTimePart = event.end.substring(10);
          onEventMove(event.id, event.start, targetDate + endTimePart);
        }
      } else if (mode === 'resize-start') {
        // Extend/shrink start date
        const endInc = isDateOnly ? addDays(eventEndDate, -1) : eventEndDate;
        if (targetDate >= endInc) return;
        if (isDateOnly) {
          onEventMove(event.id, targetDate, event.end);
        } else {
          const timePart = event.start.substring(10);
          onEventMove(event.id, targetDate + timePart, event.end);
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onEventMove, onEventClick, getDateFromPoint]);

  const MAX_BARS = 2;

  return (
    <div className={`${styles.outerGrid} ${showEditorial ? styles.editorialMode : ''}`}>
    <div className={styles.container} ref={containerRef}>
      <div className={styles.dayNames}>
        {DAY_NAMES.map(n => <div key={n} className={styles.dayNameCell}>{n}</div>)}
      </div>
      <div className={styles.weeksContainer}>
        {weekData.map(({ week, bars, singleByDate }, wi) => {
          const visibleBars = bars.filter(b => b.row < MAX_BARS);

          return (
            <div key={wi} className={styles.weekRow}>
              {/* Date numbers row */}
              <div className={styles.dateRow}>
                {week.map((cell, ci) => {
                  const isToday = cell.dateStr === todayStr;
                  return (
                    <div
                      key={ci}
                      data-date={cell.dateStr}
                      className={cell.isCurrentMonth ? styles.dateCell : styles.dateCellOther}
                      onClick={() => onDayClick(cell.date)}
                      style={{ cursor: 'pointer' }}
                    >
                      <span className={isToday ? styles.cellDateToday : styles.cellDate}>
                        {cell.date.getDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Spanning bars below dates */}
              <div className={styles.barsArea}>
                {visibleBars.length > 0 && (
                  <div className={styles.barsGrid}>
                    {visibleBars.map(bar => {
                      const meta = CALENDAR_META[bar.event.calendar as CalendarSource];
                      return (
                        <div
                          key={`${bar.event.id}-${wi}`}
                          className={styles.spanBar}
                          data-date={week[bar.startCol].dateStr}
                          style={{
                            gridColumn: `${bar.startCol + 1} / span ${bar.span}`,
                            gridRow: bar.row + 1,
                            backgroundColor: `color-mix(in srgb, ${meta.color} var(--event-bg-mix), var(--bg))`,
                            borderLeft: `3px solid ${meta.color}`,
                          }}
                          onMouseDown={(e) => handleMouseDown(e, 'move-span', bar.event, week[bar.startCol].dateStr)}
                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(bar.event, e.clientX, e.clientY); }}
                        >
                          {/* Resize handle: start */}
                          <div
                            className={styles.spanResizeLeft}
                            onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'resize-start', bar.event, week[bar.startCol].dateStr); }}
                          />
                          <span className={styles.spanBarTitle} style={{ color: meta.color }}>{bar.event.title}</span>
                          {/* Resize handle: end */}
                          <div
                            className={styles.spanResizeRight}
                            onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'resize-end', bar.event, week[Math.min(bar.startCol + bar.span - 1, 6)].dateStr); }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* Single-day events */}
              <div className={styles.dayCells}>
                {week.map((cell, ci) => {
                  const dayEvents = singleByDate[cell.dateStr] || [];
                  const barsInCol = bars.filter(b => ci >= b.startCol && ci < b.startCol + b.span).length;
                  const extraHidden = barsInCol > MAX_BARS ? barsInCol - MAX_BARS : 0;
                  const totalMore = extraHidden + Math.max(0, dayEvents.length - 3);

                  return (
                    <div
                      key={ci}
                      data-date={cell.dateStr}
                      className={cell.isCurrentMonth ? styles.cell : styles.cellOtherMonth}
                      onClick={() => onDayClick(cell.date)}
                      style={{ cursor: 'pointer' }}
                    >
                      {dayEvents.slice(0, 3).map(e => {
                        const meta = CALENDAR_META[e.calendar as CalendarSource];
                        return (
                          <div
                            key={e.id}
                            className={styles.cellEvent}
                            data-date={cell.dateStr}
                            onMouseDown={(ev) => handleMouseDown(ev, 'move-single', e, cell.dateStr)}
                            onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); onContextMenu?.(e, ev.clientX, ev.clientY); }}
                          >
                            <div className={styles.cellEventDot} style={{ backgroundColor: meta.color }} />
                            <span className={styles.cellEventTitle}>{e.title}</span>
                          </div>
                        );
                      })}
                      {totalMore > 0 && <div className={styles.cellMore}>+{totalMore} more</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    <div className={styles.editorial}>
      {(() => {
        const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const m = date.getMonth();
        const y = date.getFullYear();
        return (
          <>
            <div className={styles.editorialLabel}>{y}</div>
            <div className={styles.editorialBig} style={{ color: 'var(--accent)' }}>{MONTHS[m]}</div>
            <hr className={styles.editorialDivider} />
          </>
        );
      })()}
    </div>
    </div>
  );
}
