// Interface do Vídeo Fácil: liga o formulário ao roteiro, à voz e à gravação.
import { IaIndisponivel, gerarRoteiroIA, gerarRoteiroModelo, gerarRoteiroSample, nomeDoLink } from "./roteiro.js";
import { gerarNarracao, listarVozesEleven, VOZES_OPENAI } from "./voz.js";
import { criarAleatorio, gravarVideo, montarCortes } from "./render.js";

const $ = (id) => document.getElementById(id);
const CHAVE_CONFIG = "videofacil:config";

// Dentro de uma página do Claude (artifact) o Claude escreve o roteiro sem chave e o
// download passa pela própria página; as APIs de voz externas ficam bloqueadas lá.
const naPaginaClaude = typeof window.claude?.use === "function";

const estado = {
  midias: [],
  musica: null,
  estilo: "animado",
  duracao: 30,
  tom: "animada",
  semente: Date.now(),
  narracao: { chave: "", resultado: null },
  vozesEleven: null,
  previa: null,
  videoUrl: null,
  videoBlob: null,
  audioProprio: null,
  audioProprioVersao: 0,
  sample: null,
  downloads: null,
  ocupado: false,
};

let audioCtx = null;
function contextoAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// ---------------------------------------------------------------------------
// Configurações (chaves de API ficam só no navegador)

const config = {
  anthropicKey: "",
  anthropicModel: "claude-opus-5-5",
  elevenKey: "",
  elevenModel: "eleven_multilingual_v2",
  openaiKey: "",
  openaiModel: "gpt-4o-mini-tts",
  provedor: "",
  voz: "",
};

function carregarConfig() {
  try {
    Object.assign(config, JSON.parse(localStorage.getItem(CHAVE_CONFIG) || "{}"));
  } catch {
    // armazenamento indisponível: segue com os valores padrão
  }
}

function salvarConfig() {
  try {
    localStorage.setItem(CHAVE_CONFIG, JSON.stringify(config));
  } catch {
    // sem armazenamento: as chaves valem só até fechar a página
  }
}

function abrirConfig() {
  $("cfgAnthropicKey").value = config.anthropicKey;
  $("cfgAnthropicModel").value = config.anthropicModel;
  $("cfgElevenKey").value = config.elevenKey;
  $("cfgElevenModel").value = config.elevenModel;
  $("cfgOpenaiKey").value = config.openaiKey;
  $("cfgOpenaiModel").value = config.openaiModel;
  $("dlgConfig").showModal();
}

$("btnConfig").addEventListener("click", abrirConfig);
$("formConfig").addEventListener("submit", () => {
  const elevenAntes = config.elevenKey;
  config.anthropicKey = $("cfgAnthropicKey").value.trim();
  config.anthropicModel = $("cfgAnthropicModel").value;
  config.elevenKey = $("cfgElevenKey").value.trim();
  config.elevenModel = $("cfgElevenModel").value;
  config.openaiKey = $("cfgOpenaiKey").value.trim();
  config.openaiModel = $("cfgOpenaiModel").value;
  if (config.elevenKey !== elevenAntes) estado.vozesEleven = null;
  if (!config.provedor) config.provedor = config.elevenKey ? "elevenlabs" : config.openaiKey ? "openai" : "";
  if (config.provedor) $("provedor").value = config.provedor;
  salvarConfig();
  atualizarRotuloRoteiro();
  atualizarProvedor();
});
$("btnApagarChaves").addEventListener("click", () => {
  ["cfgAnthropicKey", "cfgElevenKey", "cfgOpenaiKey"].forEach((id) => ($(id).value = ""));
});

// ---------------------------------------------------------------------------
// Controles de escolha (chips e segmentos)

function grupoDeEscolha(idGrupo, aoEscolher) {
  const grupo = $(idGrupo);
  grupo.addEventListener("click", (e) => {
    const botao = e.target.closest("button[data-valor]");
    if (!botao) return;
    grupo.querySelectorAll("button[data-valor]").forEach((b) => {
      const ativo = b === botao;
      b.classList.toggle("ativo", ativo);
      b.setAttribute("aria-checked", String(ativo));
    });
    aoEscolher(botao.dataset.valor);
  });
}

grupoDeEscolha("estilos", (v) => (estado.estilo = v));
grupoDeEscolha("duracoes", (v) => (estado.duracao = Number(v)));
grupoDeEscolha("tons", (v) => (estado.tom = v));

$("velocidade").addEventListener("input", () => {
  $("velocidadeValor").textContent = `${Number($("velocidade").value).toFixed(2).replace(".", ",")}×`;
});

