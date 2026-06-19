import { NextResponse } from 'next/server';
import { mockCards } from '@/lib/mock-data';
import type { RfidCard } from '@/types';

// In-memory store (resets on server restart)
let cards: RfidCard[] = [...mockCards];

export async function GET() {
  return NextResponse.json({ cards: cards.filter((c) => c.isActive) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { cardUid, name } = body;

    if (!cardUid || !name) {
      return NextResponse.json(
        { ok: false, error: 'cardUid và name là bắt buộc' },
        { status: 422 }
      );
    }

    // Check for duplicate
    if (cards.some((c) => c.cardUid === cardUid && c.isActive)) {
      return NextResponse.json(
        { ok: false, error: 'Thẻ này đã tồn tại trong hệ thống' },
        { status: 409 }
      );
    }

    const newCard: RfidCard = {
      id: `card-${Date.now()}`,
      cardUid,
      name,
      isActive: true,
      addedAt: new Date().toISOString(),
    };

    cards.push(newCard);
    return NextResponse.json({ ok: true, card: newCard }, { status: 201 });
  } catch (error) {
    console.error('[API /cards] POST Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Dữ liệu không hợp lệ' },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json(
      { ok: false, error: 'id là bắt buộc' },
      { status: 422 }
    );
  }

  const card = cards.find((c) => c.id === id);
  if (!card) {
    return NextResponse.json(
      { ok: false, error: 'Không tìm thấy thẻ' },
      { status: 404 }
    );
  }

  card.isActive = false;
  return NextResponse.json({ ok: true, message: 'Đã vô hiệu hóa thẻ' });
}
