#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js bulunamadı. Önce Node.js 20 veya üzerini kurun."
  exit 1
fi

major="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "$major" -lt 20 ]; then
  echo "Node.js sürümü en az 20 olmalıdır. Mevcut: $(node -v)"
  exit 1
fi

npm install
[ -f .env.local ] || cp .env.example .env.local

echo "Kurulum tamamlandı. Uygulamayı başlatmak için: npm run dev"
