// Geração do roteiro: com Claude (pela página do Claude ou com chave da API) ou com modelos prontos.

// O SDK só é baixado quando alguém usa a própria chave da Anthropic.
const URL_SDK = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm";

// Palavras faladas por segundo numa locução de vídeo curto em velocidade 1×.
const PALAVRAS_POR_SEGUNDO = 2.6;

// Modelos que aceitam o fallback automático do servidor quando a IA recusa um pedido.
const MODELOS_COM_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

const ESTILOS = {
  animado: "animado e empolgado, como quem achou um achadinho incrível",
  curiosidade: "de curiosidade: abre com algo intrigante e só revela o produto no meio",
  review: "de review sincero, em primeira pessoa, como quem já usou o produto",
  problema: "problema → solução: começa com uma dor do dia a dia e mostra o produto resolvendo",
  oferta: "de oferta: destaca preço, custo-benefício e senso de urgência sem mentir",
};

const SCHEMA = {
  type: "object",
  properties: {
    gancho: {
      type: "string",
      description: "Título curto (até 8 palavras) que fica fixo no topo do vídeo.",
    },
    narracao: {
      type: "string",
      description: "Texto completo que a voz vai falar, em frases curtas.",
    },
    legenda_post: {
      type: "string",
      description: "Legenda para o post, com 1 a 3 emojis, sem hashtags.",
    },
    hashtags: {
      type: "array",
      items: { type: "string" },
      description: "De 5 a 8 hashtags, cada uma começando com #.",
    },
  },
  required: ["gancho", "narracao", "legenda_post", "hashtags"],
  additionalProperties: false,
};

const SISTEMA = `Você escreve roteiros de vídeos curtos verticais (TikTok, Reels, Shopee Vídeo) para afiliados que vendem produtos, em português do Brasil.

Como escrever a narração:
- A primeira frase é o gancho: precisa fazer a pessoa parar de rolar a tela.
- Frases curtas, de no máximo 12 palavras, com tom de conversa.
- Fale de benefícios concretos usando só as informações recebidas. Não invente especificações, números, garantias ou promessas de saúde.
- Escreva para ser falado: sem emojis, hashtags, listas ou abreviações. Preços por extenso de forma falada, por exemplo "49 reais e 90".
- Termine com uma chamada para ação curta, como "o link está aqui no carrinho".`;

/** Monta o pedido do usuário para a IA a partir dos dados do produto. */
function montarPedido(produto, opcoes) {
  const palavras = Math.round(opcoes.duracao * PALAVRAS_POR_SEGUNDO * opcoes.velocidade);
  const linhas = [
    `Produto: ${produto.nome}`,
    produto.preco ? `Preço: R$ ${produto.preco}` : "Preço: não informado (não cite preço)",
    produto.destaques.length
      ? `Destaques informados pelo vendedor:\n${produto.destaques.map((d) => `- ${d}`).join("\n")}`
      : "Destaques: não informados (fale de forma geral, sem inventar detalhes técnicos)",
    "",
    `Estilo: ${ESTILOS[opcoes.estilo] || ESTILOS.animado}.`,
    `Duração do vídeo: ${opcoes.duracao} segundos, então a narração deve ter cerca de ${palavras} palavras.`,
  ];
  return linhas.join("\n");
}

/** Gera o roteiro com a API da Claude. Lança erro com mensagem amigável se falhar. */
export async function gerarRoteiroIA(produto, opcoes, apiKey, modelo) {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import(URL_SDK));
  } catch {
    throw new Error("Não consegui carregar a biblioteca da Anthropic. Verifique sua internet.");
  }
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const pedido = {
    model: modelo,
    max_tokens: 16000,
    system: SISTEMA,
    messages: [{ role: "user", content: montarPedido(produto, opcoes) }],
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
  };
  if (MODELOS_COM_FALLBACK.has(modelo)) {
    pedido.betas = ["server-side-fallback-2026-07-01"];
    pedido.fallbacks = "default";
  }

  let resposta;
  try {
    resposta = await client.beta.messages.create(pedido);
  } catch (err) {
    throw new Error(mensagemErroAnthropic(Anthropic, err));
  }

  if (resposta.stop_reason === "refusal") {
    throw new Error("A IA recusou este pedido. Revise os dados do produto e tente de novo.");
  }
  if (resposta.stop_reason === "max_tokens") {
    throw new Error("A resposta da IA veio incompleta. Tente gerar de novo.");
  }
  const texto = resposta.content
    .filter((bloco) => bloco.type === "text")
    .map((bloco) => bloco.text)
    .join("");

  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    throw new Error("Não consegui ler o roteiro que a IA devolveu. Tente de novo.");
  }
  return {
    gancho: String(dados.gancho || "").trim(),
    narracao: String(dados.narracao || "").trim(),
    legendaPost: juntarLegenda(dados.legenda_post, dados.hashtags),
  };
}

