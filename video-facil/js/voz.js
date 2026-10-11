// Narração: gera o áudio e o tempo de cada palavra (usado nas legendas e nos cortes).
// Retorna { buffer: AudioBuffer | null, palavras: [{ texto, inicio, fim }], duracao }.

export const VOZES_OPENAI = [
  { id: "onyx", nome: "Onyx (masculina, grave)" },
  { id: "ash", nome: "Ash (masculina)" },
  { id: "echo", nome: "Echo (masculina)" },
  { id: "coral", nome: "Coral (feminina)" },
  { id: "nova", nome: "Nova (feminina)" },
  { id: "shimmer", nome: "Shimmer (feminina, suave)" },
  { id: "sage", nome: "Sage (neutra)" },
  { id: "alloy", nome: "Alloy (neutra)" },
];

// Vozes prontas da ElevenLabs, usadas se a lista da conta não carregar.
const VOZES_ELEVEN_PADRAO = [
  { id: "pNInz6obpgDQGcFmaJgB", nome: "Adam (masculina)" },
  { id: "21m00Tcm4TlvDq8ikWAM", nome: "Rachel (feminina)" },
];

const TONS = {
  animada: {
    instrucao:
      "Fale em português do Brasil com muita energia e empolgação, como um criador de conteúdo mostrando um achadinho incrível.",
    eleven: { stability: 0.3, similarity_boost: 0.8, style: 0.55 },
  },
  natural: {
    instrucao: "Fale em português do Brasil de forma natural e próxima, como quem conversa com um amigo.",
    eleven: { stability: 0.5, similarity_boost: 0.8, style: 0.2 },
  },
  grave: {
    instrucao: "Fale em português do Brasil com voz grave, firme e confiante, ritmo seguro.",
    eleven: { stability: 0.65, similarity_boost: 0.85, style: 0.1 },
  },
};

const PONTUACAO_FINAL = /[.!?…]["”']?$/;
const PONTUACAO_MEIO = /[,;:]["”']?$/;

/** Lista as vozes da conta ElevenLabs. */
export async function listarVozesEleven(apiKey) {
  try {
    const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
    if (!r.ok) throw new Error(String(r.status));
    const dados = await r.json();
    const vozes = (dados.voices || []).map((v) => {
      const genero = v.labels?.gender ? ` (${traduzGenero(v.labels.gender)})` : "";
      return { id: v.voice_id, nome: `${v.name}${genero}` };
    });
    return vozes.length ? vozes : VOZES_ELEVEN_PADRAO;
  } catch {
    return VOZES_ELEVEN_PADRAO;
  }
}

function traduzGenero(g) {
  return { male: "masculina", female: "feminina", neutral: "neutra" }[g] || g;
}

/**
 * Gera a narração.
 * cfg: { provedor, voz, tom, velocidade, chaves: { eleven, openai }, modelos: { eleven, openai }, audioProprio }
 */
export async function gerarNarracao(texto, cfg, audioCtx) {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (!limpo) throw new Error("Escreva ou gere a narração antes (passo 3).");

  if (cfg.provedor === "elevenlabs") return narracaoEleven(limpo, cfg, audioCtx);
  if (cfg.provedor === "openai") return narracaoOpenAI(limpo, cfg, audioCtx);
  if (cfg.provedor === "arquivo") return narracaoGravada(limpo, cfg.audioProprio);
  return narracaoSemVoz(limpo, cfg.velocidade);
}

async function narracaoEleven(texto, cfg, audioCtx) {
  if (!cfg.chaves.eleven) throw new Error("Coloque sua chave da ElevenLabs nas configurações (⚙️).");
  const tom = TONS[cfg.tom] || TONS.animada;
  const modelo = cfg.modelos.eleven || "eleven_multilingual_v2";
  const corpo = {
    text: texto,
    model_id: modelo,
    voice_settings: {
      ...tom.eleven,
      use_speaker_boost: true,
      // A ElevenLabs aceita velocidade de 0,7 a 1,2.
      speed: Math.min(1.2, Math.max(0.7, cfg.velocidade)),
    },
  };
  // Só os modelos v2.5 aceitam forçar o idioma.
  if (modelo.includes("v2_5")) corpo.language_code = "pt";

  const voz = cfg.voz || VOZES_ELEVEN_PADRAO[0].id;
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voz)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": cfg.chaves.eleven, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    },
  );
  if (!r.ok) throw new Error(await erroHttp("ElevenLabs", r));
  const dados = await r.json();

  const bytes = base64ParaBytes(dados.audio_base64);
  const buffer = await audioCtx.decodeAudioData(bytes.buffer);
  const alinhamento = dados.alignment || dados.normalized_alignment;
  const palavras = alinhamento ? palavrasDosCaracteres(alinhamento) : estimarPalavras(texto, buffer);
  return { buffer, palavras, duracao: buffer.duration };
}

