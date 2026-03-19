export interface CalendarMeta {
  label: string;
  color: string;
  googleId: string;
  writable: boolean;
  agent?: string;
  agentLabel?: string;
  icsUrl?: string;
}

const isDemo = process.env.NEXT_PUBLIC_DEMO === 'true';

// In demo mode, CalendarSource is a broader string to support dynamic calendars.
// In production, the union type ensures only known sources are used.
export type CalendarSource = string;

const DEMO_CALENDARS: Record<string, CalendarMeta> = {
  work: {
    label: 'Delivery & Patrol',
    color: '#2D5F7C',
    googleId: 'demo-work',
    writable: true,
    agent: 'piper',
    agentLabel: 'piper (agent 1)',
  },
  personal: {
    label: 'Rest & Social',
    color: '#2E6B4F',
    googleId: 'demo-personal',
    writable: true,
    agent: 'robin',
    agentLabel: 'robin (agent 2)',
  },
  school: {
    label: 'Training',
    color: '#3A7A7A',
    googleId: 'demo-school',
    writable: true,
  },
  sky: {
    label: 'Sky Life',
    color: '#B8860B',
    googleId: 'demo-sky',
    writable: true,
  },
  notes: {
    label: 'Notes',
    color: '#6B5B73',
    googleId: 'demo-notes',
    writable: true,
  },
};

// ── Production calendars ──────────────────────────────────
// When you connect real Google Calendar, define your own calendars here.
// Example:
//   const PROD_CALENDARS: Record<string, CalendarMeta> = {
//     work: { label: 'Work', color: '#2D5F7C', googleId: 'your-calendar-id@group.calendar.google.com', writable: true, agent: 'piper' },
//     ...
//   };
const PROD_CALENDARS: Record<string, CalendarMeta> = DEMO_CALENDARS;

export const CALENDARS: Record<string, CalendarMeta> = isDemo ? DEMO_CALENDARS : PROD_CALENDARS;

export const ALL_SOURCES = Object.keys(CALENDARS) as CalendarSource[];

// Toggleable calendar key — customize the toggle labels for your use case
export const TOGGLE_CAL_KEY = 'sky';
export const TOGGLE_CAL_LABELS = { on: 'Sky', off: 'Land' };

export function getCalendarByGoogleId(googleId: string): CalendarSource | null {
  for (const [key, meta] of Object.entries(CALENDARS)) {
    if (meta.googleId === googleId) return key as CalendarSource;
  }
  return null;
}
