// Montagem e gravação do vídeo no navegador (canvas + Web Audio + MediaRecorder).
import { ehFimDeFrase, temPausa } from "./voz.js";

const CORTE_MAXIMO = 2.6; // segundos: cenas maiores viram vários cortes
const CENA_MINIMA = 0.9; // segundos: cenas menores são juntadas com a seguinte
const DURACAO_CTA = 2.4; // segundos finais com a chamada para ação
const COR_DESTAQUE = "#FFE14D";

/** Gerador pseudoaleatório com semente (mulberry32), para versões reproduzíveis. */
export function criarAleatorio(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Divide a narração em cenas (uma por frase) e as cenas em cortes de mídia. */
export function montarCortes(palavras, duracao, midias, aleatorio) {
  if (!midias.length) throw new Error("Adicione pelo menos um vídeo ou foto (passo 2).");

  // Cenas: começam em 0 e em cada palavra que vem depois de um fim de frase.
  const limites = [0];
  palavras.forEach((p, i) => {
    const proxima = palavras[i + 1];
    if (proxima && ehFimDeFrase(p.texto)) limites.push(proxima.inicio);
  });
  limites.push(duracao);

  const cenas = [];
  for (let i = 0; i < limites.length - 1; i++) {
    const inicio = limites[i];
    const fim = limites[i + 1];
    if (fim - inicio <= 0.01) continue;
    const anterior = cenas[cenas.length - 1];
    if (anterior && anterior.fim - anterior.inicio < CENA_MINIMA) anterior.fim = fim;
    else cenas.push({ inicio, fim });
  }
  const ultima = cenas[cenas.length - 1];
  if (cenas.length > 1 && ultima.fim - ultima.inicio < CENA_MINIMA) {
    cenas.pop();
    cenas[cenas.length - 1].fim = ultima.fim;
  }

  const intervalos = [];
  for (const cena of cenas) {
    const d = cena.fim - cena.inicio;
    const n = Math.max(1, Math.ceil(d / CORTE_MAXIMO));
    for (let k = 0; k < n; k++) {
      intervalos.push({ inicio: cena.inicio + (d * k) / n, fim: cena.inicio + (d * (k + 1)) / n });
    }
  }

  // Ordem das mídias embaralhada, sem repetir a mesma em seguida quando há mais de uma.
  const usados = midias.map(() => []);
  let fila = [];
  let anterior = -1;
  const proximaMidia = () => {
    if (!fila.length) {
      fila = embaralhar(
        midias.map((_, i) => i),
        aleatorio,
      );
      if (fila.length > 1 && fila[0] === anterior) fila.push(fila.shift());
    }
    anterior = fila.shift();
    return anterior;
  };

  return intervalos.map(({ inicio, fim }) => {
    const m = proximaMidia();
    const midia = midias[m];
    const d = fim - inicio;
    const corte = {
      inicio,
      fim,
      midia,
      indiceMidia: m,
      trecho: 0,
      // Movimento de câmera: zoom lento e deslocamento (valores de -1 a 1).
      z0: 1,
      z1: 1.06,
      px0: 0,
      px1: 0,
      py0: 0,
      py1: 0,
    };
    if (midia.tipo === "video") {
      corte.trecho = escolherTrecho(midia.duracao, d, usados[m], aleatorio);
    } else {
      const aproxima = aleatorio() < 0.5;
      corte.z0 = aproxima ? 1.0 : 1.14;
      corte.z1 = aproxima ? 1.14 : 1.0;
      corte.px0 = aleatorio() * 2 - 1;
      corte.px1 = -corte.px0 * 0.5;
      corte.py0 = aleatorio() * 2 - 1;
      corte.py1 = -corte.py0 * 0.5;
    }
    return corte;
  });
}

/** Escolhe um trecho do vídeo que se repita o mínimo possível com os já usados. */
function escolherTrecho(duracaoVideo, d, usados, aleatorio) {
  const livre = duracaoVideo - d;
  if (!(livre > 0.05)) return 0;
  let melhor = 0;
  let menor = Infinity;
  for (let k = 0; k < 6; k++) {
    const o = aleatorio() * livre;
    const sobreposicao = usados.reduce((soma, [a, b]) => soma + Math.max(0, Math.min(b, o + d) - Math.max(a, o)), 0);
    if (sobreposicao < menor) {
      menor = sobreposicao;
      melhor = o;
    }
  }
  usados.push([melhor, melhor + d]);
  return melhor;
}

function embaralhar(lista, aleatorio) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Agrupa palavras em blocos curtos de legenda (até 3 palavras, quebra na pontuação). */
export function montarBlocosLegenda(palavras) {
  const blocos = [];
  let atual = [];
  palavras.forEach((p, i) => {
    atual.push(p);
    const proxima = palavras[i + 1];
    const letras = atual.reduce((n, w) => n + w.texto.length, 0) + atual.length - 1;
    const silencio = proxima ? proxima.inicio - p.fim > 0.35 : true;
    if (atual.length >= 3 || letras >= 14 || temPausa(p.texto) || silencio) {
      blocos.push(atual);
      atual = [];
    }
  });
  return blocos.map((ps, k) => {
    const seguinte = blocos[k + 1];
    const fimNatural = ps[ps.length - 1].fim + 0.5;
    return {
      palavras: ps.map((p) => ({ ...p, exibir: textoLegenda(p.texto) })),
      inicio: ps[0].inicio,
      fim: seguinte ? Math.min(seguinte[0].inicio, fimNatural) : fimNatural,
    };
  });
}

function textoLegenda(palavra) {
  return palavra
    .replace(/[.,;:…"“”]+$/u, "")
    .replace(/^["“”]+/u, "")
    .toLocaleUpperCase("pt-BR");
}

/** Formato de gravação: MP4 quando o navegador permite, senão WebM. */
export function escolherFormato() {
  const opcoes = [
    "video/mp4;codecs=avc1.640028,mp4a.40.2",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") return null;
  const tipo = opcoes.find((t) => MediaRecorder.isTypeSupported(t));
  if (!tipo) return null;
  return { tipo, extensao: tipo.startsWith("video/mp4") ? "mp4" : "webm" };
}

function buscar(video, tempo) {
  return new Promise((resolve) => {
    const pronto = () => {
      clearTimeout(limite);
      video.removeEventListener("seeked", pronto);
      resolve();
    };
    const limite = setTimeout(pronto, 3000);
    video.addEventListener("seeked", pronto);
    video.currentTime = tempo;
  });
}

function carregarVideo(url, container) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.loop = true;
    v.preload = "auto";
    v.addEventListener("loadeddata", () => resolve(v), { once: true });
    v.addEventListener("error", () => reject(new Error("Não consegui abrir um dos vídeos.")), { once: true });
    v.src = url;
    container.appendChild(v);
    v.load();
  });
}

const suavizar = (p) => p * p * (3 - 2 * p);
const lerp = (a, b, p) => a + (b - a) * p;
function voltaComPulo(p) {
  const c = 1.70158;
  const x = p - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
}

/**
 * Grava o vídeo. Roda em tempo real: um vídeo de 30 s leva cerca de 30 s para gravar.
 * Retorna { blob, tipo, extensao }.
 */
export async function gravarVideo({
  canvas,
  container,
  audioCtx,
  cortes,
  palavras,
  duracao,
  narracao,
  musica,
  largura,
  altura,
  opcoes,
  aoProgredir = () => {},
}) {
  const formato = escolherFormato();
  if (!formato || typeof canvas.captureStream !== "function") {
    throw new Error("Seu navegador não consegue gravar vídeo. Use o Chrome, Edge ou Safari atualizados.");
  }

  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  const fundo = document.createElement("canvas");
  fundo.width = largura;
  fundo.height = altura;
  const fundoCtx = fundo.getContext("2d");
  const mini = document.createElement("canvas");
  mini.width = Math.max(8, Math.round(largura / 24));
  mini.height = Math.max(8, Math.round(altura / 24));
  const miniCtx = mini.getContext("2d");

  // Dois elementos <video> por arquivo: enquanto um toca, o outro já busca o próximo trecho.
  const elementos = [];
  const pares = new Map();
  try {
    for (const corte of cortes) {
      if (corte.midia.tipo !== "video") continue;
      if (!pares.has(corte.indiceMidia)) {
        const a = await carregarVideo(corte.midia.url, container);
        const b = await carregarVideo(corte.midia.url, container);
        elementos.push(a, b);
        pares.set(corte.indiceMidia, { lista: [a, b], vez: 0 });
      }
      const par = pares.get(corte.indiceMidia);
      corte.el = par.lista[par.vez % 2];
      par.vez++;
    }
    const primeiraVez = new Map();
    for (const corte of cortes) {
      if (corte.el && !primeiraVez.has(corte.el)) primeiraVez.set(corte.el, corte.trecho);
    }
    await Promise.all([...primeiraVez].map(([el, t]) => buscar(el, t)));
  } catch (err) {
    elementos.forEach((v) => v.remove());
    throw err;
  }

  const blocos = montarBlocosLegenda(palavras);
  const fs = largura / 720;

  // Áudio: narração + música vão para a gravação (e para o alto-falante, se pedido).
  const destino = audioCtx.createMediaStreamDestination();
  const mestre = audioCtx.createGain();
  mestre.connect(destino);
  if (opcoes.ouvir) mestre.connect(audioCtx.destination);
  const fontes = [];

  const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...destino.stream.getAudioTracks()]);
  const gravador = new MediaRecorder(stream, {
    mimeType: formato.tipo,
    videoBitsPerSecond: largura >= 1080 ? 10_000_000 : 6_000_000,
    audioBitsPerSecond: 128_000,
  });
  const pedacos = [];
  gravador.ondataavailable = (e) => {
    if (e.data && e.data.size) pedacos.push(e.data);
  };
  const parou = new Promise((resolve) => {
    gravador.onstop = resolve;
  });

  let corteAtual = -1;
  const indiceDoCorte = (t) => {
    let k = Math.max(0, corteAtual);
    while (k < cortes.length - 1 && t >= cortes[k].fim) k++;
    return k;
  };

  const trocarCorte = (antigo, novo) => {
    const velho = cortes[antigo];
    if (velho?.el) {
      velho.el.pause();
      const proximo = cortes.find((c, i) => i > novo && c.el === velho.el);
      if (proximo && velho.el !== cortes[novo].el) velho.el.currentTime = proximo.trecho;
    }
    const corte = cortes[novo];
    if (corte.el) {
      if (Math.abs(corte.el.currentTime - corte.trecho) > 0.25) corte.el.currentTime = corte.trecho;
      corte.el.play().catch(() => {});
    }
  };

  const desenharMidia = (corte, t) => {
    const local = t - corte.inicio;
    const p = Math.min(1, Math.max(0, local / (corte.fim - corte.inicio)));
    const midia = corte.midia;
    const fonte = midia.tipo === "video" ? corte.el : midia.imagem;
    if (midia.tipo === "video" && corte.el.readyState < 2) return;
    const sw = midia.tipo === "video" ? corte.el.videoWidth : midia.largura;
    const sh = midia.tipo === "video" ? corte.el.videoHeight : midia.altura;
    if (!sw || !sh) return;

    let zoom = lerp(corte.z0, corte.z1, suavizar(p));
    if (local < 0.25) zoom *= 1 + 0.07 * (1 - local / 0.25) ** 2; // "soco" de zoom no início do corte
    const px = lerp(corte.px0, corte.px1, suavizar(p));
    const py = lerp(corte.py0, corte.py1, suavizar(p));

    if (sw / sh > 0.75) {
      // Mídia horizontal ou quadrada: fundo desfocado + mídia inteira no centro.
      const sCover = Math.max(mini.width / sw, mini.height / sh);
      miniCtx.drawImage(
        fonte,
        (mini.width - sw * sCover) / 2,
        (mini.height - sh * sCover) / 2,
        sw * sCover,
        sh * sCover,
      );
      fundoCtx.imageSmoothingEnabled = true;
      fundoCtx.imageSmoothingQuality = "high";
      fundoCtx.drawImage(mini, 0, 0, largura, altura);
      fundoCtx.fillStyle = "rgba(0,0,0,0.35)";
      fundoCtx.fillRect(0, 0, largura, altura);
      const s = (largura / sw) * zoom;
      const dw = sw * s;
      const dh = sh * s;
      const sobraX = Math.max(0, dw - largura) / 2;
      fundoCtx.drawImage(fonte, (largura - dw) / 2 + px * sobraX, altura * 0.47 - dh / 2 + py * 20 * fs, dw, dh);
    } else {
      const s = Math.max(largura / sw, altura / sh) * zoom;
      const dw = sw * s;
      const dh = sh * s;
      const sobraX = (dw - largura) / 2;
      const sobraY = (dh - altura) / 2;
      fundoCtx.drawImage(fonte, (largura - dw) / 2 + px * sobraX, (altura - dh) / 2 + py * sobraY, dw, dh);
    }
  };

  const contornar = (texto, x, y, cor, espessura) => {
    ctx.lineWidth = espessura;
    ctx.strokeStyle = "#000";
    ctx.strokeText(texto, x, y);
    ctx.fillStyle = cor;
    ctx.fillText(texto, x, y);
  };

  const quebrarLinhas = (palavrasLinha, larguraMax) => {
    const linhas = [[]];
    let usada = 0;
    const espaco = ctx.measureText(" ").width;
    for (const w of palavrasLinha) {
      const lw = ctx.measureText(w.exibir).width;
      if (linhas[linhas.length - 1].length && usada + espaco + lw > larguraMax) {
        linhas.push([]);
        usada = 0;
      }
      const linha = linhas[linhas.length - 1];
      usada += (linha.length ? espaco : 0) + lw;
      linha.push({ ...w, largura: lw });
    }
    return { linhas, espaco };
  };

  const desenharGancho = (t) => {
    const texto = (opcoes.gancho || "").trim();
    if (!opcoes.mostrarGancho || !texto) return;
    const tamanho = 40 * fs;
    ctx.save();
    ctx.globalAlpha = Math.min(1, t / 0.3);
    const g = ctx.createLinearGradient(0, 0, 0, altura * 0.24);
    g.addColorStop(0, "rgba(0,0,0,0.45)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, largura, altura * 0.24);
    ctx.font = `800 ${tamanho}px Montserrat, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const itens = texto.split(/\s+/).map((w) => ({ exibir: w }));
    const { linhas, espaco } = quebrarLinhas(itens, largura * 0.86);
    linhas.slice(0, 3).forEach((linha, i) => {
      const total = linha.reduce((n, w) => n + w.largura, 0) + espaco * (linha.length - 1);
      let x = (largura - total) / 2;
      const y = altura * 0.085 + i * tamanho * 1.18;
      for (const w of linha) {
        contornar(w.exibir, x, y, "#fff", tamanho * 0.2);
        x += w.largura + espaco;
      }
    });
    ctx.restore();
  };

  const desenharLegenda = (t) => {
    const bloco = blocos.find((b) => t >= b.inicio && t < b.fim);
    if (!bloco) return;
    const tamanho = 58 * fs;
    ctx.save();
    ctx.font = `900 ${tamanho}px Montserrat, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const { linhas, espaco } = quebrarLinhas(bloco.palavras, largura * 0.84);
    const entrada = Math.min(1, (t - bloco.inicio) / 0.16);
    const escala = 0.82 + 0.18 * voltaComPulo(entrada);
    const yBase = altura * 0.63;
    const alturaLinha = tamanho * 1.12;
    ctx.translate(largura / 2, yBase);
    ctx.scale(escala, escala);
    let ativa = bloco.palavras[0];
    for (const w of bloco.palavras) if (t >= w.inicio) ativa = w;
    linhas.forEach((linha, i) => {
      const total = linha.reduce((n, w) => n + w.largura, 0) + espaco * (linha.length - 1);
      let x = -total / 2;
      const y = (i - (linhas.length - 1) / 2) * alturaLinha;
      for (const w of linha) {
        const cor = w.inicio === ativa.inicio && w.texto === ativa.texto ? COR_DESTAQUE : "#fff";
        contornar(w.exibir, x, y, cor, tamanho * 0.22);
        x += w.largura + espaco;
      }
    });
    ctx.restore();
  };

  const desenharChamada = (t) => {
    const inicioCta = duracao - DURACAO_CTA;
    if (t < inicioCta) return;
    const p = Math.min(1, (t - inicioCta) / 0.35);
    const escala = 0.6 + 0.4 * voltaComPulo(p);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const preco = (opcoes.preco || "").trim();
    if (opcoes.mostrarPreco && preco) {
      const tamanho = 50 * fs;
      ctx.save();
      ctx.translate(largura / 2, altura * 0.75);
      ctx.rotate(-0.06);
      ctx.scale(escala, escala);
      ctx.font = `900 ${tamanho}px Montserrat, system-ui, sans-serif`;
      const texto = `R$ ${preco}`;
      const w = ctx.measureText(texto).width + 44 * fs;
      const h = tamanho * 1.45;
      ctx.fillStyle = COR_DESTAQUE;
      retanguloArredondado(ctx, -w / 2, -h / 2, w, h, 14 * fs);
      ctx.fill();
      ctx.fillStyle = "#111";
      ctx.fillText(texto, 0, tamanho * 0.04);
      ctx.restore();
    }

    const cta = (opcoes.cta || "").trim();
    if (cta) {
      const tamanho = 36 * fs;
      ctx.save();
      ctx.translate(largura / 2, altura * 0.835);
      ctx.scale(escala, escala);
      ctx.font = `800 ${tamanho}px Montserrat, system-ui, sans-serif`;
      const w = ctx.measureText(cta).width + 56 * fs;
      const h = tamanho * 1.8;
      ctx.fillStyle = "#fff";
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 18 * fs;
      retanguloArredondado(ctx, -w / 2, -h / 2, w, h, h / 2);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.fillStyle = "#111";
      ctx.fillText(cta, 0, tamanho * 0.04);
      ctx.restore();
    }
    ctx.restore();
  };

  const desenhar = (t) => {
    const corte = cortes[corteAtual];
    desenharMidia(corte, t);
    ctx.drawImage(fundo, 0, 0);
    desenharGancho(t);
    desenharLegenda(t);
    desenharChamada(t);
  };

  // Começa a tocar e gravar ao mesmo tempo, usando o relógio do áudio como referência.
  const tocarEGravar = async () => {
    await audioCtx.resume();
    fundoCtx.fillStyle = "#000";
    fundoCtx.fillRect(0, 0, largura, altura);
    corteAtual = 0;
    trocarCorte(-1, 0);
    desenhar(0);
    gravador.start(500);
    const t0 = audioCtx.currentTime + 0.15;

    if (narracao) {
      const src = audioCtx.createBufferSource();
      src.buffer = narracao;
      src.connect(mestre);
      src.start(t0);
      fontes.push(src);
    }
    if (musica) {
      const src = audioCtx.createBufferSource();
      src.buffer = musica;
      src.loop = true;
      const volume = audioCtx.createGain();
      const nivel = narracao ? 0.12 : 0.5;
      volume.gain.setValueAtTime(nivel, t0);
      volume.gain.setValueAtTime(nivel, t0 + Math.max(0, duracao - 1.2));
      volume.gain.linearRampToValueAtTime(0, t0 + duracao);
      src.connect(volume).connect(mestre);
      src.start(t0);
      fontes.push(src);
    }

    await new Promise((resolve) => {
      const passo = () => {
        const t = Math.max(0, audioCtx.currentTime - t0);
        if (t >= duracao + 0.15) {
          resolve();
          return;
        }
        const tt = Math.min(t, duracao - 0.001);
        const k = indiceDoCorte(tt);
        if (k !== corteAtual) {
          trocarCorte(corteAtual, k);
          corteAtual = k;
        }
        desenhar(tt);
        aoProgredir(Math.min(1, t / duracao));
        agendar(passo);
      };
      agendar(passo);
    });

    gravador.stop();
    await parou;
  };

  try {
    await tocarEGravar();
  } finally {
    fontes.forEach((f) => {
      try {
        f.stop();
      } catch {
        // já parou
      }
    });
    mestre.disconnect();
    elementos.forEach((v) => {
      v.pause();
      v.removeAttribute("src");
      v.load();
      v.remove();
    });
    cortes.forEach((c) => delete c.el);
    stream.getTracks().forEach((tr) => tr.stop());
  }

  return {
    blob: new Blob(pedacos, { type: formato.tipo.split(";")[0] }),
    tipo: formato.tipo,
    extensao: formato.extensao,
  };
}

// requestAnimationFrame para quando a aba está visível; o setTimeout cobre a aba em segundo plano.
function agendar(fn) {
  let feito = false;
  const uma = () => {
    if (feito) return;
    feito = true;
    fn();
  };
  requestAnimationFrame(uma);
  setTimeout(uma, 50);
}

function retanguloArredondado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
