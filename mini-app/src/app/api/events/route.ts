import { NextResponse } from 'next/server';
import { mockEvents } from '@/lib/mock-data';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter');

  let events = [...mockEvents];

  if (filter && filter !== 'all') {
    switch (filter) {
      case 'ai':
        events = events.filter((e) =>
          ['stranger_detected', 'object_left', 'camera_blocked'].includes(e.type)
        );
        break;
      case 'rfid':
        events = events.filter((e) =>
          ['access_granted', 'access_denied', 'rfid_scan'].includes(e.type)
        );
        break;
    }
  }

  return NextResponse.json({ events });
}
