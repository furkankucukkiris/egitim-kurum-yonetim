import { NextResponse } from "next/server";

// Hosting sağlayıcısının (Vercel/vb.) health check'i için. Bilinçli
// olarak veritabanına, Supabase'e veya herhangi bir yapılandırma
// değerine dokunmaz — yalnızca Next.js sunucu process'inin ayakta
// olduğunu doğrular. Kullanıcı sayısı, kurum bilgisi, ortam değişkeni
// durumu gibi hiçbir hassas veya iç bilgi döndürmemelidir.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
