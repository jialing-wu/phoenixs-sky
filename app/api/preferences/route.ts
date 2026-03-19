import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

const PREFS_KEY = 'calendar-prefs';

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

interface Preferences {
  hiddenEvents?: string[];
  colorOverrides?: Record<string, string>;
  taskLinks?: Record<string, string>;
  hiddenCalendars?: string[];
}

// GET /api/preferences
export async function GET() {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({} as Preferences);
  }
  try {
    const data = await redis.get<Preferences>(PREFS_KEY);
    return NextResponse.json(data || {});
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// PUT /api/preferences
export async function PUT(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    // No redis configured — silently succeed (localStorage fallback)
    return NextResponse.json({ ok: true });
  }
  try {
    const body: Preferences = await req.json();
    await redis.set(PREFS_KEY, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
