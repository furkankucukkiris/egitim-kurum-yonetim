$ErrorActionPreference = "Stop"

Write-Host "Eğitim Kurumu Yönetim Sistemi kurulumu başlıyor..." -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js bulunamadı. Önce Node.js 20 veya üzerini kurun."
}

$nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
  throw "Node.js sürümü en az 20 olmalıdır. Mevcut: $(node -v)"
}

npm install

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host ".env.local oluşturuldu. Supabase bilgilerini bu dosyaya girin." -ForegroundColor Yellow
}

Write-Host "Kurulum tamamlandı." -ForegroundColor Green
Write-Host "Uygulamayı başlatmak için: npm run dev"
