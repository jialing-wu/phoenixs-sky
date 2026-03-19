import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { CALENDARS, CalendarSource, ALL_SOURCES } from '@/lib/calendarConfig';

// ── Demo mode: return mock data, no real API calls ──
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === 'true';

// Auth: service account (Vercel) or GWS proxy (local dev)
const GWS_PROXY = process.env.GWS_PROXY_URL;
const SA_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const SA_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');

function getCalendarClient() {
  if (!SA_EMAIL || !SA_KEY) return null;
  const auth = new google.auth.JWT({
    email: SA_EMAIL,
    key: SA_KEY,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  return google.calendar({ version: 'v3', auth });
}

// ── ICS fetch & parse ──────────────────────────────────────

// Windows → IANA timezone mapping (common ones)
const WIN_TZ: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Pacific Standard Time': 'America/Los_Angeles',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'India Standard Time': 'Asia/Kolkata',
  'Korea Standard Time': 'Asia/Seoul',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Atlantic Standard Time': 'America/Halifax',
};

function resolveTimezone(tz: string): string {
  return WIN_TZ[tz] || tz;
}

/** Unfold ICS lines (RFC 5545: continuation lines start with space/tab) */
function unfoldIcs(text: string): string {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

/** Parse a single ICS property line like "DTSTART;TZID=Eastern Standard Time:20250318T110000" */
function parseIcsProp(line: string): { params: string; value: string } {
  // The value is after the LAST colon that isn't inside a param value
  // Property format: NAME;PARAM=VAL;PARAM=VAL:VALUE
  const colonIdx = line.indexOf(':');
  if (colonIdx < 0) return { params: '', value: line };
  return { params: line.slice(0, colonIdx), value: line.slice(colonIdx + 1).trim() };
}

/** Get timezone offset string like "-04:00" for a given IANA timezone at a specific datetime */
function tzOffset(tz: string, naiveDatetime: string): string {
  try {
    // Create a reference date in UTC using the naive datetime
    const refUtc = new Date(naiveDatetime + 'Z');
    // Get what that UTC instant looks like in the target timezone
    const inTz = new Date(refUtc.toLocaleString('en-US', { timeZone: tz }));
    const inUtc = new Date(refUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
    const diffMs = inTz.getTime() - inUtc.getTime();
    const sign = diffMs >= 0 ? '+' : '-';
    const abs = Math.abs(diffMs);
    const h = String(Math.floor(abs / 3600000)).padStart(2, '0');
    const m = String(Math.floor((abs % 3600000) / 60000)).padStart(2, '0');
    return `${sign}${h}:${m}`;
  } catch {
    return '';
  }
}

function parseIcsDt(propLine: string): { iso: string; allDay: boolean; tz?: string; naiveIso?: string } {
  if (!propLine) return { iso: '', allDay: false };
  const { params, value } = parseIcsProp(propLine);
  if (!value) return { iso: '', allDay: false };

  // All-day: VALUE=DATE with 8-digit date
  if (params.includes('VALUE=DATE') && !params.includes('VALUE=DATE-TIME')) {
    const d = value.replace(/\D/g, '');
    return { iso: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, allDay: true };
  }

  // Date-time value: 20250318T110000 or 20250318T110000Z
  const v = value.replace(/\r/g, '');
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) {
    // Might be date-only without VALUE=DATE param
    const dm = v.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dm) return { iso: `${dm[1]}-${dm[2]}-${dm[3]}`, allDay: true };
    return { iso: '', allDay: false };
  }
  const [, year, month, day, hour, min, sec, zulu] = m;
  const isoBase = `${year}-${month}-${day}T${hour}:${min}:${sec}`;

  if (zulu) return { iso: isoBase + 'Z', allDay: false, tz: 'UTC' };

  const tzMatch = params.match(/TZID=([^;]+)/);
  const tz = tzMatch ? resolveTimezone(tzMatch[1].trim()) : undefined;

  if (tz && tz !== 'UTC') {
    // Output ISO with timezone offset (e.g. 2026-04-11T18:00:00-07:00)
    // Also keep naiveIso for RRULE expansion (hour/day math must use event-local time)
    const offset = tzOffset(tz, isoBase);
    return { iso: `${isoBase}${offset}`, allDay: false, tz, naiveIso: isoBase };
  }

  return { iso: isoBase, allDay: false, tz, naiveIso: isoBase };
}

// ── RRULE expansion ──────────────────────────────────────

const DAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Format Date as ISO date string YYYY-MM-DD */
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** Format Date as ISO datetime string YYYY-MM-DDTHH:MM:SS */
function fmtDateTime(d: Date): string {
  return `${fmtDate(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

/** Parse RRULE string into components */
function parseRRule(rrule: string) {
  const parts: Record<string, string> = {};
  for (const p of rrule.split(';')) {
    const [k, v] = p.split('=');
    if (k && v) parts[k] = v;
  }
  return {
    freq: parts.FREQ || '',
    until: parts.UNTIL || '',
    count: parts.COUNT ? parseInt(parts.COUNT) : undefined,
    interval: parseInt(parts.INTERVAL || '1'),
    byDay: parts.BYDAY?.split(',') || [],
    byMonth: parts.BYMONTH ? parseInt(parts.BYMONTH) : undefined,
    byMonthDay: parts.BYMONTHDAY ? parseInt(parts.BYMONTHDAY) : undefined,
  };
}

/** Parse UNTIL value (YYYYMMDD or YYYYMMDDTHHMMSSZ) to Date */
function parseUntil(until: string): Date {
  const d = until.replace(/[^0-9T]/g, '');
  if (d.length >= 15) {
    return new Date(Date.UTC(+d.slice(0,4), +d.slice(4,6)-1, +d.slice(6,8), +d.slice(9,11), +d.slice(11,13), +d.slice(13,15)));
  }
  return new Date(+d.slice(0,4), +d.slice(4,6)-1, +d.slice(6,8), 23, 59, 59);
}

/** Expand RRULE occurrences within [tMin, tMax]. Returns array of start Dates. */
function expandRRule(
  rruleStr: string,
  dtStart: Date,
  tMin: number,
  tMax: number,
  exDates: Set<string>,
  maxOccurrences = 500,
): Date[] {
  const rule = parseRRule(rruleStr);
  const results: Date[] = [];
  const until = rule.until ? parseUntil(rule.until).getTime() : tMax;
  const limit = Math.min(until, tMax);

  if (rule.freq === 'WEEKLY') {
    const targetDays = rule.byDay.length > 0
      ? rule.byDay.map(d => { const m = d.match(/(\d*)(\w{2})/); return DAY_MAP[m?.[2] || ''] ?? -1; }).filter(n => n >= 0)
      : [dtStart.getDay()];

    // Start from the week of dtStart
    const cursor = new Date(dtStart);
    cursor.setDate(cursor.getDate() - cursor.getDay()); // go to Sunday of that week
    let weekCount = 0;

    while (cursor.getTime() <= limit && results.length < maxOccurrences) {
      if (weekCount % rule.interval === 0) {
        for (const dow of targetDays) {
          const occ = new Date(cursor);
          occ.setDate(occ.getDate() + dow);
          occ.setHours(dtStart.getHours(), dtStart.getMinutes(), dtStart.getSeconds());
          if (occ.getTime() < dtStart.getTime()) continue;
          if (occ.getTime() > limit) continue;
          if (rule.count !== undefined && results.length >= rule.count) break;
          const key = fmtDateTime(occ);
          if (!exDates.has(key) && !exDates.has(fmtDate(occ))) {
            if (occ.getTime() >= tMin) results.push(occ);
          }
        }
      }
      cursor.setDate(cursor.getDate() + 7);
      weekCount++;
    }
  } else if (rule.freq === 'MONTHLY') {
    const cursor = new Date(dtStart);
    let count = 0;
    while (cursor.getTime() <= limit && results.length < maxOccurrences) {
      if (count % rule.interval === 0) {
        let occ: Date | null = null;
        if (rule.byDay.length > 0) {
          // e.g. BYDAY=1TU (first Tuesday)
          const m = rule.byDay[0].match(/(-?\d+)(\w{2})/);
          if (m) {
            const nth = parseInt(m[1]);
            const dow = DAY_MAP[m[2]] ?? -1;
            if (dow >= 0) {
              const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
              const firstDow = first.getDay();
              let day = 1 + ((dow - firstDow + 7) % 7) + (nth - 1) * 7;
              if (nth < 0) {
                const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
                day = last.getDate() - ((last.getDay() - dow + 7) % 7) + (nth + 1) * 7;
              }
              occ = new Date(cursor.getFullYear(), cursor.getMonth(), day, dtStart.getHours(), dtStart.getMinutes(), dtStart.getSeconds());
            }
          }
        } else {
          occ = new Date(cursor.getFullYear(), cursor.getMonth(), rule.byMonthDay || dtStart.getDate(), dtStart.getHours(), dtStart.getMinutes(), dtStart.getSeconds());
        }
        if (occ && occ.getTime() >= dtStart.getTime() && occ.getTime() <= limit) {
          if (rule.count !== undefined && results.length >= rule.count) break;
          const key = fmtDateTime(occ);
          if (!exDates.has(key) && !exDates.has(fmtDate(occ))) {
            if (occ.getTime() >= tMin) results.push(occ);
          }
        }
      }
      cursor.setMonth(cursor.getMonth() + 1);
      count++;
    }
  } else if (rule.freq === 'YEARLY') {
    const cursor = new Date(dtStart);
    let count = 0;
    while (cursor.getTime() <= limit && results.length < maxOccurrences) {
      if (count % rule.interval === 0 && cursor.getTime() >= dtStart.getTime()) {
        if (rule.count !== undefined && results.length >= rule.count) break;
        const key = fmtDateTime(cursor);
        if (!exDates.has(key) && !exDates.has(fmtDate(cursor))) {
          if (cursor.getTime() >= tMin) results.push(new Date(cursor));
        }
      }
      cursor.setFullYear(cursor.getFullYear() + rule.interval);
      count++;
    }
  } else if (rule.freq === 'DAILY') {
    const cursor = new Date(dtStart);
    let count = 0;
    while (cursor.getTime() <= limit && results.length < maxOccurrences) {
      if (count % rule.interval === 0) {
        if (rule.count !== undefined && results.length >= rule.count) break;
        const key = fmtDateTime(cursor);
        if (!exDates.has(key) && !exDates.has(fmtDate(cursor))) {
          if (cursor.getTime() >= tMin) results.push(new Date(cursor));
        }
      }
      cursor.setDate(cursor.getDate() + 1);
      count++;
    }
  }

  return results;
}

// ── Main ICS fetch ──────────────────────────────────────

async function fetchIcsEvents(
  icsUrl: string,
  calendar: CalendarSource,
  timeMin: string,
  timeMax: string,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(icsUrl, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`ICS fetch ${res.status}`);
  const raw = await res.text();
  const text = unfoldIcs(raw);

  const tMin = new Date(timeMin).getTime();
  const tMax = new Date(timeMax).getTime();
  const events: Record<string, unknown>[] = [];

  const blocks = text.split('BEGIN:VEVENT');
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0];
    const lines = block.split('\n').map(l => l.replace(/\r$/, ''));

    const getProp = (key: string): string => {
      const line = lines.find(l => l.startsWith(key + ':') || l.startsWith(key + ';'));
      return line || '';
    };
    const getVal = (key: string): string => {
      const line = getProp(key);
      if (!line) return '';
      const colonIdx = line.indexOf(':');
      return colonIdx >= 0 ? line.slice(colonIdx + 1).trim() : '';
    };

    const unesc = (s: string) => s.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, '\n').replace(/\\\\/g, '\\');
    const summary = unesc(getVal('SUMMARY'));
    const location = unesc(getVal('LOCATION'));
    const description = unesc(getVal('DESCRIPTION'));
    const uid = getVal('UID');

    const start = parseIcsDt(getProp('DTSTART'));
    let end = parseIcsDt(getProp('DTEND'));

    // DURATION fallback
    if (!end.iso && start.iso) {
      const dur = getVal('DURATION');
      const durMatch = dur?.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/);
      if (durMatch) {
        const ms = ((parseInt(durMatch[1]||'0'))*86400 + (parseInt(durMatch[2]||'0'))*3600 + (parseInt(durMatch[3]||'0'))*60) * 1000;
        end = { iso: new Date(new Date(start.iso).getTime() + ms).toISOString(), allDay: start.allDay };
      }
    }

    if (!start.iso) continue;

    const durationMs = end.iso
      ? new Date(end.iso).getTime() - new Date(start.iso).getTime()
      : 3600000;

    const rrule = getVal('RRULE');

    // Collect EXDATE values (excluded dates)
    const exDates = new Set<string>();
    for (const l of lines) {
      if (l.startsWith('EXDATE')) {
        const { value } = parseIcsProp(l);
        for (const v of value.split(',')) {
          const trimmed = v.trim().replace(/\r/g, '');
          const m = trimmed.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
          if (m) {
            if (m[4]) {
              exDates.add(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
            }
            exDates.add(`${m[1]}-${m[2]}-${m[3]}`);
          }
        }
      }
    }

    const makeEvent = (startIso: string, endIso: string, occId: string) => ({
      id: `${calendar}::${occId}`,
      googleEventId: uid,
      title: summary || '(no title)',
      start: startIso,
      end: endIso,
      allDay: start.allDay,
      calendar,
      location: location || undefined,
      description: description || undefined,
      timeZone: start.tz,
    });

    if (rrule) {
      // Expand recurring event using naive (event-local) datetimes
      // so getHours()/getDay() return correct event-timezone values on any server
      const naiveStart = start.naiveIso || start.iso.replace(/Z$/, '');
      const dtStart = new Date(naiveStart);
      // Widen window by ±1 day to compensate for timezone offset mismatch
      // (naive Date vs absolute tMin/tMax). Over-fetching is fine; client filters.
      const occurrences = expandRRule(rrule, dtStart, tMin - 86400000, tMax + 86400000, exDates);
      for (const occ of occurrences) {
        const occEnd = new Date(occ.getTime() + durationMs);
        if (start.allDay) {
          events.push(makeEvent(fmtDate(occ), fmtDate(occEnd), `${uid || `ics-${i}`}_${fmtDate(occ)}`));
        } else {
          // Re-apply timezone offset for each occurrence (DST may differ)
          const sNaive = fmtDateTime(occ);
          const eNaive = fmtDateTime(occEnd);
          const tz = start.tz;
          const sIso = tz && tz !== 'UTC' ? `${sNaive}${tzOffset(tz, sNaive)}` : (tz === 'UTC' ? `${sNaive}Z` : sNaive);
          const eIso = tz && tz !== 'UTC' ? `${eNaive}${tzOffset(tz, eNaive)}` : (tz === 'UTC' ? `${eNaive}Z` : eNaive);
          events.push(makeEvent(sIso, eIso, `${uid || `ics-${i}`}_${fmtDate(occ)}`));
        }
      }
    } else {
      // Single event — time range filter
      const sTime = new Date(start.iso).getTime();
      const eTime = end.iso ? new Date(end.iso).getTime() : sTime + 3600000;
      if (!isNaN(sTime) && eTime >= tMin && sTime <= tMax) {
        events.push(makeEvent(start.iso, end.iso || start.iso, uid || `ics-${i}`));
      }
    }
  }

  return events;
}

// Fallback: GWS proxy for local dev
async function gws(
  path: string,
  params: Record<string, unknown>,
  body?: Record<string, unknown>,
): Promise<string> {
  if (!GWS_PROXY) throw new Error('No GWS_PROXY_URL configured');
  const qs = `params=${encodeURIComponent(JSON.stringify(params))}`;
  const url = `${GWS_PROXY}${path}?${qs}`;
  const res = body
    ? await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    : await fetch(url);
  if (!res.ok) throw new Error(`gws error: ${res.status} ${await res.text()}`);
  return res.text();
}

interface GCalEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  description?: string;
  location?: string;
  recurrence?: string[];
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  reminders?: { useDefault?: boolean; overrides?: { method: string; minutes: number }[] };
  conferenceData?: { entryPoints?: { uri?: string }[] };
  status?: string;
}

function mapGCalEvent(e: GCalEvent, calendar: CalendarSource): Record<string, unknown> {
  const start = e.start?.dateTime || e.start?.date || '';
  const end = e.end?.dateTime || e.end?.date || '';
  const allDay = !e.start?.dateTime;
  return {
    id: `${calendar}::${e.id}`,
    googleEventId: e.id,
    title: e.summary || '(no title)',
    start,
    end,
    allDay,
    calendar,
    location: e.location,
    description: e.description?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    recurrence: e.recurrence?.[0],
    attendees: e.attendees?.map((a) => ({
      email: a.email,
      name: a.displayName,
      status: a.responseStatus || 'needsAction',
    })),
    reminders: e.reminders?.overrides?.map((r) => ({
      method: r.method,
      minutes: r.minutes,
    })),
    conferenceUrl: e.conferenceData?.entryPoints?.find((ep) => ep.uri)?.uri,
    status: e.status,
    timeZone: e.start?.timeZone,
  };
}

// GET /api/calendar?timeMin=...&timeMax=...&calendars=career,personal,...
export async function GET(req: NextRequest) {
  if (IS_DEMO) {
    const { getDemoEvents } = await import('@/lib/demoData');
    return NextResponse.json({ events: getDemoEvents() });
  }
  const { searchParams } = req.nextUrl;
  const timeMin = searchParams.get('timeMin') || new Date().toISOString();
  const timeMax =
    searchParams.get('timeMax') ||
    new Date(Date.now() + 30 * 86400000).toISOString();
  const calFilter = searchParams.get('calendars')?.split(',') as CalendarSource[] | undefined;
  const sources = calFilter || ALL_SOURCES;

  const cal = getCalendarClient();

  try {
    const results = await Promise.allSettled(
      sources.map(async (src) => {
        const meta = CALENDARS[src];
        if (!meta) return [];

        // ICS-based calendars: fetch and parse ICS directly
        if (meta.icsUrl) {
          return fetchIcsEvents(meta.icsUrl, src, timeMin, timeMax);
        }

        if (cal) {
          // Service account path
          const res = await cal.events.list({
            calendarId: meta.googleId,
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500,
          });
          return (res.data.items || []).map((item) => mapGCalEvent(item as GCalEvent, src));
        } else {
          // GWS proxy fallback
          const raw = await gws('/calendar/events/list', {
            calendarId: meta.googleId,
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 2500,
          });
          const data = JSON.parse(raw);
          return (data.items || []).map((item: GCalEvent) => mapGCalEvent(item, src));
        }
      }),
    );

    const allEvents: Record<string, unknown>[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled') {
        errors.push(`${sources[i]}: ${r.reason}`);
        continue;
      }
      for (const evt of r.value) {
        const dedupeKey = `${evt.title}|${evt.start}|${evt.end}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          allEvents.push(evt);
        }
      }
    }

    return NextResponse.json({ events: allEvents, ...(errors.length ? { calendarErrors: errors } : {}) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST /api/calendar — create event
export async function POST(req: NextRequest) {
  if (IS_DEMO) {
    const body = await req.json();
    return NextResponse.json({ ...body, id: `demo-${Date.now()}` });
  }
  const body = await req.json();
  const { calendar, title, start, end, allDay, description, location, timeZone } = body;
  const meta = CALENDARS[calendar as CalendarSource];
  if (!meta || !meta.writable) {
    return NextResponse.json({ error: 'Calendar not writable' }, { status: 400 });
  }

  const event: GCalEvent = {
    summary: title,
    description,
    location,
  };
  if (allDay) {
    event.start = { date: start };
    event.end = { date: end };
  } else {
    event.start = { dateTime: start, timeZone: timeZone || 'America/New_York' };
    event.end = { dateTime: end, timeZone: timeZone || 'America/New_York' };
  }

  const cal = getCalendarClient();

  try {
    if (cal) {
      const res = await cal.events.insert({
        calendarId: meta.googleId,
        requestBody: event,
      });
      return NextResponse.json(mapGCalEvent(res.data as GCalEvent, calendar));
    } else {
      const raw = await gws(
        '/calendar/events/insert',
        { calendarId: meta.googleId },
        event as Record<string, unknown>,
      );
      const created = JSON.parse(raw);
      return NextResponse.json(mapGCalEvent(created, calendar));
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PATCH /api/calendar — update event
export async function PATCH(req: NextRequest) {
  if (IS_DEMO) {
    const body = await req.json();
    return NextResponse.json(body);
  }
  const body = await req.json();
  const { id, calendar, title, start, end, allDay, description, location, timeZone } = body;
  const meta = CALENDARS[calendar as CalendarSource];
  if (!meta || !meta.writable) {
    return NextResponse.json({ error: 'Calendar not writable' }, { status: 400 });
  }

  const googleEventId = id.includes('::') ? id.split('::')[1] : id;
  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.summary = title;
  if (description !== undefined) patch.description = description;
  if (location !== undefined) patch.location = location;
  if (start && end) {
    if (allDay) {
      patch.start = { date: start };
      patch.end = { date: end };
    } else {
      patch.start = { dateTime: start, timeZone: timeZone || 'America/New_York' };
      patch.end = { dateTime: end, timeZone: timeZone || 'America/New_York' };
    }
  }

  const cal = getCalendarClient();

  try {
    if (cal) {
      const res = await cal.events.patch({
        calendarId: meta.googleId,
        eventId: googleEventId,
        requestBody: patch,
      });
      return NextResponse.json(mapGCalEvent(res.data as GCalEvent, calendar));
    } else {
      const raw = await gws(
        '/calendar/events/patch',
        { calendarId: meta.googleId, eventId: googleEventId },
        patch,
      );
      const updated = JSON.parse(raw);
      return NextResponse.json(mapGCalEvent(updated, calendar));
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE /api/calendar?id=...&calendar=...
export async function DELETE(req: NextRequest) {
  if (IS_DEMO) return NextResponse.json({ ok: true });
  const { searchParams } = req.nextUrl;
  const id = searchParams.get('id') || '';
  const calendar = searchParams.get('calendar') as CalendarSource;
  const meta = CALENDARS[calendar];
  if (!meta || !meta.writable) {
    return NextResponse.json({ error: 'Calendar not writable' }, { status: 400 });
  }
  const googleEventId = id.includes('::') ? id.split('::')[1] : id;

  const cal = getCalendarClient();

  try {
    if (cal) {
      await cal.events.delete({
        calendarId: meta.googleId,
        eventId: googleEventId,
      });
      return NextResponse.json({ ok: true });
    } else {
      await gws('/calendar/events/delete', {
        calendarId: meta.googleId,
        eventId: googleEventId,
      });
      return NextResponse.json({ ok: true });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
