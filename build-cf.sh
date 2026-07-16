#!/usr/bin/env bash
# Monta a pasta dist/ com apenas os arquivos públicos do funil (para o Cloudflare Pages).
set -e
cd "$(dirname "$0")"
rm -rf dist
mkdir -p dist
cp ./*.html dist/
cp checkout.js upsell-checkout.js obrigado.js admin-app.js funnel-track.js price-sync.js dist/
echo "dist pronto: $(ls dist | wc -l) arquivos"
