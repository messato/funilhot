# Baixador de Vídeos — extensão do Chrome

Extensão (Manifest V3) que **detecta qualquer vídeo da aba** e baixa, deixando você **escolher a pasta de destino**. Não precisa de programa, servidor nem login especial — usa a própria sessão do navegador.

## Instalar (1 minuto, sem loja)

1. Abra `chrome://extensions` no Chrome.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique **Carregar sem compactação** (*Load unpacked*).
4. Selecione esta pasta:
   `Documents/Projetos/Funilhot/tools/baixador-extensao`
5. O ícone rosa ↓ aparece na barra. Clique nele em qualquer página com vídeo.
   *(Fixe no lugar: clique no quebra-cabeça 🧩 → alfinete ao lado do "Baixador de Vídeos".)*

Para atualizar depois de mexer no código: volte em `chrome://extensions` e clique em **Atualizar** (⟳) no card da extensão.

## Como usar

1. Abra o perfil/página e clique no ícone da extensão.
2. Clique em **Analisar página** — ela rola o perfil inteiro sozinha e vai captando os vídeos em tempo real (o contador sobe). Veja abaixo *por que isso é necessário*.
3. Escolha o **destino** no topo do popup:
   - **Escolher pasta** → abre a janela "Salvar como" e você navega até **qualquer pasta** (Desktop, HD externo, etc.).
   - **Downloads / subpasta** → salva direto, sem perguntar, dentro de `Downloads/<subpasta>` (ex.: `Downloads/Agatha`).
4. Clique **Baixar** no vídeo (ou **Baixar todos**). Também dá pra colar um link direto no campo do meio.
5. O botão **↻ (recarregar)** no topo re-varre a página na hora; o número no ícone da barra mostra quantos vídeos há na aba.

## O popup fecha quando troco de aba

Isso é regra do Chrome: **todo** popup de extensão fecha ao perder o foco — nenhuma extensão consegue evitar. O que importa é que isso **não interrompe mais nada**:

- A **análise continua rodando** com o popup fechado (a rolagem acontece dentro da página, não no popup). Reabra e ele mostra o andamento — inclusive o botão vira **Parar análise**.
- Os **downloads continuam** normalmente (quem baixa é o Chrome, não o popup) — inclusive a montagem dos vídeos HLS.
- Se quiser uma janela que **nunca fecha**, clique no botão **⧉ (abrir em janela)** no topo: abre a mesma tela numa janela solta, que fica visível enquanto você navega em outras abas. Ela fica presa à aba de onde foi aberta.

## Por que "Analisar página" (e por que às vezes captura poucos)

O Instagram/TikTok **não baixam o arquivo do vídeo enquanto você não abre/toca nele** — na grade do perfil só carregam as miniaturas (imagens). Então uma detecção passiva só enxerga os vídeos que já rodaram.

Esta extensão contorna isso de duas formas:
- **Lê as URLs de vídeo direto do JSON** que o app do site recebe (é assim que os baixadores de perfil funcionam). Isso pega vídeos que ainda nem tocaram.
- **Analisar página** rola o perfil até o fim, forçando o site a carregar mais posts — e cada lote traz mais URLs pelo item acima.

Mesmo assim, alguns perfis só entregam a URL do vídeo quando o reel é **aberto**. Se faltar algum, abra os reels que faltam (ou role a aba *Reels*) e clique em **↻**. Para baixar **o acervo inteiro de um perfil de uma vez** com garantia, o caminho mais completo continua sendo o baixador por linha de comando em `../baixador/` (usa a API com login e enumera todos os posts).

## O que ele baixa

| Tipo | Suporte |
|---|---|
| **MP4 / WebM / MOV** (arquivo direto) | ✅ 1 clique |
| **HLS (.m3u8, streaming)** | ✅ busca todos os segmentos, descriptografa (AES-128) e costura num arquivo só |
| **Áudio** (mp3/m4a/aac) | ✅ |
| **DASH (.mpd)** | ⚠️ não costura — quando houver, use a versão MP4 que costuma aparecer junto |
| Vídeo em `blob:` puro (sem URL de rede) | ⚠️ raro; o farejador de rede quase sempre pega a URL real mesmo assim |

## Sobre "escolher a pasta" — o limite do Chrome (importante)

Por segurança, **o Chrome não deixa nenhuma extensão gravar em pastas arbitrárias do disco** sozinha. Existem exatamente dois caminhos, e a extensão usa os dois:

- **Janela "Salvar como"** → aí sim você escolhe *qualquer* lugar do computador. É a opção "Perguntar onde salvar".
- **Dentro de `Downloads`** (com subpastas à vontade) → salva sem perguntar.

Se quiser que o "Downloads" do Chrome aponte para outro lugar (ex.: uma pasta do projeto), mude em `chrome://settings/downloads`.

## Privacidade / permissões

Na instalação o Chrome avisa que a extensão "lê dados em todos os sites" — isso é necessário para **farejar as URLs de vídeo** que passam pela rede em cada aba. Nada é enviado para fora: tudo roda local, no seu navegador. Só faz download quando você clica.

## Uso responsável

Baixe **seu próprio acervo** ou conteúdo com autorização (idealmente por escrito, no contrato com a modelo). Repostar vídeo de terceiros sem permissão viola direitos autorais e as regras das plataformas.

---

### Arquivos (para quem for editar)

- `manifest.json` — permissões e registro (MV3).
- `background.js` — service worker: fareja mídia na rede (`webRequest`, filtrado por tipo), guarda por aba, dispara downloads.
- `inject.js` — roda no mundo da página (world MAIN); "escuta" as respostas JSON (fetch/XHR) e extrai as URLs de vídeo. É o que mais captura.
- `content.js` — ponte: repassa as URLs do `inject.js`, acha `<video>` no DOM, manda o título e faz o re-scan sob demanda.
- `popup.html/.css/.js` — a janelinha: lista, destino, botões, progresso.
- `offscreen.html/.js` — baixa e costura HLS (fetch dos segmentos + AES-128 + blob).
- `options.html/.js` — página de configurações do destino padrão.
- `icons/` — ícones gerados (rosa da marca).
