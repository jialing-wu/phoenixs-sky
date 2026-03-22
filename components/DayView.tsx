'use client';

import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import styles from './DayView.module.css';
import { CalendarEvent, CALENDAR_META, formatTime, getConferenceLabel } from '@/lib/mockData';
import { CALENDARS, CalendarSource } from '@/lib/calendarConfig';
import { layoutOverlapping } from '@/lib/layoutEvents';

interface DayViewProps {
  date: Date;
  events: CalendarEvent[];
  noteEvents?: CalendarEvent[];
  hiddenEvents?: Set<string>;
  colorOverrides?: Map<string, string>;
  taskLinks?: Map<string, string>;
  onToggleTask?: (eventId: string, done: boolean) => void;
  onEventClick: (event: CalendarEvent) => void;
  onSlotClick: (start: string, end: string) => void;
  onEventMove: (id: string, newStart: string, newEnd: string) => void;
  onEventResize: (id: string, newEnd: string) => void;
  onContextMenu?: (event: CalendarEvent, x: number, y: number) => void;
  showEditorial?: boolean;
}

const TOTAL_HOURS = 24;
const EARLY_END = 6;
const COLLAPSE_WEIGHT = 1;
const VISIBLE_HOURS = [0, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// Agent name → color for notes (check both romaji and kanji)
const AGENT_COLORS: Record<string, string> = {};
const AGENT_ALIASES: Record<string, string> = {};
for (const [, meta] of Object.entries(CALENDARS)) {
  if (meta.agent) AGENT_COLORS[meta.agent.toLowerCase()] = meta.color;
}

function getNoteAgentColor(title: string, description?: string): string | undefined {
  const text = `${title}\n${description || ''}`.toLowerCase();
  // Check romaji agent names
  for (const [agent, color] of Object.entries(AGENT_COLORS)) {
    if (text.includes(agent)) return color;
  }
  // Check kanji/kana aliases
  const fullText = `${title}\n${description || ''}`;
  for (const [alias, agent] of Object.entries(AGENT_ALIASES)) {
    if (fullText.includes(alias)) return AGENT_COLORS[agent];
  }
  return undefined;
}

function minutesToIso(baseDate: Date, minutes: number): string {
  const d = new Date(baseDate);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  // Return local ISO format instead of UTC to preserve timezone
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export default function DayView({ date, events, noteEvents, hiddenEvents, colorOverrides, taskLinks, onToggleTask, onEventClick, onSlotClick, onEventMove, onEventResize, onContextMenu, showEditorial }: DayViewProps) {
  // Use LOCAL date string (not UTC) to correctly handle timezone offsets
  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [pxPerMin, setPxPerMin] = useState(1);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight;
      if (h > 0) setPxPerMin(Math.max(0.25, h / (TOTAL_HOURS * 60)));
    };
    // Measure after layout settles (rAF + fallback timeout for tab-switch remount)
    const raf = requestAnimationFrame(measure);
    const timer = setTimeout(measure, 100);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); observer.disconnect(); };
  }, []);

  const totalWeight = COLLAPSE_WEIGHT + (TOTAL_HOURS - EARLY_END);
  const normalHourH = pxPerMin * 60 * TOTAL_HOURS / totalWeight;
  const collapsedH = normalHourH * COLLAPSE_WEIGHT;
  const normalPxPerMin = normalHourH / 60;
  const earlyPxPerMin = collapsedH / (EARLY_END * 60);

  function minToPx(minutes: number): number {
    const earlyMinutes = EARLY_END * 60;
    if (minutes <= earlyMinutes) return minutes * earlyPxPerMin;
    return earlyMinutes * earlyPxPerMin + (minutes - earlyMinutes) * normalPxPerMin;
  }

  function getHourH(h: number): number {
    return h === 0 ? collapsedH : normalHourH;
  }

  function pxToMin(y: number): number {
    const earlyPxTotal = EARLY_END * 60 * earlyPxPerMin;
    if (y <= earlyPxTotal) return y / earlyPxPerMin;
    return EARLY_END * 60 + (y - earlyPxTotal) / normalPxPerMin;
  }

  const dayEvents = useMemo(() =>
    events.filter(e => {
      if (e.allDay) return false;
      const d = new Date(e.start);
      const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return local === dateStr;
    }).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [events, dateStr]
  );

  const allDayEvents = useMemo(() =>
    events.filter(e => {
      if (!e.allDay) return false;
      const s = e.start.split('T')[0];
      let end = e.end.split('T')[0];
      if (end <= s) {
        const d = new Date(s + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        end = d.toISOString().split('T')[0];
      }
      return s <= dateStr && end > dateStr;
    }),
    [events, dateStr]
  );

  const now = new Date();
  const isToday = dateStr === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  function getEventPos(event: CalendarEvent): { top: number; height: number; startMin: number; endMin: number } {
    const start = new Date(event.start);
    const end = new Date(event.end);
    let startMin = start.getHours() * 60 + start.getMinutes();
    let endMin = end.getHours() * 60 + end.getMinutes();
    if (endMin <= startMin) endMin = TOTAL_HOURS * 60;
    return { top: minToPx(startMin), height: Math.max(minToPx(endMin) - minToPx(startMin), 15), startMin, endMin };
  }

  // ── Drag state ──
  const dragRef = useRef<{
    type: 'move' | 'resize'; eventId: string; startY: number;
    origTop: number; origHeight: number; hasMoved: boolean;
  } | null>(null);
  const [dragDelta, setDragDelta] = useState<number>(0);
  const [dragEventId, setDragEventId] = useState<string | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent, type: 'move' | 'resize', event: CalendarEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const pos = getEventPos(event);
    dragRef.current = { type, eventId: event.id, startY: e.clientY, origTop: pos.top, origHeight: pos.height, hasMoved: false };
    setDragEventId(event.id); setDragDelta(0);

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      dragRef.current.hasMoved = true;
      setDragDelta(ev.clientY - dragRef.current.startY);
    };

    const onMouseUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!dragRef.current) return;
      if (!dragRef.current.hasMoved) {
        const clicked = events.find(e => e.id === dragRef.current!.eventId);
        dragRef.current = null; setDragEventId(null); setDragDelta(0);
        if (clicked) onEventClick(clicked);
        return;
      }
      const dy = ev.clientY - dragRef.current.startY;
      const origTopMin = Math.round(pxToMin(dragRef.current.origTop) / 15) * 15;
      const origHeightMin = Math.round(pxToMin(dragRef.current.origTop + dragRef.current.origHeight) / 15) * 15 - origTopMin;
      const newTopPx = dragRef.current.origTop + dy;
      const newTopMin = Math.round(pxToMin(Math.max(0, newTopPx)) / 15) * 15;
      if (dragRef.current.type === 'move') {
        onEventMove(dragRef.current.eventId, minutesToIso(date, newTopMin), minutesToIso(date, newTopMin + origHeightMin));
      } else {
        const newBottomPx = dragRef.current.origTop + dragRef.current.origHeight + dy;
        const newBottomMin = Math.round(pxToMin(Math.max(0, newBottomPx)) / 15) * 15;
        const newHeightMin = Math.max(15, newBottomMin - origTopMin);
        onEventResize(dragRef.current.eventId, minutesToIso(date, origTopMin + newHeightMin));
      }
      dragRef.current = null; setDragEventId(null); setDragDelta(0);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [date, events, onEventMove, onEventResize, onEventClick, pxPerMin]);

  // ── Slot drag ──
  const slotDragRef = useRef<{ startMin: number; currentMin: number } | null>(null);
  const [slotSelect, setSlotSelect] = useState<{ top: number; height: number } | null>(null);

  const handleSlotMouseDown = useCallback((e: React.MouseEvent) => {
    if (dragEventId) return;
    if ((e.target as HTMLElement).closest('[class*="event"]')) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const minutes = Math.floor(pxToMin(y) / 15) * 15;
    slotDragRef.current = { startMin: minutes, currentMin: minutes };
    setSlotSelect({ top: minToPx(minutes), height: minToPx(minutes + 15) - minToPx(minutes) });

    const onMouseMove = (ev: MouseEvent) => {
      if (!slotDragRef.current) return;
      const my = ev.clientY - rect.top;
      const curMin = Math.floor(pxToMin(my) / 15) * 15;
      slotDragRef.current.currentMin = curMin;
      const topMin = Math.min(slotDragRef.current.startMin, curMin);
      const bottomMin = Math.max(slotDragRef.current.startMin, curMin) + 15;
      setSlotSelect({ top: minToPx(topMin), height: minToPx(bottomMin) - minToPx(topMin) });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (!slotDragRef.current) return;
      const topMin = Math.min(slotDragRef.current.startMin, slotDragRef.current.currentMin);
      const bottomMin = Math.max(slotDragRef.current.startMin, slotDragRef.current.currentMin) + 15;
      const start = minutesToIso(date, topMin);
      const end = minutesToIso(date, topMin + Math.max(bottomMin - topMin, 30));
      slotDragRef.current = null; setSlotSelect(null);
      onSlotClick(start, end);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [date, onSlotClick, dragEventId, pxPerMin]);

  return (
    <div className={`${styles.container} ${showEditorial ? styles.editorialMode : ''}`}>
      {allDayEvents.length > 0 && (
        <div className={styles.allDayBar}>
          <div className={styles.allDayLabel}>all day</div>
          <div className={styles.allDayEvents}>
            {allDayEvents.map(e => {
              const meta = CALENDAR_META[e.calendar];
              return (
                <div key={e.id} className={styles.allDayChip} style={{ borderLeftColor: meta.color, background: `color-mix(in srgb, ${meta.color} var(--event-bg-mix), var(--bg))` }}
                  onClick={() => onEventClick(e)}
                  onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); onContextMenu?.(e, ev.clientX, ev.clientY); }}>
                  {e.title}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className={styles.timeline} ref={containerRef}>
        <div className={styles.timeColumn}>
          {VISIBLE_HOURS.map(h => (
            <div key={h} className={styles.timeLabel} style={{ height: `${getHourH(h)}px` }}>
              {h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}
            </div>
          ))}
        </div>
        <div className={styles.dayColumn} onMouseDown={handleSlotMouseDown}>
          {VISIBLE_HOURS.map(h => (
            <div key={h} className={styles.hourSlot} style={{ height: `${getHourH(h)}px` }} />
          ))}
          {(() => {
            const layout = layoutOverlapping(
              dayEvents
                .filter(e => !hiddenEvents?.has(e.id))
                .map(e => {
                  const start = new Date(e.start);
                  const end = new Date(e.end);
                  let startMin = start.getHours() * 60 + start.getMinutes();
                  let endMin = end.getHours() * 60 + end.getMinutes();
                  if (endMin <= startMin) endMin = TOTAL_HOURS * 60;
                  return { id: e.id, startMin, endMin };
                })
            );
            return dayEvents.map(event => {
              const baseMeta = CALENDAR_META[event.calendar];
              const overrideColor = colorOverrides?.get(event.id);
              const meta = overrideColor ? { ...baseMeta, color: overrideColor } : baseMeta;
              const pos = getEventPos(event);
              const col = layout.get(event.id) || { col: 0, totalCols: 1 };
              const leftPct = (col.col / col.totalCols) * 100;
              const widthPct = (1 / col.totalCols) * 100;
              let style: React.CSSProperties = {
                top: `${pos.top}px`, height: `${pos.height}px`,
                backgroundColor: `color-mix(in srgb, ${meta.color} var(--event-bg-mix), var(--bg))`,
                left: `${leftPct}%`, width: `calc(${widthPct}% - 4px)`, right: 'auto',
              };
              if (dragEventId === event.id && dragRef.current) {
                const localPxPerMin = pos.startMin < EARLY_END * 60 ? earlyPxPerMin : normalPxPerMin;
                const snap = Math.round(dragDelta / (localPxPerMin * 15)) * (localPxPerMin * 15);
                if (dragRef.current.type === 'move') style = { ...style, top: `${pos.top + snap}px`, opacity: 0.8, zIndex: 20 };
                else style = { ...style, height: `${Math.max(15, pos.height + snap)}px`, opacity: 0.8, zIndex: 20 };
              }
              if (hiddenEvents?.has(event.id)) {
                style.opacity = 0.15;
              }
              const isTaskLinked = taskLinks?.has(event.id);
              if (isTaskLinked) {
                style.paddingLeft = '18px';
              }
              return (
                <div key={event.id} className={styles.event} style={style}
                  onMouseDown={(e) => handleMouseDown(e, 'move', event)}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(event, e.clientX, e.clientY); }}>
                  {isTaskLinked ? (
                    <button className={styles.taskCheck} style={{ borderColor: meta.color, background: hiddenEvents?.has(event.id) ? meta.color : 'transparent' }}
                      onClick={(e) => { e.stopPropagation(); onToggleTask?.(event.id, !hiddenEvents?.has(event.id)); }}
                      onMouseDown={(e) => e.stopPropagation()} />
                  ) : (
                    <div className={styles.eventBar} style={{ backgroundColor: meta.color }} />
                  )}
                  {(() => {
                    // Dynamic layout based on available height
                    // Use rem-based values: title ~0.85rem*1.3=1.105rem, meta ~0.85rem*1.4
                    const LINE_H = 17.7; // 0.85rem(~13.6px) * 1.3
                    const META_H = 19;   // meta line height with gap
                    const PAD = 6;
                    const contentH = pos.height - PAD;
                    // Need full META_H + at least 1 full title line to show meta
                    const showMeta = contentH >= LINE_H + META_H;
                    const titleMaxH = showMeta ? contentH - META_H : contentH;
                    const titleClamp = Math.max(1, Math.floor(titleMaxH / LINE_H));
                    return (
                      <>
                        <div className={styles.eventTitle} style={{
                          color: meta.color,
                          WebkitLineClamp: titleClamp,
                          maxHeight: `${titleClamp * LINE_H}px`,
                        }}>{event.title}</div>
                        {showMeta && (
                          <div className={styles.eventMeta}>
                            <span className={styles.eventTime}>
                              {formatTime(event.start)} – {formatTime(event.end)}
                              {(() => {
                                const confUrl = event.conferenceUrl || (event.location && /^https?:\/\//.test(event.location) ? event.location : null);
                                return confUrl ? (
                                  <a href={confUrl} target="_blank" rel="noopener noreferrer"
                                    className={styles.confLink} onClick={e => e.stopPropagation()}
                                    onMouseDown={e => e.stopPropagation()}>
                                    {getConferenceLabel(confUrl)}
                                  </a>
                                ) : null;
                              })()}
                            </span>
                            {event.location && !/^https?:\/\//.test(event.location) && <span className={styles.eventLocation}>{event.location}</span>}
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div className={styles.resizeHandle}
                    onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'resize', event); }} />
                </div>
              );
            });
          })()}
          {slotSelect && <div className={styles.slotHighlight} style={{ top: `${slotSelect.top}px`, height: `${slotSelect.height}px` }} />}
          {isToday && <div className={styles.nowLine} style={{ top: `${minToPx(nowMinutes)}px` }} />}
        </div>
      </div>

      <div className={styles.editorial}>
        <div className={styles.editorialDate}>{DAYS_OF_WEEK[date.getDay()]}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
          <div className={styles.editorialDay}>{date.getDate()}</div>
          <div style={{ fontFamily: 'var(--font-data)', fontSize: '0.85rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--accent)' }}>
            {dayEvents.length} events · {dayEvents.reduce((acc, e) => acc + (new Date(e.end).getTime() - new Date(e.start).getTime()) / 3600000, 0).toFixed(1)}h
          </div>
        </div>
        <div className={styles.editorialMonth}>{MONTHS[date.getMonth()]} {date.getFullYear()}</div>
        <hr className={styles.editorialDivider} />
        {(() => {
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const notes = (noteEvents || []).filter(e => {
            const eStart = e.start.split('T')[0];
            const eEnd = e.end.split('T')[0];
            return eStart === dateStr || (eStart <= dateStr && eEnd >= dateStr);
          });
          if (notes.length === 0) return null;
          return (
            <>
              <div className={styles.editorialDate}>Notes</div>
              {notes.map(n => {
                const agentColor = getNoteAgentColor(n.title, n.description);
                return (
                  <div key={n.id} style={{ padding: '0.4rem 0', borderBottom: '1px solid var(--divider)', fontFamily: 'var(--font-body)', fontSize: '0.85rem', fontWeight: 500, color: agentColor || undefined }}>
                    {n.title}{n.description ? ` — ${n.description}` : ''}
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>
    </div>
  );
}
