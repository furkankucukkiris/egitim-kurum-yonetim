import "server-only";

export type WhatsAppSendInput = {
  to: string;
  body: string;
  idempotencyKey: string;
};

export type WhatsAppSendResult =
  | {
      success: true;
      provider: string;
      providerMessageId: string;
    }
  | {
      success: false;
      provider: string;
      errorCode: string;
      errorMessage: string;
    };

export interface WhatsAppAdapter {
  send(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
}

// Gerçek bir sağlayıcı entegrasyonu henüz yok — bu adapter HİÇBİR
// ağ isteği yapmaz, her zaman "sağlayıcı yapılandırılmadı" ile
// başarısız döner. Gönderim akışı bunu kullanarak mesajı hep
// 'failed'/'provider_not_configured' durumunda bırakır, asla
// gerçekte gönderilmemiş bir mesajı 'sent' göstermez.
class NullWhatsAppAdapter implements WhatsAppAdapter {
  async send(): Promise<WhatsAppSendResult> {
    return {
      success: false,
      provider: "null",
      errorCode: "provider_not_configured",
      errorMessage: "WhatsApp sağlayıcı entegrasyonu henüz yapılandırılmadı.",
    };
  }
}

export function getWhatsAppAdapter(): WhatsAppAdapter {
  // Gerçek sağlayıcı seçimi (ör. Meta WhatsApp Cloud API) ileriki bir
  // fazda buraya eklenecek — WHATSAPP_PROVIDER env değişkeni ile
  // seçilecek, API anahtarı yalnızca o adapter'ın içinde,
  // process.env üzerinden okunacak ve hiçbir zaman loglanmayacak.
  return new NullWhatsAppAdapter();
}
