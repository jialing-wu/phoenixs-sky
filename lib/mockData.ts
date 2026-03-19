// Re-export types from calendarConfig and define event/todo/notion types
export type { CalendarSource } from './calendarConfig';
import type { CalendarSource } from './calendarConfig';
export { CALENDARS as CALENDAR_META } from './calendarConfig';

export interface Attendee {
  email: string;
  name?: string;
  status: 'accepted' | 'declined' | 'tentative' | 'needsAction';
}

export interface Reminder {
  method: 'popup' | 'email';
  minutes: number;
}

export interface CalendarEvent {
  id: string;
  googleEventId?: string;
  title: string;
  start: string; // ISO datetime or date
  end: string;
  calendar: CalendarSource;
  location?: string;
  allDay?: boolean;
  description?: string;
  recurrence?: string;
  attendees?: Attendee[];
  reminders?: Reminder[];
  status?: 'confirmed' | 'tentative' | 'cancelled';
  conferenceUrl?: string;
  timeZone?: string;
}

export interface TodoItem {
  id: string;
  title: string;
  due?: string;
  priority: 1 | 2 | 3 | 4;
  done: boolean;
  project?: string;
  labels?: string[];
  parentId?: string | null;
}

export interface NotionEntry {
  id: string;
  title: string;
  status: string;
  deadline?: string;
  database: string;
}

// Utility: get short label for conference URL
export function getConferenceLabel(url: string): string {
  if (url.includes('zoom.us') || url.includes('zoom.com')) return 'Zoom';
  if (url.includes('meet.google.com')) return 'Meet';
  if (url.includes('teams.microsoft.com')) return 'Teams';
  if (url.includes('webex.com')) return 'Webex';
  return 'Link';
}

// Utility: format time
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

// Utility: get the Sunday of current week
export function getCurrentWeekStart(): Date {
  const now = new Date();
  const d = new Date(now);
  d.setDate(now.getDate() - now.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

// Utility: get events for a week starting from Sunday
export function getEventsForWeek(sundayDate: Date, events: CalendarEvent[]): CalendarEvent[] {
  const start = new Date(sundayDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return events.filter((e) => {
    const d = new Date(e.start);
    return d >= start && d < end;
  });
}

// Utility: get events for a specific date
export function getEventsForDate(date: Date, events: CalendarEvent[]): CalendarEvent[] {
  const dateStr = date.toISOString().split('T')[0];
  return events.filter((e) => e.start.split('T')[0] === dateStr);
}