/** Erro do Claude da página que deve esconder a IA e cair para o roteiro de modelo. */
export class IaIndisponivel extends Error {}

/**
 * Gera o roteiro com o Claude da própria página (capability "sample" do artifact),
 * sem precisar de chave. `sample` é a função devolvida por `claude.use("sample")`.
 */
export async function gerarRoteiroSample(produto, opcoes, sample) {
  const entrada = [
    SISTEMA,
    "",
    montarPedido(produto, opcoes),
    "",
    "Responda só com um objeto JSON com estas chaves:",
    '- "gancho": título curto (até 8 palavras) que fica fixo no topo do vídeo',
    '- "narracao": o texto completo que a voz vai falar',
    '- "legenda_post": legenda para o post, com 1 a 3 emojis, sem hashtags',
    '- "hashtags": lista de 5 a 8 hashtags, cada uma começando com #',
  ].join("\n");

  let dados;
  try {
    dados = await sample.json(entrada, { modelTier: "default", cache: false });
  } catch (err) {
    const codigo = err?.code;
    if (
      ["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(codigo)
    ) {
      throw new IaIndisponivel("A IA não está liberada nesta página.");
    }
    if (codigo === "rate_limited")
      throw new Error("Muitos pedidos seguidos para a IA. Espere um pouco e tente de novo.");
    if (codigo === "session_expired") throw new Error("Sua sessão no Claude expirou. Entre de novo e tente outra vez.");
    if (codigo === "refused") throw new Error("A IA recusou este pedido. Mude os dados do produto e tente de novo.");
    throw new Error("A IA não conseguiu escrever o roteiro agora. Tente de novo.");
  }
  if (!dados || typeof dados.narracao !== "string") {
    throw new Error("A IA devolveu o roteiro num formato inesperado. Tente de novo.");
  }
  return {
    gancho: String(dados.gancho || "").trim(),
    narracao: dados.narracao.trim(),
    legendaPost: juntarLegenda(dados.legenda_post, dados.hashtags),
  };
}

function mensagemErroAnthropic(Anthropic, err) {
  if (err instanceof Anthropic.AuthenticationError)
    return "Chave da Anthropic inválida. Confira nas configurações (⚙️).";
  if (err instanceof Anthropic.PermissionDeniedError)
    return "Sua chave da Anthropic não tem permissão para este modelo.";
  if (err instanceof Anthropic.NotFoundError)
    return "Modelo não encontrado. Escolha outro modelo nas configurações (⚙️).";
  if (err instanceof Anthropic.RateLimitError)
    return "Muitos pedidos seguidos para a Anthropic. Espere um pouco e tente de novo.";
  if (err instanceof Anthropic.APIConnectionError) return "Sem conexão com a Anthropic. Verifique sua internet.";
  if (err instanceof Anthropic.APIError) return `Erro da Anthropic (${err.status ?? "?"}): ${err.message}`;
  return `Erro ao gerar o roteiro: ${err?.message || err}`;
}

function juntarLegenda(legenda, hashtags) {
  const tags = (Array.isArray(hashtags) ? hashtags : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
  return [String(legenda || "").trim(), tags.join(" ")].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Roteiro sem IA: modelos prontos preenchidos com os dados do produto.

const GANCHOS = {
  animado: ["Gente, olha o que eu achei!", "Para tudo e olha isso aqui!", "Achei o achadinho do mês!"],
  curiosidade: [
    "Todo mundo está comprando isso e eu descobri o porquê.",
    "Você não vai acreditar no que esse produto faz.",
    "Eu não sabia que precisava disso até testar.",
  ],
  review: [
    "Comprei e vou te contar a verdade.",
    "Testei por uma semana e olha o resultado.",
    "Vale a pena? Eu testei pra você.",
  ],
  problema: [
    "Se isso te irrita todo dia, presta atenção.",
    "Cansou de passar raiva com isso? Olha a solução.",
    "Eu resolvi um problema que me incomodava há anos.",
  ],
  oferta: [
    "Corre que esse preço não vai durar!",
    "Olha o preço que está esse produto!",
    "Achei uma oferta que vale muito a pena.",
  ],
};

const CONECTORES = ["", "Além disso, ", "E o melhor: ", "Sem contar que ", "E ainda "];

const FECHAMENTOS = {
  animado: "Corre, o link está aqui no carrinho!",
  curiosidade: "Quer o seu? O link está aqui no carrinho.",
  review: "Eu recomendo. O link está aqui no carrinho.",
  problema: "Chega de sofrer. O link está aqui no carrinho.",
  oferta: "Garanta o seu antes que acabe. Link no carrinho!",
};

const HASHTAGS_BASE = ["#achadinhos", "#shopee", "#achadosdashopee", "#comprinhas", "#oferta"];

/** Encurta nomes longos de anúncio para algo falável ("Fone de ouvido Bluetooth X55"). */
export function nomeCurto(nome) {
  const limpo = String(nome || "")
    .split(/\s[-|–—(\[]\s?|[([|]/)[0]
    .replace(/\s+/g, " ")
    .trim();
  const palavras = limpo.split(" ");
  return palavras.slice(0, 5).join(" ") || "este produto";
}

/** "49,90" -> "49 reais e 90"; "120" -> "120 reais". */
export function precoFalado(preco) {
  const numero = String(preco || "").replace(/[^\d,.]/g, "");
  if (!numero) return "";
  const m = numero.match(/^(\d{1,3}(?:[.]\d{3})*|\d+)(?:[,.](\d{1,2}))?$/);
  if (!m) return `${numero} reais`;
  const reais = m[1].replace(/\./g, "");
  const centavos = (m[2] || "").padEnd(m[2] ? 2 : 0, "0");
  if (!centavos || centavos === "00") return `${reais} reais`;
  return `${reais} reais e ${centavos}`;
}

function sortear(lista, aleatorio) {
  return lista[Math.floor(aleatorio() * lista.length)];
}

function primeiraMaiuscula(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function frase(texto) {
  const t = texto.trim().replace(/[.;,]+$/, "");
  return /[!?]$/.test(t) ? t : `${t}.`;
}

/** Gera um roteiro sem IA. Rápido, grátis e editável. */
export function gerarRoteiroModelo(produto, opcoes, aleatorio = Math.random) {
  const estilo = GANCHOS[opcoes.estilo] ? opcoes.estilo : "animado";
  const nome = nomeCurto(produto.nome);
  const preco = precoFalado(produto.preco);
  const limitePalavras = Math.round(opcoes.duracao * PALAVRAS_POR_SEGUNDO * opcoes.velocidade);

  const partes = [sortear(GANCHOS[estilo], aleatorio)];
  partes.push(estilo === "review" ? `Esse é o ${nome}.` : `Esse aqui é o ${nome}.`);

  const destaques = produto.destaques.length
    ? produto.destaques
    : ["É prático para usar no dia a dia", "Tem um acabamento muito bonito", "E chega rapidinho"];
  const contar = (lista) => lista.join(" ").split(/\s+/).filter(Boolean).length;
  const fechamento = FECHAMENTOS[estilo];
  const linhaPreco = preco ? `E está saindo por apenas ${preco}.` : "";

  destaques.forEach((d, i) => {
    const conector = CONECTORES[i % CONECTORES.length];
    const texto = conector ? conector + d.charAt(0).toLowerCase() + d.slice(1) : primeiraMaiuscula(d);
    const candidata = frase(texto);
    const total = contar([...partes, candidata, linhaPreco, fechamento]);
    if (i === 0 || total <= limitePalavras) partes.push(candidata);
  });
  if (linhaPreco) partes.push(linhaPreco);
  partes.push(fechamento);

  const gancho =
    estilo === "oferta" && produto.preco ? `${nome} por R$ ${produto.preco}` : `${nome}: o achadinho do momento`;

  const palavrasNome = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 3)
    .slice(0, 2)
    .map((p) => `#${p}`);
  const legendaPost = juntarLegenda(
    `${primeiraMaiuscula(nome)} ${preco ? `por R$ ${produto.preco}` : "que todo mundo quer"} 🔥 Link no carrinho 🛒`,
    [...HASHTAGS_BASE, ...palavrasNome],
  );

  return { gancho, narracao: partes.join(" "), legendaPost };
}

/** Tenta extrair o nome do produto de um link da Shopee (shopee.com.br/Nome-Do-Produto-i.123.456). */
export function nomeDoLink(link) {
  try {
    const url = new URL(link);
    if (!/shopee\./i.test(url.hostname)) return "";
    const caminho = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "");
    const m = caminho.match(/^(.+)-i\.\d+\.\d+$/);
    if (!m) return "";
    return m[1].replace(/-+/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}
