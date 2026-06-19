import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

export async function GET() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/mqtt/status`, {
      next: { revalidate: 5 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: 'Backend unavailable' },
        { status: 502 }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      mqttConnected: data.connection?.connected ?? false,
      doorOpen: data.summary?.doorOpen ?? false,
      motionDetected: data.summary?.motionDetected ?? false,
      temperatureC: data.summary?.temperatureC,
      humidityPct: data.summary?.humidityPct,
      modelLabel: data.summary?.modelLabel,
      anomalyScore: data.summary?.anomalyScore,
      lastUpdate: data.summary?.updatedAt,
    });
  } catch (error) {
    console.error('[API /status] Error:', error);
    return NextResponse.json(
      {
        mqttConnected: false,
        doorOpen: false,
        motionDetected: false,
        error: 'Cannot reach backend',
      },
      { status: 200 }
    );
  }
}
