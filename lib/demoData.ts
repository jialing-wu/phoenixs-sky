import type { CalendarEvent, TodoItem, NotionEntry } from './mockData';

// ── Helpers ────────────────────────────────────────────────
function relDate(dayOffset: number, hour?: number, min = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  if (hour !== undefined) {
    d.setHours(hour, min, 0, 0);
    return d.toISOString();
  }
  return d.toISOString().split('T')[0];
}

function dateOnly(dayOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().split('T')[0];
}

let _id = 0;
function id(prefix = 'demo') { return `${prefix}-${++_id}`; }

// ── Events — Phoenix's bird life ──────────────────────────
export function getDemoEvents(): CalendarEvent[] {
  _id = 0;
  const dow = new Date().getDay(); // 0=Sun

  return [
    // ── Work: Delivery & Patrol (Piper — agent 1) ──
    { id: id(), title: 'Deliver Letters to the Valley', start: relDate(1 - dow, 8), end: relDate(1 - dow, 11), calendar: 'work', location: 'Cedar Valley Post Route' },
    { id: id(), title: 'Sky Patrol — East Sector', start: relDate(3 - dow, 14), end: relDate(3 - dow, 16), calendar: 'work', location: 'East Forest Boundary' },
    { id: id(), title: 'Weekly Sky Patrol Debrief', start: relDate(5 - dow, 11), end: relDate(5 - dow, 12, 30), calendar: 'work' },

    // ── School: Training & Learning ──
    { id: id(), title: 'Aerial Navigation Training', start: relDate(2 - dow, 7), end: relDate(2 - dow, 8, 30), calendar: 'school', location: 'Windridge Cliffs' },
    { id: id(), title: 'Foraging Expedition — Study Group', start: relDate(4 - dow, 10, 30), end: relDate(4 - dow, 12, 30), calendar: 'school', location: 'Bramble Thicket' },

    // ── Personal: Rest & Social (Robin — agent 2) ──
    { id: id(), title: 'Buffet with Sparrow & Finch', start: relDate(2 - dow, 12), end: relDate(2 - dow, 14), calendar: 'personal', location: 'Union Station Food Hall' },
    { id: id(), title: 'Perch & Observe Humans', start: relDate(1 - dow, 15), end: relDate(1 - dow, 16, 30), calendar: 'personal', location: 'Town Square Power Line' },
    { id: id(), title: 'Sunset Singing Practice', start: relDate(4 - dow, 18), end: relDate(4 - dow, 19), calendar: 'personal' },

    // ── Sky Life (toggleable — Phoenix among humans) ──
    { id: id(), title: 'Ride the Bus Downtown', start: relDate(1 - dow, 10), end: relDate(1 - dow, 11, 30), calendar: 'sky', location: 'Route 42 — Window Seat' },
    { id: id(), title: 'Café People-Watching', start: relDate(3 - dow, 9), end: relDate(3 - dow, 10, 30), calendar: 'sky', location: 'Third Wave Coffee' },
    { id: id(), title: 'Night Market Stroll', start: relDate(5 - dow, 19), end: relDate(5 - dow, 21), calendar: 'sky', location: 'Riverside Night Market' },

    // ── Agent Notes ──
    { id: id(), title: 'piper — Strong east gusts expected after noon. Adjust delivery route to stay below the ridge line.', start: dateOnly(0), end: dateOnly(0), calendar: 'notes', allDay: true },
    { id: id(), title: 'robin — You flew 3 hours straight yesterday. Take a perch break between routes today.', start: dateOnly(0), end: dateOnly(0), calendar: 'notes', allDay: true },
  ];
}

// ── Todos — Phoenix's task list ───────────────────────────
export function getDemoTodos(): TodoItem[] {
  return [
    { id: 'todo-1', title: 'Sharpen beak on the granite rock', due: dateOnly(0), priority: 2, done: false, project: 'Grooming' },
    { id: 'todo-2', title: 'Collect twigs for nest repair', due: dateOnly(1), priority: 3, done: false, project: 'Nest' },
    { id: 'todo-3', title: 'Deliver urgent letter to Owl Post', due: dateOnly(0), priority: 1, done: false, project: 'Delivery' },
    { id: 'todo-4', title: 'Find the lost seed stash by the creek', due: dateOnly(2), priority: 3, done: false, project: 'Foraging' },
    { id: 'todo-5', title: 'Practice the new dawn song melody', due: dateOnly(5), priority: 4, done: false, project: 'Personal' },
  ];
}

// ── Notion Entries — Phoenix's projects, goals & deadlines ─
export function getDemoNotionEntries(): NotionEntry[] {
  return [
    // Projects
    { id: 'notion-1', title: 'Southern Migration Route Map', status: 'Drafting', deadline: dateOnly(14), database: 'Projects' },
    { id: 'notion-2', title: 'Flock Communication Signals Guide', status: 'Researching', database: 'Projects' },
    // Deadlines
    { id: 'notion-3', title: 'Nest Winterization', status: 'Due in 3d', deadline: dateOnly(3), database: 'Deadlines' },
    { id: 'notion-4', title: 'Annual Feather Molt Prep', status: 'Due in 7d', deadline: dateOnly(7), database: 'Deadlines' },
    // Weekly Goals
    { id: 'notion-5', title: 'Complete 5 delivery routes without detour', status: '3 / 5', database: 'Weekly Goals' },
    { id: 'notion-6', title: 'Practice dawn song 3 mornings this week', status: '1 / 3', database: 'Weekly Goals' },
    // Monthly Goals
    { id: 'notion-7', title: 'Map 2 new migration waypoints', status: '0 / 2', database: 'Monthly Goals' },
    { id: 'notion-8', title: 'Visit 4 human locations for recon', status: '1 / 4', database: 'Monthly Goals' },
  ];
}

// ── Preferences ────────────────────────────────────────────
export function getDemoPreferences() {
  return {};
}
