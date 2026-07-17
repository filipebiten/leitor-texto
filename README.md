# Projeto Rafa — Leitor de Texto por Voz

Aplicativo web simples para ouvir qualquer texto em português do Brasil. Cole o texto, clique em **Ouvir** e o navegador lê em voz alta usando a Web Speech API — sem backend, sem banco de dados, sem downloads.

## Uso

Acesse a página publicada no GitHub Pages, cole o texto na caixa e use os controles:

- **Ouvir** — inicia a leitura.
- **Pausar / Retomar** — pausa e continua de onde parou.
- **Parar** — encerra a leitura.
- **Limpar** — apaga o texto.
- **Velocidade** — ajusta o ritmo da fala (0.5x a 2x).
- **Voz** — escolhe entre as vozes disponíveis no dispositivo (prioriza pt-BR).

Textos longos são divididos automaticamente em frases e lidos em sequência, contornando o bug conhecido do Chrome que interrompe falas longas.

## Stack

HTML, CSS e JavaScript puro — sem frameworks, sem build, sem dependências. Publicado como site estático no GitHub Pages.

## Rodando localmente

Basta abrir `index.html` em um navegador, ou servir a pasta com qualquer servidor estático:

```bash
python3 -m http.server 8000
```

## Compatibilidade

Requer um navegador com suporte à Web Speech API (Chrome, Edge, Safari recentes). O áudio só pode ser iniciado por um clique do usuário, conforme exigido pelas políticas dos navegadores.
