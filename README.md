# Projeto Rafa — Leitor de Texto por Voz

Aplicativo web para ouvir qualquer texto em português do Brasil. Cole o texto ou suba um arquivo PDF, DOCX ou TXT, clique em **Ouvir** e o navegador lê em voz alta usando a Web Speech API — sem backend, sem banco de dados, sem envio de arquivos a servidor. Instalável como app (PWA), funciona offline.

## Uso

Acesse a página publicada no GitHub Pages (ou instale como app — veja abaixo) e use os controles:

- **Carregar arquivo** — sobe um PDF, DOCX ou TXT; o texto extraído cai na caixa.
- **Escolher onde começar** — depois de colar/carregar o texto, abre a lista de trechos; toque num trecho pra começar a leitura a partir dali.
- **Ouvir** — inicia a leitura.
- **Pausar / Retomar** — pausa e continua de onde parou.
- **Parar** — encerra a leitura.
- **Limpar** — apaga o texto.
- **Velocidade / Tom de voz** — ajusta ritmo e timbre da fala.
- **Voz** — escolhe entre as vozes disponíveis no dispositivo (prioriza pt-BR).

Textos longos são divididos automaticamente em trechos e lidos em sequência, contornando o bug conhecido do Chrome que interrompe falas longas. A pausa entre trechos varia pela pontuação final (vírgula, ponto, parágrafo) para soar mais como alguém explicando o texto do que uma leitura robótica; frases terminadas em "?" sobem levemente o tom.

## Instalar como app

- **Android/Chrome**: menu → "Adicionar à tela inicial" / "Instalar app".
- **iPhone/Safari**: botão compartilhar → "Adicionar à Tela de Início".

## Stack

HTML, CSS e JavaScript puro, sem build. Duas dependências vendorizadas em `vendor/` (sem CDN, funcionam offline):

- [pdf.js](https://mozilla.github.io/pdf.js/) (Mozilla) — extração de texto de PDF.
- [JSZip](https://stuk.github.io/jszip/) — leitura do `.docx` (zip) pra extrair `word/document.xml`.

PWA via `manifest.json` + `service-worker.js` (cache do app shell). Publicado como site estático no GitHub Pages.

## Rodando localmente

Basta abrir `index.html` em um navegador, ou servir a pasta com qualquer servidor estático:

```bash
python3 -m http.server 8000
```

## Compatibilidade

Requer um navegador com suporte à Web Speech API (Chrome, Edge, Safari recentes). O áudio só pode ser iniciado por um clique do usuário, conforme exigido pelas políticas dos navegadores.
