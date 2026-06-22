import { NextResponse } from 'next/server';
import { getRequester } from '@/lib/server-auth';

export async function GET(request: Request) {
  const requester = await getRequester(request);
  return NextResponse.json({
    role: requester.role,
    user: requester.user,
  });
}
