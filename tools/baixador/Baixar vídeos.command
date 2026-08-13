#!/bin/bash
# Atalho de 2 cliques do baixador em massa.
# Ele usa o login do Instagram que já está no seu CHROME (via cookies) —
# na 1ª vez o macOS vai pedir a senha do Chaveiro: clique "Sempre Permitir".

cd "$(dirname "$0")"

echo "╭──────────────────────────────────────────╮"
echo "│   BAIXADOR EM MASSA — @eu_agathaluisa    │"
echo "╰──────────────────────────────────────────╯"
echo ""
echo "  1) Instagram (todos os vídeos do perfil)"
echo "  2) TikTok (todos os vídeos do perfil)"
echo "  3) Tudo (Instagram + TikTok)"
echo "  4) Um link avulso (qualquer rede)"
echo ""
read -p "Escolha [1-4]: " opc

case "$opc" in
  1) ./baixar.sh instagram ;;
  2) ./baixar.sh tiktok ;;
  3) ./baixar.sh tudo ;;
  4) read -p "Cole o link: " link; ./baixar.sh url "$link" ;;
  *) echo "Opção inválida." ;;
esac

echo ""
echo "Os vídeos estão na pasta: $(pwd)/downloads"
read -p "Pressione Enter para fechar..."
