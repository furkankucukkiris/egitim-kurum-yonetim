import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { dispatchPendingNotifications } from "@/lib/notifications/dispatch";

// pg_cron (run_notification_tick) kuyrukta bekleyen bildirim olduğunda
// bu adrese pg_net ile istek atar. Paylaşılan gizli anahtar Supabase
// Vault'ta (notification_dispatch_secret) ve Vercel'de
// (NOTIFICATION_DISPATCH_SECRET) aynı olmalıdır.
export async function POST(request: NextRequest) {
  const secret = process.env.NOTIFICATION_DISPATCH_SECRET;
  const header = request.headers.get("authorization") ?? "";

  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await dispatchPendingNotifications();

  return NextResponse.json(result);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}