// ---------------------------------------------------------------------------
// Produto

function lerProduto() {
  return {
    nome: $("nome").value.trim(),
    preco: $("preco")
      .value.trim()
      .replace(/^R\$\s*/i, ""),
    destaques: $("destaques")
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

function preencherNomePeloLink() {
  if ($("nome").value.trim()) return;
  const nome = nomeDoLink($("link").value.trim());
  if (nome) $("nome").value = nome;
}
$("link").addEventListener("change", preencherNomePeloLink);
$("link").addEventListener("paste", () => setTimeout(preencherNomePeloLink, 0));

// ---------------------------------------------------------------------------
// Mídias

function lerMidia(arquivo) {
  const url = URL.createObjectURL(arquivo);
  if (arquivo.type.startsWith("video/")) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => {
        resolve({
          tipo: "video",
          url,
          nome: arquivo.name,
          duracao: v.duration,
          largura: v.videoWidth,
          altura: v.videoHeight,
        });
        v.removeAttribute("src");
        v.load();
      };
      v.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Não consegui abrir o vídeo "${arquivo.name}". Tente MP4 ou MOV.`));
      };
      v.src = url;
    });
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        tipo: "imagem",
        url,
        nome: arquivo.name,
        imagem: img,
        largura: img.naturalWidth,
        altura: img.naturalHeight,
      });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Não consegui abrir a imagem "${arquivo.name}".`));
    };
    img.src = url;
  });
}

async function adicionarArquivos(lista) {
  limparErro();
  const arquivos = [...lista].filter((a) => a.type.startsWith("video/") || a.type.startsWith("image/"));
  for (const arquivo of arquivos) {
    try {
      estado.midias.push(await lerMidia(arquivo));
    } catch (err) {
      mostrarErro(err.message, "erroMidia");
    }
  }
  desenharMiniaturas();
}

function desenharMiniaturas() {
  const ul = $("miniaturas");
  ul.replaceChildren(
    ...estado.midias.map((m, i) => {
      const li = document.createElement("li");
      const visual = document.createElement(m.tipo === "video" ? "video" : "img");
      visual.src = m.url;
      if (m.tipo === "video") {
        visual.muted = true;
        visual.playsInline = true;
        visual.preload = "metadata";
      } else {
        visual.alt = m.nome;
      }
      const tipo = document.createElement("span");
      tipo.className = "tipo";
      tipo.textContent = m.tipo === "video" ? `🎬 ${Math.round(m.duracao)}s` : "📷 foto";
      const remover = document.createElement("button");
      remover.type = "button";
      remover.className = "remover";
      remover.textContent = "✕";
      remover.setAttribute("aria-label", `Remover ${m.nome}`);
      remover.addEventListener("click", () => {
        URL.revokeObjectURL(m.url);
        estado.midias.splice(i, 1);
        desenharMiniaturas();
      });
      li.append(visual, tipo, remover);
      return li;
    }),
  );
}

$("arquivosMidia").addEventListener("change", (e) => {
  adicionarArquivos(e.target.files);
  e.target.value = "";
});
const drop = $("dropMidia");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("arrastando");
});
drop.addEventListener("dragleave", () => drop.classList.remove("arrastando"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("arrastando");
  adicionarArquivos(e.dataTransfer.files);
});

$("arquivoMusica").addEventListener("change", async (e) => {
  const arquivo = e.target.files[0];
  estado.musica = null;
  $("infoMusica").hidden = true;
  if (!arquivo) return;
  try {
    estado.musica = await contextoAudio().decodeAudioData(await arquivo.arrayBuffer());
    $("infoMusica").textContent =
      `🎵 ${arquivo.name} (${Math.round(estado.musica.duration)} s). Ela toca baixinho por baixo da narração.`;
    $("infoMusica").hidden = false;
  } catch {
    mostrarErro("Não consegui abrir essa música. Tente um arquivo MP3 ou M4A.", "erroMidia");
  }
});

// ---------------------------------------------------------------------------
// Roteiro

function usaChaveAnthropic() {
  return !naPaginaClaude && Boolean(config.anthropicKey);
}

function atualizarRotuloRoteiro() {
  const comIa = estado.sample || usaChaveAnthropic();
  $("btnRoteiro").textContent = comIa ? "✨ Gerar roteiro com IA" : "✨ Gerar roteiro (modelo pronto)";
}

