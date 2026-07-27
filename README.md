# Eğitim Kurumu Yönetim Sistemi

Responsive çalışan, öğrenci kayıtları, tahakkuk/tahsilat, yoklama, öğretmen çalışma takibi, kasa-banka hareketleri ve raporlama için hazırlanmış başlangıç projesidir.

## Teknoloji

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Supabase Auth + PostgreSQL + Storage
- Supabase CLI ve SQL migration yapısı

## 1. Gereksinimler

- Node.js 20 veya üzeri
- npm
- Git
- Yerel Supabase kullanacaksanız Docker Desktop

## 2. Kurulum

```bash
npm install
cp .env.example .env.local
npm run dev
```

Tarayıcıda `http://localhost:3000` adresini açın.

> Supabase bilgileri girilmeden uygulama demo verileriyle açılır. Gerçek veri yazılmaz.

## 3. Supabase bulut projesi bağlama

1. Supabase üzerinde yeni proje oluşturun.
2. Project URL, Publishable Key ve `service_role` anahtarını `.env.local` içine yazın.
3. CLI ile giriş yapın ve projeyi bağlayın:

```bash
npx supabase login
npx supabase link --project-ref PROJE_REF
npx supabase db push
```

`SUPABASE_SERVICE_ROLE_KEY` yalnızca sunucuda öğretmen Auth hesabı
oluşturmak için kullanılır. Bu değişkene `NEXT_PUBLIC_` öneki
eklemeyin; anahtarı tarayıcı koduna veya Git deposuna koymayın.

## 4. Yerel Supabase ile geliştirme

Docker Desktop çalışırken:

```bash
npx supabase start
npx supabase db reset
```

Komut çıktısındaki yerel API URL ve publishable/anon key değerlerini `.env.local` içine yazın.

## 5. İlk yönetici hesabı

İlk kullanıcıyı Supabase Dashboard > Authentication > Users ekranından oluşturun. Ardından SQL Editor'da kullanıcının `auth.users.id` değeriyle aşağıdaki kaydı ekleyin:

```sql
insert into public.organizations (name)
values ('Şermin Şahin Kişisel Gelişim Kursu')
returning id;

insert into public.profiles (id, organization_id, full_name, role)
values (
  'AUTH_USER_UUID',
  'ORGANIZATION_UUID',
  'Yönetici',
  'admin'
);
```

## 6. Önemli klasörler

```text
src/app/                 Sayfalar
src/components/          Ortak arayüz bileşenleri
src/lib/supabase/        Supabase istemci ve oturum kodları
supabase/migrations/     Veritabanı şeması ve RLS politikaları
```

## 7. Öğretmen hesabı akışı

1. Yönetici, **Öğretmenler** ekranından ad, e-posta ve telefonla
   gerçek öğretmen hesabı oluşturur.
2. Sistem bir defaya mahsus geçici parola gösterir.
3. Öğretmen e-posta ve geçici parolayla giriş yapar.
4. İlk girişte kendi güçlü parolasını belirlemeden panele geçemez.
5. Öğretmen yalnızca kendisine atanmış seansları, öğrencileri ve
   ders bazlı MEB kayıt durumlarını görür.

Geçici parola kaybolursa yönetici aynı ekrandan yeni bir geçici
parola üretebilir. Öğretmen hesabını silmek yerine pasife alma
seçeneği kullanılır; böylece geçmiş kayıtların bağlantıları korunur.

## 8. Mevcut başlangıç ekranları

- Yönetim paneli
- Öğrenciler
- Ödemeler
- Yoklama
- Öğretmenler
- Raporlar
- Giriş ekranı

## 9. Sonraki geliştirme sırası

1. Gerçek kullanıcı/rol akışı
2. Öğrenci ve veli CRUD işlemleri
3. Ders kayıtları ve fiyatlandırma
4. Aylık tahakkuk üretimi
5. Ödeme ve ödeme dağıtımı
6. Yoklama ve telafi
7. Kasa/ATM yatırımı mutabakatı
8. Öğretmen hak edişi
9. Aylık raporlar

## Güvenlik notu

`service_role` anahtarını hiçbir zaman `NEXT_PUBLIC_` değişkeninde veya tarayıcı kodunda kullanmayın. Gerçek çocuk/veli verisini taşımadan önce KVKK, veri barındırma bölgesi, yedekleme ve kullanıcı yetkileri ayrıca gözden geçirilmelidir.
