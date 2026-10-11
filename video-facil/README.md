# Vídeo Fácil

Gerador de vídeos curtos de produto (TikTok, Reels, Shopee Vídeo) que roda inteiro no navegador.

Endereço depois de publicado: `https://flavianotc.github.io/video-facil/`

## Como funciona

1. **Produto:** cole o link (o nome é preenchido sozinho a partir de links da Shopee), o preço e os destaques.
2. **Fotos e vídeos:** envie as mídias do produto e, se quiser, uma música de fundo.
3. **Roteiro:** gerado pela Claude (com chave da Anthropic) ou por modelos prontos (sem chave). Dá para editar.
4. **Voz:** ElevenLabs ou OpenAI (com chave), ou sem narração, só com legendas.
5. **Gerar vídeo:** o app divide a narração em frases, faz um corte por frase (cenas longas viram vários cortes), coloca legendas palavra por palavra e o preço e a chamada no final. Depois grava tudo em MP4 (ou WebM, conforme o navegador).

A gravação acontece em tempo real: um vídeo de 30 s leva cerca de 30 s. A aba precisa ficar aberta e visível.

"Gerar outra versão" reaproveita a mesma narração (sem gastar créditos de voz de novo) e sorteia outra ordem e outros trechos dos cortes.

## Chaves de API

As chaves ficam no `localStorage` do navegador de quem usa e são enviadas só para a API de cada serviço:

| Serviço | Para quê | Onde pegar |
| --- | --- | --- |
| Anthropic | Roteiro com IA | console.anthropic.com |
| ElevenLabs | Voz com tempo exato de cada palavra | elevenlabs.io |
| OpenAI | Voz (tempos das palavras estimados) | platform.openai.com |

Sem nenhuma chave, o app funciona com roteiros de modelo e vídeo só com legendas.

## Arquivos

- `index.html` e `style.css`: interface.
- `js/app.js`: liga a interface às etapas.
- `js/roteiro.js`: roteiro com a Claude (SDK oficial via CDN) e modelos prontos.
- `js/voz.js`: narração (ElevenLabs, OpenAI ou sem voz) e tempo de cada palavra.
- `js/render.js`: cortes, legendas e gravação (canvas + Web Audio + MediaRecorder).

## Limites desta versão

- Não puxa o catálogo de produtos nem os vídeos dos anúncios sozinho: as mídias são enviadas por quem usa. Para buscar produtos automaticamente seria preciso um servidor com a API de afiliados da Shopee.
- Como cada pessoa usa a própria chave, isto serve para uso pessoal. Para vender como serviço, as chamadas de IA e voz precisam passar por um servidor seu, com login e cobrança.
