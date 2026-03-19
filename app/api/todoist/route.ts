import { NextRequest, NextResponse } from 'next/server';

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO === 'true';
const TODOIST_TOKEN = process.env.TODOIST_TOKEN || '';
const BASE = 'https://api.todoist.com/api/v1';

async function todoistFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TODOIST_TOKEN}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) throw new Error(`Todoist ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

export async function GET(req: NextRequest) {
  if (IS_DEMO) {
    const { getDemoTodos } = await import('@/lib/demoData');
    return NextResponse.json({ tasks: getDemoTodos() });
  }
  if (!TODOIST_TOKEN) {
    return NextResponse.json({ tasks: [], error: 'TODOIST_TOKEN not set' });
  }
  try {
    const { searchParams } = new URL(req.url);
    const range = searchParams.get('range'); // today | week

    const data = await todoistFetch('/tasks');
    const tasks = data.results || data;
    const mapped = (Array.isArray(tasks) ? tasks : []).map((t: Record<string, unknown>) => ({
      id: t.id,
      title: t.content,
      due: (t.due as Record<string, string>)?.date,
      priority: t.priority,
      done: t.checked || false,
      labels: t.labels,
      parentId: t.parent_id || null,
    }));

    if (!range) {
      return NextResponse.json({ tasks: mapped });
    }

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    const filtered = mapped.filter((t: { due?: string }) => {
      if (!t.due) return false;
      const dueDate = t.due.split('T')[0];
      if (range === 'today') {
        return dueDate <= todayStr; // overdue + today
      }
      if (range === 'week') {
        const weekEnd = new Date(now);
        weekEnd.setDate(weekEnd.getDate() + 7);
        const weekEndStr = weekEnd.toISOString().split('T')[0];
        return dueDate <= weekEndStr; // overdue + this week
      }
      return true;
    });

    return NextResponse.json({ tasks: filtered });
  } catch (err) {
    return NextResponse.json({ tasks: [], error: String(err) });
  }
}

// POST: close, reopen, create, update
export async function POST(req: NextRequest) {
  if (IS_DEMO) {
    const body = await req.json();
    return NextResponse.json({ ok: true, task: { id: `demo-${Date.now()}`, ...body } });
  }
  if (!TODOIST_TOKEN) {
    return NextResponse.json({ error: 'TODOIST_TOKEN not set' }, { status: 500 });
  }
  try {
    const body = await req.json();
    const { action, id, ...data } = body;

    switch (action) {
      case 'close': {
        await todoistFetch(`/tasks/${id}/close`, { method: 'POST' });
        return NextResponse.json({ ok: true });
      }
      case 'reopen': {
        await todoistFetch(`/tasks/${id}/reopen`, { method: 'POST' });
        return NextResponse.json({ ok: true });
      }
      case 'create': {
        const created = await todoistFetch('/tasks', {
          method: 'POST',
          body: JSON.stringify(data),
        });
        return NextResponse.json({ task: created });
      }
      case 'update': {
        const updated = await todoistFetch(`/tasks/${id}`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
        return NextResponse.json({ task: updated });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE: delete task
export async function DELETE(req: NextRequest) {
  if (IS_DEMO) return NextResponse.json({ ok: true });
  if (!TODOIST_TOKEN) {
    return NextResponse.json({ error: 'TODOIST_TOKEN not set' }, { status: 500 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    await todoistFetch(`/tasks/${id}`, { method: 'DELETE' });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