async function narracaoOpenAI(texto, cfg, audioCtx) {
  if (!cfg.chaves.openai) throw new Error("Coloque sua chave da OpenAI nas configurações (⚙️).");
  const tom = TONS[cfg.tom] || TONS.animada;
  const modelo = cfg.modelos.openai || "gpt-4o-mini-tts";
  const corpo = {
    model: modelo,
    voice: cfg.voz || "onyx",
    input: texto,
    response_format: "mp3",
  };
  if (modelo.startsWith("gpt-")) {
    // Os modelos gpt-*-tts seguem instruções de estilo, mas ignoram o parâmetro de velocidade.
    const ritmo = cfg.velocidade >= 1.15 ? " Ritmo rápido." : cfg.velocidade <= 0.9 ? " Ritmo calmo." : "";
    corpo.instructions = tom.instrucao + ritmo;
  } else {
    corpo.speed = cfg.velocidade;
  }

  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.chaves.openai}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(await erroHttp("OpenAI", r));
  const buffer = await audioCtx.decodeAudioData(await r.arrayBuffer());
  return { buffer, palavras: estimarPalavras(texto, buffer), duracao: buffer.duration };
}

/** Gravação enviada pela pessoa: o tempo das legendas é estimado pelo som do áudio. */
function narracaoGravada(texto, buffer) {
  if (!buffer) throw new Error("Envie o arquivo de áudio com a sua narração (passo 4).");
  return { buffer, palavras: estimarPalavras(texto, buffer), duracao: buffer.duration };
}

/** Sem voz: calcula um tempo de leitura confortável para as legendas. */
function narracaoSemVoz(texto, velocidade) {
  const tokens = texto.split(" ");
  const palavras = [];
  let t = 0.3;
  for (const tok of tokens) {
    const letras = tok.replace(/[^\p{L}\p{N}]/gu, "").length;
    const dur = (0.16 + 0.06 * letras) / velocidade;
    palavras.push({ texto: tok, inicio: t, fim: t + dur });
    t += dur + pausaDepois(tok) / velocidade;
  }
  return { buffer: null, palavras, duracao: t + 0.2 };
}

function pausaDepois(palavra) {
  if (PONTUACAO_FINAL.test(palavra)) return 0.35;
  if (PONTUACAO_MEIO.test(palavra)) return 0.15;
  return 0.04;
}

/** Junta o alinhamento por caractere da ElevenLabs em palavras com início e fim. */
export function palavrasDosCaracteres(al) {
  const chars = al.characters || [];
  const inicios = al.character_start_times_seconds || [];
  const fins = al.character_end_times_seconds || [];
  const palavras = [];
  let atual = null;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c)) {
      if (atual) palavras.push(atual);
      atual = null;
      continue;
    }
    if (!atual) atual = { texto: "", inicio: inicios[i] ?? 0, fim: fins[i] ?? 0 };
    atual.texto += c;
    atual.fim = fins[i] ?? atual.fim;
  }
  if (atual) palavras.push(atual);
  return palavras;
}

/**
 * Sem tempos vindos da API: distribui as palavras pelo áudio proporcionalmente ao tamanho
 * de cada uma, com pausas na pontuação, entre o primeiro e o último trecho com som.
 */
export function estimarPalavras(texto, buffer) {
  const tokens = texto.split(/\s+/).filter(Boolean);
  const { inicio, fim } = trechoComSom(buffer);
  const pesos = tokens.map((tok) => tok.replace(/[^\p{L}\p{N}]/gu, "").length + 2);
  const pausas = tokens.map((tok) => (PONTUACAO_FINAL.test(tok) ? 6 : PONTUACAO_MEIO.test(tok) ? 3 : 0));
  const total = pesos.reduce((a, b) => a + b, 0) + pausas.slice(0, -1).reduce((a, b) => a + b, 0);
  const escala = (fim - inicio) / Math.max(1, total);
  const palavras = [];
  let t = inicio;
  tokens.forEach((tok, i) => {
    const dur = pesos[i] * escala;
    palavras.push({ texto: tok, inicio: t, fim: t + dur });
    t += dur + pausas[i] * escala;
  });
  return palavras;
}

function trechoComSom(buffer) {
  const dados = buffer.getChannelData(0);
  const taxa = buffer.sampleRate;
  const limiar = 0.02;
  let a = 0;
  while (a < dados.length && Math.abs(dados[a]) < limiar) a++;
  let b = dados.length - 1;
  while (b > a && Math.abs(dados[b]) < limiar) b--;
  if (b <= a) return { inicio: 0, fim: buffer.duration };
  return { inicio: a / taxa, fim: (b + 1) / taxa };
}

function base64ParaBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function erroHttp(servico, resposta) {
  let detalhe = "";
  try {
    const corpo = await resposta.json();
    detalhe = corpo?.detail?.message || corpo?.detail?.status || corpo?.error?.message || "";
    if (!detalhe && typeof corpo?.detail === "string") detalhe = corpo.detail;
  } catch {
    // corpo não era JSON
  }
  if (resposta.status === 401) return `Chave da ${servico} inválida. Confira nas configurações (⚙️).`;
  if (resposta.status === 429) return `Limite da ${servico} atingido (créditos ou pedidos demais). ${detalhe}`.trim();
  return `Erro da ${servico} (${resposta.status}). ${detalhe}`.trim();
}

export function ehFimDeFrase(palavra) {
  return PONTUACAO_FINAL.test(palavra);
}

export function temPausa(palavra) {
  return PONTUACAO_FINAL.test(palavra) || PONTUACAO_MEIO.test(palavra);
}
