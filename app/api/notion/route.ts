import { NextResponse } from 'next/server';

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === 'true';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const BASE = 'https://api.notion.com/v1';
const DB_TASKS = process.env.NOTION_DB_TASKS || '';
const DB_DEADLINES = process.env.NOTION_DB_DEADLINES || '';

async function notionPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return res.json();
}

function extractTitle(props: Record<string, Record<string, unknown>>): string {
  for (const prop of Object.values(props)) {
    if (prop?.type === 'title' && prop?.title) {
      return ((prop.title as { plain_text: string }[])?.[0]?.plain_text) || '';
    }
  }
  return '';
}

// Query Tasks DB: active research projects (Preparing, Writing, Revising, Review)
async function queryTasks() {
  if (!DB_TASKS) return [];
  try {
    const data = await notionPost(`/databases/${DB_TASKS}/query`, {
      filter: {
        or: [
          { property: 'Status', status: { equals: 'Preparing' } },
          { property: 'Status', status: { equals: 'Writing' } },
          { property: 'Status', status: { equals: 'Revising' } },
        ],
      },
      sorts: [{ property: 'Status', direction: 'ascending' }],
      page_size: 50,
    });
    return (data.results || []).map((page: Record<string, unknown>) => {
      const props = page.properties as Record<string, Record<string, unknown>>;
      return {
        id: page.id,
        title: extractTitle(props),
        status: (props?.Status?.status as { name: string })?.name || '',
        deadline: (props?.Deadline?.date as { start: string })?.start,
        database: 'Projects',
        url: page.url as string | undefined,
      };
    });
  } catch (err) {
    console.error('Notion tasks query failed:', err);
    return [];
  }
}

// Query Deadlines DB: next 30 days, exclude "Idea" and "Submitted" tags
async function queryDeadlines() {
  if (!DB_DEADLINES) return [];
  try {
    const data = await notionPost(`/databases/${DB_DEADLINES}/query`, {
      filter: {
        or: [
          { property: 'Leader', multi_select: { contains: 'Phoenix' } },
          { property: 'Leader', multi_select: { contains: 'All' } },
        ],
      },
      sorts: [{ property: 'Date', direction: 'ascending' }],
      page_size: 50,
    });
    return (data.results || []).map((page: Record<string, unknown>) => {
      const props = page.properties as Record<string, Record<string, unknown>>;
      const dateVal = (props?.Date?.date as { start: string })?.start;
      const tags = ((props?.Tags?.multi_select || []) as { name: string }[]).map(t => t.name);
      const daysLeft = dateVal ? Math.ceil((new Date(dateVal).getTime() - Date.now()) / 86400000) : null;
      return {
        id: page.id,
        title: extractTitle(props),
        status: daysLeft !== null ? `${daysLeft}d` : '',
        deadline: dateVal,
        database: 'Deadlines',
        url: page.url as string | undefined,
        tags,
        daysLeft,
      };
    }).filter((e: { tags: string[] }) => !e.tags.includes('Idea') && !e.tags.includes('Submitted'));
  } catch (err) {
    console.error('Notion deadlines query failed:', err);
    return [];
  }
}

export async function GET() {
  if (IS_DEMO) {
    const { getDemoNotionEntries } = await import('@/lib/demoData');
    return NextResponse.json({ entries: getDemoNotionEntries() });
  }
  if (!NOTION_TOKEN) {
    return NextResponse.json({ entries: [], error: 'NOTION_TOKEN not set' });
  }
  try {
    const [tasks, deadlines] = await Promise.all([queryTasks(), queryDeadlines()]);
    return NextResponse.json({ entries: [...tasks, ...deadlines] });
  } catch (err) {
    return NextResponse.json({ entries: [], error: String(err) });
  }
}
