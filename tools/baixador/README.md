# Baixador em massa (Instagram / TikTok / qualquer rede)

Baixa **todos os vídeos do seu próprio perfil** de uma vez, para você repostar nas outras redes. Não é uma extensão de navegador de propósito: linha de comando baixa em massa de verdade, sem limite de 1 vídeo por clique, e lembra o que já baixou.

## Instalação (uma vez só)

```bash
brew install yt-dlp gallery-dl
chmod +x baixar.sh
```

## Uso

1. Abra o Chrome e confira que está **logada no Instagram** (o IG bloqueia download sem login, mesmo do próprio perfil).
2. Rode:

```bash
cd "/Users/macbookpro/Documents/Projetos/Funilhot/tools/baixador"
./baixar.sh instagram      # todos os vídeos do @eu_agathaluisa
./baixar.sh tiktok         # (preencha TIKTOK_USER no topo do script antes)
./baixar.sh url <link>     # um link avulso de qualquer rede
```

Os vídeos caem em `downloads/instagram/`, `downloads/tiktok/`, `downloads/outros/`.

## Rotina semanal

Rode `./baixar.sh tudo` 1x por semana: os arquivos `.archive` guardam o histórico, então **só o que for novo é baixado**. É o seu backup automático do acervo.

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| "login required" / 401 | Cookie expirado | Faça login no IG no Chrome de novo e rode outra vez |
| macOS pede senha do Chaveiro | Leitura dos cookies do Chrome | Permita ("Sempre Permitir") — é local, nada sai da máquina |
| Baixa parou no meio | Rate-limit do IG | Espere 1–2h e rode de novo (continua de onde parou) |
| Quer usar Safari em vez de Chrome | — | Troque `BROWSER="chrome"` por `safari` no topo do script |

## Aviso

Use **apenas nos perfis seus/da sua modelo** (com autorização dela por escrito, de preferência no contrato). Baixar acervo próprio para repost é uso legítimo; baixar conteúdo de terceiros para repostar é violação de direitos autorais.
