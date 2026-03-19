# Phoenix's Sky

An agent-native calendar you can fully customize with AI.

Phoenix is a busy bird — delivering letters, training with the flock, and sneaking into human cafés. Two AI agents help manage the chaos: **Piper** handles work logistics, **Robin** watches out for rest and wellbeing. Together they leave notes, flag conflicts, and keep Phoenix's sky life on track.

> Zero UI libraries. Pure CSS Modules. Built to be read and rewritten by AI.

<video src="https://github.com/jialing-wu/phoenixs-sky/raw/main/public/demo.mp4" width="100%" autoplay muted loop></video>

## Quick Start

```bash
git clone https://github.com/jialing-wu/phoenixs-sky.git
cd phoenixs-sky
cp .env.example .env.local   # demo mode is on by default
npm install
npm run dev
```

Opens at `localhost:3000` with mock data — no API keys needed.

## What You Get

- **Day / Week / Month views** with click-to-create and drag-to-resize
- **2 AI agents** — Piper (work) and Robin (life) leave daily notes on your schedule
- **Todoist sync** — tasks show in the sidebar, checked off in real time
- **Notion tracker** — projects, deadlines, and weekly goals at a glance
- **Right-click menu** — hide events, recolor them, link to tasks
- **Mobile-ready** — floating action buttons, swipe navigation
- **Dark mode** — `prefers-color-scheme` toggles a full cyberpunk theme

## Make It Yours

This project is designed to be customized by you and your AI. Open it in Claude Code, Cursor, Copilot — whatever you use — and start prompting:

- *"Add a third agent called Sparrow that tracks my fitness goals"*
- *"Change the color palette to ocean blues"*
- *"Connect my Outlook calendar instead of Google"*
- *"Add a weather widget in the sidebar"*
- *"Create a focus mode that dims everything except the next 2 hours"*

### Connect Real Data

When you're ready to go beyond demo mode, set `NEXT_PUBLIC_DEMO=false` in `.env.local` and fill in your keys:

| Service | What it does | Required? |
|---|---|---|
| Google Calendar | Read & write events | Yes, for real data |
| Todoist | Task management | Optional |
| Notion | Project tracking | Optional |
| Upstash Redis | Sync preferences across devices | Optional |

See `.env.example` for all variables.

---

# For Agents

*The section below is written for AI coding agents who will help users customize this project. If you're a human, you can skip this — or read it to understand how things fit together.*

## Architecture at a Glance

```
app/
  layout.tsx              Root layout, fonts, metadata
  page.tsx                Main client component — all state lives here
  globals.css             Theme: colors, typography, CSS variables
  api/
    calendar/route.ts     Google Calendar read/write + ICS feeds
    todoist/route.ts      Todoist CRUD
    notion/route.ts       Notion database queries
    preferences/route.ts  Redis key-value for user prefs

components/
  Header.tsx              Nav bar — view switcher (D/W/M), calendar toggles
  DayView.tsx             Hour grid + editorial panel (agent notes, detail)
  WeekView.tsx            7-column hour grid
  MonthView.tsx           Month grid with event pills
  Sidebar.tsx             Date picker, todos, Notion entries
  EventDetail.tsx         Event inspector + create form
  ContextMenu.tsx         Right-click: hide, recolor, link task

lib/
  calendarConfig.ts       Calendar definitions, agent mappings, colors
  demoData.ts             Mock data generator (date-relative, always fresh)
  mockData.ts             TypeScript interfaces (CalendarEvent, TodoItem, etc.)
  layoutEvents.ts         Overlap/column layout algorithm for day/week grids
```

## Key Conventions

1. **No UI libraries.** Every component is plain React + CSS Modules. No Tailwind, no shadcn, no MUI. This makes the code fully readable to any AI without needing library docs.

2. **Demo / Prod dual mode.** `NEXT_PUBLIC_DEMO=true` routes all API calls to `lib/demoData.ts` instead of hitting real services. When a user asks you to add a feature, make it work in demo mode first — it's faster to iterate and doesn't require API keys.