async function gerarRoteiro() {
  const produto = lerProduto();
  if (!produto.nome) throw new Error("Preencha o nome do produto (passo 1).");
  const opcoes = { estilo: estado.estilo, duracao: estado.duracao, velocidade: Number($("velocidade").value) };
  let roteiro = null;
  let info = "";
  if (estado.sample) {
    try {
      roteiro = await gerarRoteiroSample(produto, opcoes, estado.sample);
      info = "Roteiro escrito pela Claude. Revise e ajuste o que quiser.";
    } catch (err) {
      if (!(err instanceof IaIndisponivel)) throw err;
      estado.sample = null;
      atualizarRotuloRoteiro();
      info = "A IA não foi liberada nesta página, então usei um roteiro de modelo pronto.";
    }
  } else if (usaChaveAnthropic()) {
    roteiro = await gerarRoteiroIA(produto, opcoes, config.anthropicKey, config.anthropicModel);
    info = "Roteiro escrito pela Claude. Revise e ajuste o que quiser.";
  }
  if (!roteiro) {
    roteiro = gerarRoteiroModelo(produto, opcoes);
    info ||= naPaginaClaude
      ? "Roteiro de modelo pronto. Revise e ajuste o que quiser."
      : "Roteiro de modelo pronto. Para roteiros escritos por IA, coloque sua chave da Anthropic em ⚙️.";
  }
  $("infoRoteiro").textContent = info;
  $("gancho").value = roteiro.gancho;
  $("narracao").value = roteiro.narracao;
  $("legendaPost").value = roteiro.legendaPost;
}

$("btnRoteiro").addEventListener("click", async () => {
  limparErro();
  const botao = $("btnRoteiro");
  botao.disabled = true;
  botao.textContent = "Escrevendo…";
  try {
    await gerarRoteiro();
  } catch (err) {
    mostrarErro(err.message, "erroRoteiro");
  } finally {
    botao.disabled = false;
    atualizarRotuloRoteiro();
  }
});

$("btnCopiarLegenda").addEventListener("click", async () => {
  const texto = $("legendaPost").value;
  if (!texto) return;
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    $("legendaPost").select();
    document.execCommand("copy");
  }
  $("btnCopiarLegenda").textContent = "Copiada ✓";
  setTimeout(() => ($("btnCopiarLegenda").textContent = "Copiar legenda"), 1500);
});

// ---------------------------------------------------------------------------
// Voz

function configVoz() {
  return {
    provedor: $("provedor").value,
    voz: $("voz").value,
    tom: estado.tom,
    velocidade: Number($("velocidade").value),
    chaves: { eleven: config.elevenKey, openai: config.openaiKey },
    modelos: { eleven: config.elevenModel, openai: config.openaiModel },
    audioProprio: estado.audioProprio,
  };
}

function preencherVozes(vozes) {
  const sel = $("voz");
  sel.replaceChildren(...vozes.map((v) => new Option(v.nome, v.id)));
  if (vozes.some((v) => v.id === config.voz)) sel.value = config.voz;
}

async function atualizarProvedor() {
  const provedor = $("provedor").value;
  const comApi = provedor === "elevenlabs" || provedor === "openai";
  for (const el of [$("voz").closest(".campo"), $("tons").closest(".campo"), $("btnPrevia")]) el.hidden = !comApi;
  $("campoVelocidade").hidden = provedor === "arquivo";
  $("campoAudioProprio").hidden = provedor !== "arquivo";
  const info = $("infoProvedor");
  info.textContent = "";
  if (provedor === "openai") {
    preencherVozes(VOZES_OPENAI);
    if (!config.openaiKey) info.textContent = "Coloque sua chave da OpenAI em ⚙️ para usar esta voz.";
  } else if (provedor === "elevenlabs") {
    if (!config.elevenKey) {
      preencherVozes([]);
      info.textContent = "Coloque sua chave da ElevenLabs em ⚙️ para usar esta voz.";
      return;
    }
    if (!estado.vozesEleven) {
      info.textContent = "Carregando suas vozes…";
      estado.vozesEleven = await listarVozesEleven(config.elevenKey);
      info.textContent = "";
    }
    preencherVozes(estado.vozesEleven);
  } else if (provedor === "arquivo") {
    info.textContent = estado.audioProprio
      ? `🎙️ Áudio de ${Math.round(estado.audioProprio.duration)} s carregado.`
      : "Grave no celular lendo a narração do passo 3 e envie o arquivo aqui. As legendas usam o texto do passo 3, com o tempo ajustado ao seu áudio.";
  } else {
    info.textContent =
      "O vídeo sai só com legendas. Dá para colocar uma música de fundo no passo 2 ou adicionar som no app onde for postar.";
  }
}

