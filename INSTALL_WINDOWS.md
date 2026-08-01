# Windows Kurulum Rehberi

## 1. Programları kurun

- Node.js 20 veya üzeri
- Git
- Visual Studio Code
- Yerel Supabase kullanacaksanız Docker Desktop

Kurulumları kontrol etmek için PowerShell açın:

```powershell
node -v
npm -v
git --version
```

## 2. Projeyi açın

ZIP dosyasını bir klasöre çıkarın ve klasör içinde PowerShell açın.

Otomatik kurulum:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

Manuel kurulum:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Tarayıcı adresi:

```text
http://localhost:3000
```

## 3. Supabase bilgilerini girin

`.env.local` dosyasını açın:

```env
NEXT_PUBLIC_SUPABASE_URL=https://PROJE_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YAYINLANABILIR_ANAHTAR
SUPABASE_SERVICE_ROLE_KEY=SERVICE_ROLE_ANAHTARI
NEXT_PUBLIC_INSTITUTION_NAME=Şermin Şahin Kişisel Gelişim Kursu
```

`SUPABASE_SERVICE_ROLE_KEY` yalnızca sunucuda kullanılmalıdır.
Değişken adının başına `NEXT_PUBLIC_` eklemeyin ve `.env.local`
dosyasını Git'e göndermeyin.

## 4. Veritabanını kurun

Supabase bulut projenizi oluşturduktan sonra:

```powershell
npx supabase login
npx supabase link --project-ref PROJE_REF
npx supabase db push
```

Yerel Supabase kullanacaksanız Docker Desktop açıkken:

```powershell
npx supabase start
npx supabase db reset
```

## 5. Sorun giderme

PowerShell script çalıştırma engeli çıkarsa yalnızca o terminal için:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
```

Ardından kurulum scriptini yeniden çalıştırın.