3. **All state in `page.tsx`.** There's no state library. Events, todos, preferences, UI state — it all lives in the root component and flows down as props. Simple to trace, simple to extend.

4. **CSS variables for theming.** Colors, fonts, and spacing are defined in `globals.css` as `--var` tokens. Components reference these, so changing a theme is one file edit.

5. **Agent notes are just events.** An agent note is a regular `CalendarEvent` on the `notes` calendar, with the title formatted as `agentName — message`. No special data model needed.

## How to Guide a User Through Customization

When a user asks you to customize this calendar, follow this workflow:

### Step 1 — Understand what they want

Ask about the *outcome*, not the implementation. "What should it look like when it's done?" is better than "Which component should I modify?"

### Step 2 — Pick the right file

| User wants to... | Edit this |
|---|---|
| Add/remove a calendar | `lib/calendarConfig.ts` — add entry to the calendar record |
| Add a new agent | `lib/calendarConfig.ts` — add `agent` + `agentLabel` to a calendar |
| Change colors or fonts | `app/globals.css` — update CSS variables |
| Modify a view layout | `components/DayView.tsx`, `WeekView.tsx`, or `MonthView.tsx` |
| Add sidebar content | `components/Sidebar.tsx` |
| Add a new data source | Create `app/api/newSource/route.ts`, add fetch in `page.tsx` |
| Change the right-click menu | `components/ContextMenu.tsx` |
| Add mock data for demo | `lib/demoData.ts` — add to the relevant generator function |

### Step 3 — Make it work in demo mode first

Edit `lib/demoData.ts` to include mock data for the new feature. This lets the user see results immediately without configuring external services.

### Step 4 — Show, don't tell

After making changes, use the dev server preview to verify. Take a screenshot or describe what changed. The user should see the result before you move on.

### Step 5 — Small steps

Don't rewrite three components at once. Make one change, confirm it works, then move to the next. If something breaks, it's easy to pinpoint.

## Example: Adding a New Agent

User says: *"Add a Sparrow agent that tracks my exercise."*

1. **`lib/calendarConfig.ts`** — Add a new calendar entry:
   ```ts
   fitness: {
     label: 'Fitness',
     color: '#D4A017',
     googleId: 'demo-fitness',
     writable: true,
     agent: 'sparrow',
     agentLabel: 'sparrow (agent 3)',
   },
   ```

2. **`lib/demoData.ts`** — Add sample events and an agent note:
   ```ts
   { id: id(), title: 'Morning Run — River Trail', start: relDate(1, 6, 30), end: relDate(1, 7, 30), calendar: 'fitness' },
   { id: id(), title: 'sparrow — Great pace yesterday. Try adding hill intervals today.', start: dateOnly(0), end: dateOnly(0), calendar: 'notes', allDay: true },
   ```

3. **Verify** — the new events appear in all three views, and Sparrow's note shows in the editorial panel.

## Example: Connecting a New API

User says: *"I want to see my GitHub issues in the sidebar."*

1. **`app/api/github/route.ts`** — New API route that fetches issues (with a demo guard):
   ```ts
   if (process.env.NEXT_PUBLIC_DEMO === 'true') {
     return Response.json(getMockGitHubIssues());
   }
   // real GitHub API call here
   ```

2. **`lib/demoData.ts`** — Add `getMockGitHubIssues()` with 3-4 sample items.

3. **`app/page.tsx`** — Add state + fetch, pass to Sidebar.

4. **`components/Sidebar.tsx`** — Render the new section below Notion entries.

## Things to Watch Out For

- **Don't break demo mode.** Every API route starts with `if (NEXT_PUBLIC_DEMO === 'true') return mock`. New routes should follow this pattern.
- **CSS Modules scope styles.** Each component has its own `.module.css`. Don't use global class names in components.
- **Mobile matters.** Test at 375px width. The app uses responsive breakpoints in CSS Modules — check that new UI doesn't overflow.
- **Agent notes have a naming convention.** The title format `agentName — message` is parsed by `DayView.tsx` to render agent-colored notes. Keep this format when adding new agents.