$("provedor").addEventListener("change", () => {
  config.provedor = $("provedor").value;
  salvarConfig();
  atualizarProvedor();
});
$("arquivoNarracao").addEventListener("change", async (e) => {
  limparErro();
  const arquivo = e.target.files[0];
  estado.audioProprio = null;
  estado.audioProprioVersao++;
  if (arquivo) {
    try {
      estado.audioProprio = await contextoAudio().decodeAudioData(await arquivo.arrayBuffer());
    } catch {
      mostrarErro("Não consegui abrir esse áudio. Tente um arquivo MP3, M4A ou WAV.", "erroVoz");
    }
  }
  atualizarProvedor();
});
$("voz").addEventListener("change", () => {
  config.voz = $("voz").value;
  salvarConfig();
});

/** Gera a narração ou reaproveita a última, se nada mudou (evita gastar créditos de novo). */
async function obterNarracao() {
  const cfg = configVoz();
  const texto = $("narracao").value;
  const modelo =
    cfg.provedor === "elevenlabs" ? cfg.modelos.eleven : cfg.provedor === "openai" ? cfg.modelos.openai : "";
  const gravacao = cfg.provedor === "arquivo" ? estado.audioProprioVersao : 0;
  const chave = JSON.stringify([texto, cfg.provedor, cfg.voz, cfg.tom, cfg.velocidade, modelo, gravacao]);
  if (estado.narracao.chave === chave && estado.narracao.resultado) return estado.narracao.resultado;
  const resultado = await gerarNarracao(texto, cfg, contextoAudio());
  estado.narracao = { chave, resultado };
  return resultado;
}

