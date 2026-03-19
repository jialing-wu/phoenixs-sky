'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './EventDetail.module.css';
import { CalendarEvent, CALENDAR_META, formatTime, getConferenceLabel } from '@/lib/mockData';
import { CalendarSource, CALENDARS } from '@/lib/calendarConfig';

const URL_RE = /(https?:\/\/[^\s<]+)/g;
function Linkify({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return <>{parts.map((part, i) =>
    URL_RE.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
      : part
  )}</>;
}

function CalendarSelect({ value, onChange }: { value: CalendarSource; onChange: (v: CalendarSource) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const meta = CALENDARS[value];

  return (
    <div className={styles.customSelect} ref={ref}>
      <div className={styles.selectTrigger} onClick={() => setOpen(!open)}>
        <span className={styles.selectDot} style={{ backgroundColor: meta.color }} />
        <span className={styles.selectValue}>{meta.label}</span>
      </div>
      {open && (
        <div className={styles.selectDropdown}>
          {Object.entries(CALENDARS).filter(([, m]) => m.writable).map(([key, m]) => (
            <div
              key={key}
              className={`${styles.selectOption} ${key === value ? styles.selectOptionActive : ''}`}
              onClick={() => { onChange(key as CalendarSource); setOpen(false); }}
            >
              <span className={styles.selectDot} style={{ backgroundColor: m.color }} />
              {m.label}
              {m.agent && <span className={styles.agentLabel}>{m.agentLabel || m.agent}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface EventDetailProps {
  event: CalendarEvent | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdate: (updated: CalendarEvent) => void;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function formatRecurrence(rrule: string): string {
  if (!rrule) return '';
  const parts = rrule.replace('RRULE:', '').split(';');
  const map: Record<string, string> = {};
  for (const p of parts) { const [k, v] = p.split('='); map[k] = v; }
  const freq = map.FREQ;
  const byDay = map.BYDAY;
  const dayNames: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
  if (freq === 'DAILY') return 'Every day';
  if (freq === 'WEEKLY' && byDay) return `Weekly on ${byDay.split(',').map(d => dayNames[d.replace(/\d/g, '')] || d).join(', ')}`;
  if (freq === 'WEEKLY') return 'Every week';
  if (freq === 'MONTHLY') return 'Every month';
  if (freq === 'YEARLY') return 'Every year';
  return rrule;
}

function formatReminderText(r: { method: string; minutes: number }): string {
  if (r.minutes < 60) return `${r.minutes}min before (${r.method})`;
  if (r.minutes < 1440) return `${r.minutes / 60}h before (${r.method})`;
  return `${r.minutes / 1440}d before (${r.method})`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function toTimeStr(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function EventDetail({ event, onClose, onDelete, onUpdate }: EventDetailProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [calendar, setCalendar] = useState<CalendarSource>('personal');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  if (!event) return null;
  const meta = CALENDAR_META[event.calendar];
  const calMeta = CALENDARS[event.calendar as CalendarSource];
  const isWritable = calMeta?.writable ?? false;

  const startEdit = () => {
    setTitle(event.title);
    setCalendar(event.calendar);
    setLocation(event.location || '');
    setDescription(event.description || '');
    setStartTime(toTimeStr(event.start));
    setEndTime(toTimeStr(event.end));
    setEditing(true);
  };

  const handleSave = () => {
    if (!title.trim()) return;
    const baseDate = new Date(event.start);
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const s = new Date(baseDate);
    s.setHours(sh, sm, 0, 0);
    const en = new Date(baseDate);
    en.setHours(eh, em, 0, 0);
    onUpdate({
      ...event,
      title: title.trim(),
      calendar,
      location: location.trim() || undefined,
      description: description.trim() || undefined,
      start: s.toISOString(),
      end: en.toISOString(),
    });
    setEditing(false);
    onClose();
  };

  if (editing) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.panel} onClick={e => e.stopPropagation()}>
          <button className={styles.close} onClick={onClose}>&times;</button>
          <h2 className={styles.title}>Edit Event</h2>
          <hr className={styles.divider} />
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Title</label>
            <input className={styles.formInput} value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          </div>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Start</label>
              <input className={styles.formInput} type="text" placeholder="HH:MM" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>End</label>
              <input className={styles.formInput} type="text" placeholder="HH:MM" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Calendar</label>
            <CalendarSelect value={calendar} onChange={setCalendar} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Location</label>
            <input className={styles.formInput} value={location} onChange={e => setLocation(e.target.value)} placeholder="Optional" />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Notes</label>
            <textarea className={styles.formTextarea} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" rows={3} />
          </div>
          <div className={styles.actions}>
            <button className={styles.submitBtn} onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose}>&times;</button>
        <div className={styles.calLabel}>
          <span className={styles.calDot} style={{ backgroundColor: meta.color }} />
          {meta.label}
          {calMeta?.agent && <span className={styles.agentLabelInline}>{calMeta.agentLabel || calMeta.agent}</span>}
        </div>
        <h2 className={styles.title}>{event.title}</h2>
        <hr className={styles.divider} />
        <div className={styles.row}>
          <span className={styles.rowLabel}>Date</span>
          <span className={styles.rowValue}>{formatDate(event.start)}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>Time</span>
          <span className={styles.rowValue}>
            {event.allDay ? 'All day' : `${formatTime(event.start)} \u2013 ${formatTime(event.end)}`}
          </span>
        </div>
        {event.location && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Where</span>
            <span className={styles.rowValue}>
              {/^https?:\/\//.test(event.location)
                ? <a href={event.location} target="_blank" rel="noopener noreferrer" className={styles.confLink}>{getConferenceLabel(event.location)}</a>
                : <Linkify text={event.location} />}
            </span>
          </div>
        )}
        {event.recurrence && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Repeat</span>
            <span className={styles.rowValue}>{formatRecurrence(event.recurrence)}</span>
          </div>
        )}
        {event.description && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Notes</span>
            <span className={styles.rowValue}><Linkify text={event.description} /></span>
          </div>
        )}
        {event.attendees && event.attendees.length > 0 && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Guests</span>
            <span className={styles.rowValue}>{event.attendees.map(a => a.name || a.email).join(', ')}</span>
          </div>
        )}
        {event.reminders && event.reminders.length > 0 && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Remind</span>
            <span className={styles.rowValue}>{event.reminders.map(r => formatReminderText(r)).join(', ')}</span>
          </div>
        )}
        {event.conferenceUrl && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>Meet</span>
            <span className={styles.rowValue}>
              <a href={event.conferenceUrl} target="_blank" rel="noopener noreferrer" className={styles.confLink}>{getConferenceLabel(event.conferenceUrl)}</a>
            </span>
          </div>
        )}
        {!event.allDay && (() => {
          const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const eventTz = event.timeZone || localTz;
          const fmt = (iso: string, tz: string) => {
            try {
              return new Date(iso).toLocaleTimeString('en-US', {
                hour: 'numeric', minute: '2-digit', timeZone: tz,
              });
            } catch { return ''; }
          };
          const tzAbbr = (tz: string) => {
            try {
              const parts = new Date(event.start).toLocaleTimeString('en-US', { timeZoneName: 'short', timeZone: tz }).split(' ');
              return parts[parts.length - 1];
            } catch { return tz; }
          };
          const lines: { label: string; time: string }[] = [];
          // Always show the event's stored timezone
          lines.push({ label: tzAbbr(eventTz), time: `${fmt(event.start, eventTz)} – ${fmt(event.end, eventTz)}` });
          // If local tz differs from event tz, also show local
          if (eventTz !== localTz) {
            lines.push({ label: tzAbbr(localTz), time: `${fmt(event.start, localTz)} – ${fmt(event.end, localTz)}` });
          }
          return (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Original</span>
              <span className={styles.rowValue}>
                {lines.map((l, i) => <div key={i}>{l.time} {l.label}</div>)}
              </span>
            </div>
          );
        })()}
        <div className={styles.actions}>
          {isWritable && <button className={styles.submitBtn} onClick={startEdit}>Edit</button>}
          {isWritable && <button className={styles.deleteBtn} onClick={() => onDelete(event.id)}>Delete</button>}
        </div>
      </div>
    </div>
  );
}

// ── Create Event Form ──
interface CreateEventProps {
  defaultStart: string;
  defaultEnd: string;
  onClose: () => void;
  onCreate: (event: CalendarEvent) => void;
}

const RECURRENCE_OPTIONS = [
  { label: 'Does not repeat', value: '' },
  { label: 'Every day', value: 'RRULE:FREQ=DAILY' },
  { label: 'Every week', value: 'RRULE:FREQ=WEEKLY' },
  { label: 'Every month', value: 'RRULE:FREQ=MONTHLY' },
  { label: 'Every year', value: 'RRULE:FREQ=YEARLY' },
];

const REMINDER_OPTIONS = [
  { label: 'No reminder', value: -1 },
  { label: '0 minutes before', value: 0 },
  { label: '5 minutes before', value: 5 },
  { label: '10 minutes before', value: 10 },
  { label: '15 minutes before', value: 15 },
  { label: '30 minutes before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '1 day before', value: 1440 },
];

const TZ_OPTIONS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'UTC',
];

export function CreateEventForm({ defaultStart, defaultEnd, onClose, onCreate }: CreateEventProps) {
  const [title, setTitle] = useState('');
  const [calendar, setCalendar] = useState<CalendarSource>('personal');
  const [allDay, setAllDay] = useState(false);
  const [startDate, setStartDate] = useState(defaultStart.split('T')[0]);
  const [endDate, setEndDate] = useState(defaultEnd.split('T')[0] || defaultStart.split('T')[0]);
  const [startTime, setStartTime] = useState(defaultStart.slice(11, 16) || '09:00');
  const [endTime, setEndTime] = useState(defaultEnd.slice(11, 16) || '10:00');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [recurrence, setRecurrence] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState(30);
  const [timeZone, setTimeZone] = useState('America/New_York');
  const [conferenceUrl, setConferenceUrl] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    const event: CalendarEvent = {
      id: `new-${Date.now()}`,
      title: title.trim(),
      start: allDay ? startDate : `${startDate}T${startTime}:00`,
      end: allDay ? (endDate > startDate ? endDate : addDaysStr(startDate, 1)) : `${endDate}T${endTime}:00`,
      allDay,
      calendar,
      location: location.trim() || undefined,
      description: description.trim() || undefined,
      recurrence: recurrence || undefined,
      reminders: reminderMinutes >= 0 ? [{ method: 'popup', minutes: reminderMinutes }] : undefined,
      conferenceUrl: conferenceUrl.trim() || undefined,
      timeZone,
    };
    onCreate(event);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <button className={styles.close} onClick={onClose}>&times;</button>
        <h2 className={styles.title}>New Event</h2>
        <hr className={styles.divider} />

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Title</label>
          <input className={styles.formInput} value={title} onChange={e => setTitle(e.target.value)} placeholder="Add title" autoFocus />
        </div>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>
            <input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} style={{ marginRight: '0.4rem' }} />
            All day
          </label>
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Start Date</label>
            <input className={styles.formInput} type="date" value={startDate} onChange={e => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>End Date</label>
            <input className={styles.formInput} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} />
          </div>
        </div>

        {!allDay && (
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Start Time</label>
              <input className={styles.formInput} type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>End Time</label>
              <input className={styles.formInput} type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>
        )}

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Calendar</label>
          <CalendarSelect value={calendar} onChange={setCalendar} />
        </div>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Location</label>
          <input className={styles.formInput} value={location} onChange={e => setLocation(e.target.value)} placeholder="Add location" />
        </div>

        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Repeat</label>
            <select className={styles.formInput} value={recurrence} onChange={e => setRecurrence(e.target.value)}>
              {RECURRENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Reminder</label>
            <select className={styles.formInput} value={reminderMinutes} onChange={e => setReminderMinutes(Number(e.target.value))}>
              {REMINDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Time Zone</label>
          <select className={styles.formInput} value={timeZone} onChange={e => setTimeZone(e.target.value)}>
            {TZ_OPTIONS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Conference Link</label>
          <input className={styles.formInput} value={conferenceUrl} onChange={e => setConferenceUrl(e.target.value)} placeholder="https://meet.google.com/..." />
        </div>

        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Description</label>
          <textarea className={styles.formTextarea} value={description} onChange={e => setDescription(e.target.value)} placeholder="Add description" rows={3} />
        </div>

        <button className={styles.submitBtn} onClick={handleSubmit}>Create</button>
      </div>
    </div>
  );
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
