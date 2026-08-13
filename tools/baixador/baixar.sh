#!/bin/bash
# ============================================================
# BAIXADOR EM MASSA — baixa todos os vídeos dos seus perfis
# (Instagram, TikTok ou qualquer URL) para repostar em outras redes.
#
# Uso:
#   ./baixar.sh instagram          # baixa todos os vídeos do perfil do IG
#   ./baixar.sh tiktok             # baixa todos os vídeos do perfil do TikTok
#   ./baixar.sh tudo               # baixa IG + TikTok
#   ./baixar.sh url <link>         # baixa qualquer link (post único, outro site)
#
# Já baixados não são baixados de novo (arquivo de histórico .archive).
# Rode de novo toda semana: ele pega só o que for novo.
# ============================================================

set -uo pipefail

# ---------- CONFIGURAÇÃO (edite aqui) ----------
IG_USER="eu_agathaluisa"          # perfil do Instagram (sem @)
TIKTOK_USER=""                    # perfil do TikTok (sem @) — preencha quando tiver
BROWSER="chrome"                  # navegador onde você está LOGADA no Instagram: chrome | safari | firefox | edge | brave
# -----------------------------------------------

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/downloads"
mkdir -p "$OUT/instagram" "$OUT/tiktok" "$OUT/outros"

erro() { echo "❌ $1" >&2; exit 1; }

# As ferramentas foram instaladas via pip (--user), que não fica no PATH padrão.
# Descobrimos a pasta na hora, então funciona mesmo se a versão do Python mudar.
PYBIN="$(python3 -c 'import site,os;print(os.path.join(site.USER_BASE,"bin"))' 2>/dev/null)"
[ -n "$PYBIN" ] && PATH="$PYBIN:$PATH"

INSTALAR="Rode: python3 -m pip install --user --upgrade yt-dlp gallery-dl"
command -v yt-dlp >/dev/null     || erro "yt-dlp não encontrado. $INSTALAR"
command -v gallery-dl >/dev/null || erro "gallery-dl não encontrado. $INSTALAR"

baixar_instagram() {
  echo "📥 Instagram: @$IG_USER (usando login do $BROWSER)"
  # gallery-dl é a ferramenta mais estável p/ perfil inteiro do IG.
  # Precisa dos cookies do navegador onde a conta está logada (senão o IG bloqueia).
  gallery-dl \
    --cookies-from-browser "$BROWSER" \
    --download-archive "$OUT/instagram/.archive" \
    --filter "extension in ('mp4', 'mov', 'webm')" \
    --sleep 3-8 \
    -D "$OUT/instagram" \
    "https://www.instagram.com/$IG_USER/" \
    || echo "⚠️  Instagram falhou ou terminou com avisos. Veja mensagens acima (login expirado? troque BROWSER no topo do script)."
  echo "✅ Instagram concluído → $OUT/instagram"
}

baixar_tiktok() {
  [ -n "$TIKTOK_USER" ] || erro "TIKTOK_USER vazio. Edite o topo do script e preencha o @ do TikTok."
  echo "📥 TikTok: @$TIKTOK_USER"
  yt-dlp \
    --download-archive "$OUT/tiktok/.archive" \
    --cookies-from-browser "$BROWSER" \
    -o "$OUT/tiktok/%(upload_date)s_%(id)s.%(ext)s" \
    --sleep-interval 3 --max-sleep-interval 8 \
    "https://www.tiktok.com/@$TIKTOK_USER" \
    || echo "⚠️  TikTok falhou ou terminou com avisos. Veja mensagens acima."
  echo "✅ TikTok concluído → $OUT/tiktok"
}

baixar_url() {
  local URL="$1"
  echo "📥 Baixando: $URL"
  yt-dlp \
    --cookies-from-browser "$BROWSER" \
    -o "$OUT/outros/%(title).80s_%(id)s.%(ext)s" \
    "$URL" \
  || gallery-dl --cookies-from-browser "$BROWSER" -D "$OUT/outros" "$URL" \
  || erro "Nenhuma ferramenta conseguiu baixar essa URL."
  echo "✅ Concluído → $OUT/outros"
}

case "${1:-}" in
  instagram) baixar_instagram ;;
  tiktok)    baixar_tiktok ;;
  tudo)      baixar_instagram; baixar_tiktok ;;
  url)       [ -n "${2:-}" ] || erro "Uso: ./baixar.sh url <link>"; baixar_url "$2" ;;
  *)
    echo "Uso:"
    echo "  ./baixar.sh instagram   — todos os vídeos do @$IG_USER"
    echo "  ./baixar.sh tiktok      — todos os vídeos do TikTok (configure o @ no topo)"
    echo "  ./baixar.sh tudo        — os dois"
    echo "  ./baixar.sh url <link>  — um link qualquer (post, reel, vídeo de outra rede)"
    exit 1
    ;;
esac