$("btnPrevia").addEventListener("click", async () => {
  limparErro();
  const botao = $("btnPrevia");
  const ctx = contextoAudio();
  if (estado.previa) {
    estado.previa.stop();
    return;
  }
  botao.disabled = true;
  botao.textContent = "Gerando a voz…";
  try {
    const { buffer } = await obterNarracao();
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      estado.previa = null;
      botao.textContent = "▶ Ouvir a narração";
    };
    estado.previa = src;
    src.start();
    botao.textContent = "■ Parar";
  } catch (err) {
    mostrarErro(err.message, "erroVoz");
    botao.textContent = "▶ Ouvir a narração";
  } finally {
    botao.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Geração do vídeo

const ETAPAS = ["roteiro", "voz", "montagem", "cortes", "final", "pronto"];

function marcarEtapa(atual) {
  const indice = ETAPAS.indexOf(atual);
  document.querySelectorAll("#etapas li").forEach((li) => {
    const i = ETAPAS.indexOf(li.dataset.etapa);
    li.classList.toggle("feita", i < indice || atual === "pronto");
    li.classList.toggle("ativa", i === indice && atual !== "pronto");
  });
}

function definirOcupado(ocupado) {
  estado.ocupado = ocupado;
  for (const id of ["btnGerar", "btnOutraVersao", "btnRoteiro", "btnPrevia"]) $(id).disabled = ocupado;
}

async function gerarVideo() {
  if (estado.ocupado) return;
  limparErro();
  const ctx = contextoAudio(); // criado dentro do clique, para o navegador liberar o som

  if (!estado.midias.length) {
    mostrarErro("Adicione pelo menos um vídeo ou foto do produto (passo 2).");
    return;
  }
  if (!$("narracao").value.trim() && !$("nome").value.trim()) {
    mostrarErro("Preencha o nome do produto (passo 1) ou escreva a narração (passo 3).");
    return;
  }

  definirOcupado(true);
  $("painelProgresso").hidden = false;
  $("resultado").hidden = true;
  $("barraProgresso").style.width = "0%";
  $("painelProgresso").scrollIntoView({ behavior: "smooth", block: "start" });
  let travaTela = null;

  try {
    marcarEtapa("roteiro");
    if (!$("narracao").value.trim()) await gerarRoteiro();

    marcarEtapa("voz");
    const narracao = await obterNarracao();

    marcarEtapa("montagem");
    await Promise.all([document.fonts.load("900 58px Montserrat"), document.fonts.load("800 40px Montserrat")]).catch(
      () => {},
    );
    const ultima = narracao.palavras[narracao.palavras.length - 1];
    const duracao = Math.max(narracao.duracao, ultima ? ultima.fim : 0, 3.5) + 0.6;

    marcarEtapa("cortes");
    const cortes = montarCortes(narracao.palavras, duracao, estado.midias, criarAleatorio(estado.semente));

    marcarEtapa("final");
    $("avisoGravando").hidden = false;
    $("palco").hidden = false;
    try {
      travaTela = await navigator.wakeLock?.request("screen");
    } catch {
      // sem trava de tela: o aviso na tela basta
    }
    const altura = Number($("qualidade").value) === 1080 ? 1920 : 1280;
    const resultado = await gravarVideo({
      canvas: $("canvas"),
      container: $("bastidores"),
      audioCtx: ctx,
      cortes,
      palavras: narracao.palavras,
      duracao,
      narracao: narracao.buffer,
      musica: estado.musica,
      largura: (altura * 9) / 16,
      altura,
      opcoes: {
        gancho: $("gancho").value,
        mostrarGancho: $("mostrarGancho").checked,
        preco: lerProduto().preco,
        mostrarPreco: $("mostrarPreco").checked,
        cta: $("cta").value,
        ouvir: $("ouvirGravando").checked,
      },
      aoProgredir: (f) => ($("barraProgresso").style.width = `${Math.round(f * 100)}%`),
    });

    marcarEtapa("pronto");
    mostrarResultado(resultado, duracao);
  } catch (err) {
    console.error(err);
    mostrarErro(err.message || String(err));
    document.querySelectorAll("#etapas li.ativa").forEach((li) => li.classList.remove("ativa"));
  } finally {
    $("avisoGravando").hidden = true;
    $("palco").hidden = true;
    travaTela?.release().catch(() => {});
    definirOcupado(false);
  }
}

function mostrarResultado({ blob, extensao }, duracao) {
  if (estado.videoUrl) URL.revokeObjectURL(estado.videoUrl);
  estado.videoUrl = URL.createObjectURL(blob);
  estado.videoBlob = blob;
  $("videoFinal").src = estado.videoUrl;
  const slug = (lerProduto().nome || "produto")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const baixar = $("btnBaixar");
  baixar.href = estado.videoUrl;
  baixar.download = `video-${slug || "produto"}.${extensao}`;
  const mb = (blob.size / 1024 / 1024).toFixed(1).replace(".", ",");
  let info = `${Math.round(duracao)} s · ${mb} MB · ${extensao.toUpperCase()}`;
  // Numa página do Claude, um link de download comum não funciona; sem a capability, some o botão.
  baixar.hidden = naPaginaClaude && !estado.downloads;
  if (baixar.hidden) info += ". Salvar o arquivo não está disponível nesta visualização";
  if (extensao === "webm") {
    info +=
      ". Seu navegador gravou em WebM; se o app de postagem não aceitar, gere de novo no Chrome atualizado ou no Safari, que gravam em MP4.";
  }
  $("infoArquivo").textContent = info;
  $("resultado").hidden = false;
  $("resultado").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("btnBaixar").addEventListener("click", async (e) => {
  if (!estado.downloads || !estado.videoBlob) return; // fora da página do Claude, o link baixa sozinho
  e.preventDefault();
  try {
    await estado.downloads.save({ filename: $("btnBaixar").download, data: estado.videoBlob });
  } catch (err) {
    if (err?.code === "declined") return;
    if (err?.code === "rate_limited")
      mostrarErro("Já existe um pedido para salvar aberto. Responda a ele e tente de novo.");
    else mostrarErro("Não consegui salvar o vídeo nesta visualização.");
  }
});

$("btnGerar").addEventListener("click", gerarVideo);
$("btnOutraVersao").addEventListener("click", () => {
  estado.semente = (estado.semente * 1103515245 + 12345) >>> 0;
  gerarVideo();
});

// ---------------------------------------------------------------------------
// Erros

const CAIXAS_DE_ERRO = ["erro", "erroMidia", "erroRoteiro", "erroVoz"];

/** Mostra o erro na caixa perto de onde a pessoa está mexendo. */
function mostrarErro(msg, onde = "erro") {
  const el = $(onde);
  el.textContent = msg;
  el.hidden = false;
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function limparErro() {
  for (const id of CAIXAS_DE_ERRO) {
    $(id).hidden = true;
    $(id).textContent = "";
  }
}

// ---------------------------------------------------------------------------
// Início

async function prepararPaginaClaude() {
  $("btnConfig").hidden = true;
  for (const valor of ["elevenlabs", "openai"]) $("provedor").querySelector(`option[value="${valor}"]`)?.remove();
  const [sample, downloads] = await Promise.all([window.claude.use("sample"), window.claude.use("downloads")]);
  estado.sample = sample;
  estado.downloads = downloads;
  atualizarRotuloRoteiro();
}

carregarConfig();
if (config.provedor) $("provedor").value = config.provedor;
if (naPaginaClaude) {
  if (!["nenhum", "arquivo"].includes($("provedor").value)) $("provedor").value = "nenhum";
  prepararPaginaClaude();
}
atualizarRotuloRoteiro();
atualizarProvedor();
