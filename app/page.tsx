'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import styles from './page.module.css';
import Header, { ViewMode } from '@/components/Header';
import WeekView from '@/components/WeekView';
import DayView from '@/components/DayView';
import MonthView from '@/components/MonthView';
import Sidebar from '@/components/Sidebar';
import EventDetail, { CreateEventForm } from '@/components/EventDetail';
import ContextMenu from '@/components/ContextMenu';
import { CalendarEvent, TodoItem, NotionEntry } from '@/lib/mockData';
import { CALENDARS, CalendarSource, TOGGLE_CAL_KEY, TOGGLE_CAL_LABELS } from '@/lib/calendarConfig';

export default function Home() {
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'week'
  );
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [showEditorial, setShowEditorial] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [notionEntries, setNotionEntries] = useState<NotionEntry[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [createSlot, setCreateSlot] = useState<{ start: string; end: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null);
  const [hiddenEvents, setHiddenEvents] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('hiddenEvents');
        if (saved) return new Set(JSON.parse(saved));
      } catch { /* ignore */ }
    }
    return new Set();
  });
  const [colorOverrides, setColorOverrides] = useState<Map<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('colorOverrides');
        if (saved) return new Map(Object.entries(JSON.parse(saved)));
      } catch { /* ignore */ }
    }
    return new Map();
  });
  const [taskLinks, setTaskLinks] = useState<Map<string, string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('taskLinks');
        if (saved) return new Map(Object.entries(JSON.parse(saved)));
      } catch { /* ignore */ }
    }
    return new Map();
  });
  const [hiddenCalendars, setHiddenCalendars] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('hiddenCalendars');
        if (saved) return new Set(JSON.parse(saved));
      } catch { /* ignore */ }
    }
    return new Set();
  });
  const [loading, setLoading] = useState(false);
  const touchRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [todoRange, setTodoRange] = useState<'today' | 'tomorrow' | 'week' | 'month'>('today');
  const cacheRef = useRef<Map<string, CalendarEvent[]>>(new Map());

  // Sync preferences to server (debounced) whenever any pref state changes
  const prefsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsLoaded = useRef(false);

  // Load preferences from server on mount (overrides localStorage)
  useEffect(() => {
    fetch('/api/preferences')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        if (data.hiddenEvents?.length) {
          const s = new Set<string>(data.hiddenEvents);
          setHiddenEvents(s);
          localStorage.setItem('hiddenEvents', JSON.stringify(data.hiddenEvents));
        }
        if (data.colorOverrides && Object.keys(data.colorOverrides).length) {
          const m = new Map<string, string>(Object.entries(data.colorOverrides));
          setColorOverrides(m);
          localStorage.setItem('colorOverrides', JSON.stringify(data.colorOverrides));
        }
        if (data.taskLinks && Object.keys(data.taskLinks).length) {
          const m = new Map<string, string>(Object.entries(data.taskLinks));
          setTaskLinks(m);
          localStorage.setItem('taskLinks', JSON.stringify(data.taskLinks));
        }
        if (data.hiddenCalendars?.length) {
          const s = new Set<string>(data.hiddenCalendars);
          setHiddenCalendars(s);
          localStorage.setItem('hiddenCalendars', JSON.stringify(data.hiddenCalendars));
        }
      })
      .catch(() => {})
      .finally(() => { prefsLoaded.current = true; });
  }, []);

  // Auto-save preferences to server when they change
  useEffect(() => {
    if (!prefsLoaded.current) return; // skip initial render & server load
    if (prefsTimer.current) clearTimeout(prefsTimer.current);
    prefsTimer.current = setTimeout(() => {
      fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hiddenEvents: Array.from(hiddenEvents),
          colorOverrides: Object.fromEntries(colorOverrides),
          taskLinks: Object.fromEntries(taskLinks),
          hiddenCalendars: Array.from(hiddenCalendars),
        }),
      }).catch(() => {});
    }, 500);
  }, [hiddenEvents, colorOverrides, taskLinks, hiddenCalendars]);

  const fetchEvents = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const timeMin = new Date();
      timeMin.setMonth(timeMin.getMonth() - 3);
      const timeMax = new Date();
      timeMax.setFullYear(timeMax.getFullYear() + 1);
      const cacheKey = `${timeMin.toISOString().split('T')[0]}:${timeMax.toISOString().split('T')[0]}`;

      if (!force && cacheRef.current.has(cacheKey)) {
        setEvents(cacheRef.current.get(cacheKey)!);
        setLoading(false);
        return;
      }

      const res = await fetch(
        `/api/calendar?timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}`
      );
      if (res.ok) {
        const data = await res.json();
        const evts = data.events as CalendarEvent[];
        cacheRef.current.set(cacheKey, evts);
        setEvents(evts);
      }
    } catch (err) {
      console.error('Failed to fetch events:', err);
    }
    setLoading(false);
  }, []);

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch('/api/todoist');
      if (res.ok) {
        const data = await res.json();
        setTodos(data.tasks || []);
      }
    } catch { /* silent */ }
  }, []);

  const toggleTodo = useCallback(async (id: string, done: boolean) => {
    // Optimistic update
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done } : t));
    try {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: done ? 'close' : 'reopen', id }),
      });
    } catch {
      // Revert on failure
      setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !done } : t));
    }
  }, []);

  const deleteTodo = useCallback(async (id: string) => {
    const prev = todos;
    setTodos(p => p.filter(t => t.id !== id));
    try {
      await fetch(`/api/todoist?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch {
      setTodos(prev);
    }
  }, [todos]);

  const createTodo = useCallback(async (content: string, dueDate?: string) => {
    try {
      const body: Record<string, unknown> = { action: 'create', content };
      if (dueDate) body.due_date = dueDate;
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await fetchTodos();
    } catch { /* silent */ }
  }, [fetchTodos]);

  const fetchNotion = useCallback(async () => {
    try {
      const res = await fetch('/api/notion');
      if (res.ok) {
        const data = await res.json();
        setNotionEntries(data.entries || []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchEvents();
    fetchTodos();
    fetchNotion();
  }, [fetchEvents, fetchTodos, fetchNotion]);

  const handleRefresh = useCallback(() => {
    fetchEvents(true);
  }, [fetchEvents]);

  const handleNavigate = useCallback((dir: -1 | 0 | 1) => {
    if (dir === 0) { setCurrentDate(new Date()); return; }
    setCurrentDate(prev => {
      const next = new Date(prev);
      if (view === 'day') next.setDate(next.getDate() + dir);
      else if (view === 'week') next.setDate(next.getDate() + dir * 7);
      else next.setMonth(next.getMonth() + dir);
      return next;
    });
  }, [view]);

  const handleEventClick = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
  }, []);

  const handleDeleteEvent = useCallback(async (id: string) => {
    const event = events.find(e => e.id === id);
    if (event && !CALENDARS[event.calendar as CalendarSource]?.writable) {
      setToast('Read-only calendar');
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setEvents(prev => prev.filter(e => e.id !== id));
    setSelectedEvent(null);
    if (event) {
      try {
        await fetch(`/api/calendar?id=${encodeURIComponent(id)}&calendar=${event.calendar}`, { method: 'DELETE' });
      } catch { /* silent */ }
    }
  }, [events]);

  const handleSlotClick = useCallback((start: string, end: string) => {
    setCreateSlot({ start, end });
  }, []);

  const handleCreateEvent = useCallback(async (event: CalendarEvent) => {
    setEvents(prev => [...prev, event]);
    setCreateSlot(null);
    try {
      const res = await fetch('/api/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      if (res.ok) {
        const created = await res.json();
        setEvents(prev => prev.map(e => e.id === event.id ? { ...created } : e));
      }
    } catch { /* silent */ }
  }, []);

  const handleEventMove = useCallback(async (id: string, newStart: string, newEnd: string) => {
    const event = events.find(e => e.id === id);
    if (event && !CALENDARS[event.calendar as CalendarSource]?.writable) {
      setToast('Read-only calendar');
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setEvents(prev => prev.map(e => e.id === id ? { ...e, start: newStart, end: newEnd } : e));
    if (event) {
      try {
        await fetch('/api/calendar', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, calendar: event.calendar, start: newStart, end: newEnd }),
        });
      } catch { /* silent */ }
    }
  }, [events]);

  const handleEventResize = useCallback(async (id: string, newEnd: string) => {
    const event = events.find(e => e.id === id);
    if (event && !CALENDARS[event.calendar as CalendarSource]?.writable) {
      setToast('Read-only calendar');
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setEvents(prev => prev.map(e => e.id === id ? { ...e, end: newEnd } : e));
    if (event) {
      try {
        await fetch('/api/calendar', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, calendar: event.calendar, start: event.start, end: newEnd }),
        });
      } catch { /* silent */ }
    }
  }, [events]);

  const handleUpdateEvent = useCallback(async (updated: CalendarEvent) => {
    setEvents(prev => prev.map(e => e.id === updated.id ? updated : e));
    setSelectedEvent(null);
    try {
      await fetch('/api/calendar', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch { /* silent */ }
  }, []);

  const handleMonthDayClick = useCallback((date: Date) => {
    setCurrentDate(date);
    setView('day');
  }, []);

  const handleContextMenu = useCallback((event: CalendarEvent, x: number, y: number) => {
    setContextMenu({ event, x, y });
  }, []);

  const handleToggleHide = useCallback((id: string) => {
    setHiddenEvents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('hiddenEvents', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const handleAddToTask = useCallback(async (eventId: string, title: string, dueDate?: string) => {
    if (taskLinks.has(eventId)) return;
    try {
      const body: Record<string, unknown> = { action: 'create', content: title };
      if (dueDate) body.due_date = dueDate;
      const res = await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        const todoId = data.task?.id;
        if (todoId) {
          setTaskLinks(prev => {
            const next = new Map(prev);
            next.set(eventId, String(todoId));
            localStorage.setItem('taskLinks', JSON.stringify(Object.fromEntries(next)));
            return next;
          });
        }
        await fetchTodos();
      }
    } catch { /* silent */ }
  }, [taskLinks, fetchTodos]);

  const handleToggleTask = useCallback(async (eventId: string, done: boolean) => {
    const todoId = taskLinks.get(eventId);
    if (!todoId) return;
    // Optimistic: toggle hidden
    setHiddenEvents(prev => {
      const next = new Set(prev);
      if (done) next.add(eventId); else next.delete(eventId);
      localStorage.setItem('hiddenEvents', JSON.stringify(Array.from(next)));
      return next;
    });
    // Sync Todoist
    try {
      await fetch('/api/todoist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: done ? 'close' : 'reopen', id: todoId }),
      });
      await fetchTodos();
    } catch {
      // Revert on failure
      setHiddenEvents(prev => {
        const next = new Set(prev);
        if (done) next.delete(eventId); else next.add(eventId);
        localStorage.setItem('hiddenEvents', JSON.stringify(Array.from(next)));
        return next;
      });
    }
  }, [taskLinks, fetchTodos]);

  const handleColorChange = useCallback((id: string, color: string | null) => {
    setColorOverrides(prev => {
      const next = new Map(prev);
      if (color === null) next.delete(id);
      else next.set(id, color);
      localStorage.setItem('colorOverrides', JSON.stringify(Object.fromEntries(next)));
      return next;
    });
  }, []);

  const handleToggleCalendar = useCallback((cal: string) => {
    setHiddenCalendars(prev => {
      const next = new Set(prev);
      if (next.has(cal)) next.delete(cal); else next.add(cal);
      localStorage.setItem('hiddenCalendars', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const filteredEvents = useMemo(
    () => {
      let filtered = events.filter(e => e.calendar !== 'notes');
      if (hiddenCalendars.size > 0) filtered = filtered.filter(e => !hiddenCalendars.has(e.calendar));
      return filtered;
    },
    [events, hiddenCalendars],
  );

  const noteEvents = useMemo(() => events.filter(e => e.calendar === 'notes'), [events]);

  const weekStart = new Date(currentDate);
  weekStart.setDate(currentDate.getDate() - currentDate.getDay());
  weekStart.setHours(0, 0, 0, 0);

  return (
    <>
      <Header
        view={view}
        onViewChange={setView}
        currentDate={currentDate}
        onNavigate={handleNavigate}
        onRefresh={handleRefresh}
        loading={loading}
        hiddenCalendars={hiddenCalendars}
        onToggleCalendar={handleToggleCalendar}
        showEditorial={showEditorial}
        onToggleEditorial={() => setShowEditorial(v => !v)}
      />
      <div className={styles.main}>
        <div className={styles.calendarArea}
          onTouchStart={e => {
            const t = e.touches[0];
            touchRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
          }}
          onTouchEnd={e => {
            if (!touchRef.current) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - touchRef.current.x;
            const dy = t.clientY - touchRef.current.y;
            const dt = Date.now() - touchRef.current.t;
            touchRef.current = null;
            if (dt < 400 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              handleNavigate(dx < 0 ? 1 : -1);
            }
          }}
        >
          {view === 'week' && (
            <WeekView weekStart={weekStart} events={filteredEvents} hiddenEvents={hiddenEvents} colorOverrides={colorOverrides}
              taskLinks={taskLinks} onToggleTask={handleToggleTask}
              onEventClick={handleEventClick} onSlotClick={handleSlotClick}
              onEventMove={handleEventMove} onEventResize={handleEventResize}
              onContextMenu={handleContextMenu} onDayClick={handleMonthDayClick} showEditorial={showEditorial} />
          )}
          {view === 'day' && (
            <DayView date={currentDate} events={filteredEvents} noteEvents={noteEvents} hiddenEvents={hiddenEvents} colorOverrides={colorOverrides}
              taskLinks={taskLinks} onToggleTask={handleToggleTask}
              onEventClick={handleEventClick} onSlotClick={handleSlotClick}
              onEventMove={handleEventMove} onEventResize={handleEventResize}
              onContextMenu={handleContextMenu} showEditorial={showEditorial} />
          )}
          {view === 'month' && (
            <MonthView date={currentDate} events={filteredEvents} onDayClick={handleMonthDayClick}
              onEventClick={handleEventClick} onEventMove={handleEventMove}
              onContextMenu={handleContextMenu} showEditorial={showEditorial} />
          )}
        </div>
        <Sidebar currentDate={today} events={filteredEvents} todos={todos} notionEntries={notionEntries} todoRange={todoRange} onTodoRangeChange={setTodoRange} onTodoRefresh={fetchTodos} onTodoToggle={toggleTodo} onTodoDelete={deleteTodo} onTodoCreate={createTodo} onNotionRefresh={fetchNotion} hiddenEvents={hiddenEvents} onToggleHide={handleToggleHide} taskLinks={taskLinks} onToggleTask={handleToggleTask} />
      </div>

      {selectedEvent && (
        <EventDetail event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onDelete={handleDeleteEvent} onUpdate={handleUpdateEvent} />
      )}

      {createSlot && (
        <CreateEventForm defaultStart={createSlot.start} defaultEnd={createSlot.end}
          onClose={() => setCreateSlot(null)} onCreate={handleCreateEvent} />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#333', color: '#fff', padding: '8px 20px', borderRadius: 6,
          fontSize: '0.82rem', fontFamily: 'var(--font-body)', zIndex: 9999,
          pointerEvents: 'none', opacity: 0.92,
        }}>{toast}</div>
      )}

      {contextMenu && (
        <ContextMenu event={contextMenu.event} position={{ x: contextMenu.x, y: contextMenu.y }}
          isHidden={hiddenEvents.has(contextMenu.event.id)}
          currentColor={colorOverrides.get(contextMenu.event.id)}
          isTaskLinked={taskLinks.has(contextMenu.event.id)}
          onClose={() => setContextMenu(null)} onToggleHide={handleToggleHide}
          onColorChange={handleColorChange}
          onAddTodo={(content, dueDate) => handleAddToTask(contextMenu.event.id, content, dueDate)}
          onDelete={handleDeleteEvent} />
      )}

      {/* Mobile floating buttons */}
      <div className={styles.fabColumn}>
        <button className={styles.fabDot} onClick={() => handleNavigate(0)}>Now</button>
        <button className={!hiddenCalendars.has(TOGGLE_CAL_KEY) ? styles.fabDotActive : styles.fabDot} onClick={() => handleToggleCalendar(TOGGLE_CAL_KEY)}>
          {!hiddenCalendars.has(TOGGLE_CAL_KEY) ? TOGGLE_CAL_LABELS.on : TOGGLE_CAL_LABELS.off}
        </button>
        <button className={showEditorial ? styles.fabDotActive : styles.fabDot} onClick={() => setShowEditorial(v => !v)}>
          {showEditorial ? 'Cal' : 'Info'}
        </button>
        <button className={`${loading ? styles.fabDotActive : styles.fabDot} ${loading ? styles.fabLoading : ''}`} onClick={handleRefresh} disabled={loading}>
          Sync
        </button>
      </div>
    </>
  );
}
