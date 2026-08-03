import { exportReportHtml } from "@/lib/export/html";
import type { PresenceReport } from "@/lib/export/types";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const report = (await request.json()) as PresenceReport;
    return new NextResponse(exportReportHtml(report), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": 'attachment; filename="presence_report.html"',
      },
    });
  } catch {
    return NextResponse.json({ error: "Không thể tạo báo cáo HTML." }, { status: 400 });
  }
}
