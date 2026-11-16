// Cardapio completo (copia do cadastro Gama) + mapa opcional Gama->codigos HML + validacao do carrinho.
// Puro/injetavel: sem rede e sem segredos. Precos em CENTAVOS inteiros; o cliente NUNCA informa preco.
// Os codigos Saipos (HML) ficam so no servidor; nada daqui vai para o front.

import { readFile } from "node:fs/promises";
import { localizarCodigo } from "../../saipos-teste/src/payload.js";
import { sha256Json } from "../../saipos-teste/src/arquivos.js";
import { MAX_ITENS, MAX_QTD, MAX_COMPLEMENTOS_POR_ITEM, MAX_TOTAL_CENTAVOS, totalItemCentavos } from "../../saipos-teste/src/carrinho.js";

export const CODIGO_DIVERSOS = "40101353"; // nunca usado como descricao falsa de item do cardapio
export const MAX_OBS = 80;
export const DIAS = ["Domingo", "Segunda-Feira", "Terça-Feira", "Quarta-Feira", "Quinta-Feira", "Sexta-Feira", "Sábado"];
const DIA_CURTO = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const CODIGO_HML = /^[A-Za-z0-9._-]{1,64}$/;

export class ErroCardapio extends Error {
  constructor(codigo, mensagem, { status = 400, motivo } = {}) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
    this.motivo = motivo;
  }
}

const objeto = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const idOk = (v) => Number.isSafeInteger(v) && v > 0;
const bit = (v) => v === 0 || v === 1;
const invalido = (m) => new ErroCardapio("DTO_INVALIDO", m, { status: 503 });

// ---------- DTO do cardapio ----------

function parseDias(v, onde) {
  if (typeof v !== "string") throw invalido(`${onde}: dias ausentes`);
  const lista = v.split(",");
  if (lista.some((d) => !DIAS.includes(d))) throw invalido(`${onde}: dia desconhecido`);
  return new Set(lista);
}

function parseHoras(v, onde) {
  if (typeof v !== "string") throw invalido(`${onde}: horarios ausentes`);
  const lista = v.replace(/;/g, ",").split(",");
  const horas = lista.map((h) => {
    if (!/^(0\d|1\d|2[0-3])$/.test(h)) throw invalido(`${onde}: hora invalida`);
    return Number(h);
  });
  return new Set(horas);
}

export async function carregarDto(caminho) {
  let bruto;
  try {
    bruto = JSON.parse(await readFile(caminho, "utf8"));
  } catch {
    throw invalido("arquivo do cardapio ausente ou ilegivel");
  }
  if (!objeto(bruto) || bruto.formato !== "menu-cidadao-gama/1" || bruto.somenteTeste !== true) throw invalido("formato do cardapio inesperado");
  for (const k of ["categorias", "produtos", "grupos", "opcoes"]) if (!Array.isArray(bruto[k])) throw invalido(`lista ausente: ${k}`);

  const unicos = (lista, nome) => {
    const m = new Map();
    for (const x of lista) {
      if (!objeto(x) || !idOk(x.id) || m.has(x.id)) throw invalido(`${nome}: id invalido ou repetido`);
      m.set(x.id, x);
    }
    return m;
  };
  const categorias = unicos(bruto.categorias, "categorias");
  const produtos = unicos(bruto.produtos, "produtos");
  const grupos = unicos(bruto.grupos, "grupos");
  const opcoes = unicos(bruto.opcoes, "opcoes");

  for (const c of categorias.values()) {
    if (typeof c.nome !== "string" || !c.nome || !bit(c.ativo) || !bit(c.visivel)) throw invalido("categoria invalida");
    c._dias = parseDias(c.dias, `categoria ${c.id}`);
    c._horas = parseHoras(c.horarios, `categoria ${c.id}`);
  }
  for (const g of grupos.values()) {
    if (typeof g.nome !== "string" || !g.nome || !bit(g.ativo) || !bit(g.permitir_quantidade)) throw invalido("grupo invalido");
    if (!Number.isInteger(g.minimo) || !Number.isInteger(g.maximo) || g.minimo < 0 || g.maximo < 1 || g.minimo > g.maximo) throw invalido("grupo com minimo/maximo invalido");
    if (g.cobrar_apartir_de !== 0) throw invalido("grupo com regra de cobranca especial nao suportada");
  }
  for (const o of opcoes.values()) {
    if (typeof o.nome !== "string" || !o.nome || !bit(o.ativo) || !grupos.has(o.adicional) || !Number.isSafeInteger(o.centavos) || o.centavos < 0) throw invalido("opcao invalida");
  }
  for (const p of produtos.values()) {
    if (typeof p.nome !== "string" || !p.nome || !categorias.has(p.categoria) || !bit(p.ativo) || !bit(p.visivel)) throw invalido("produto invalido");
    if (typeof p.ocultarObservacao !== "boolean" || typeof p.ocultarQuantidade !== "boolean") throw invalido("flags do produto invalidas");
    if (p.fotoLocal !== null && p.fotoLocal !== undefined && !/^\/gama-fotos\/p\d{1,8}\.webp$/.test(p.fotoLocal)) throw invalido("foto local invalida");
    if (!Array.isArray(p.variacoes) || p.variacoes.length < 1) throw invalido("produto sem variacoes");
    const indices = new Set();
    for (const v of p.variacoes) {
      if (!objeto(v) || !idOk(v.indice) || indices.has(v.indice) || typeof v.nome !== "string" || !Number.isSafeInteger(v.centavos) || v.centavos < 0) throw invalido("variacao invalida");
      indices.add(v.indice);
    }
    if (!Array.isArray(p.grupos) || p.grupos.some((g) => !grupos.has(g)) || new Set(p.grupos).size !== p.grupos.length) throw invalido("grupos do produto invalidos");
    p._dias = parseDias(p.dias, `produto ${p.id}`);
    p._horas = parseHoras(p.horarios, `produto ${p.id}`);
  }
  return {
    categorias, produtos, grupos, opcoes,
    ordemProdutos: bruto.produtos.map((p) => p.id),
    ordemCategorias: bruto.categorias.map((c) => c.id),
    consultadoEm: typeof bruto.fonte?.consultadoEm === "string" ? bruto.fonte.consultadoEm : null,
    categoriasDisponiveisNaConsulta: Array.isArray(bruto.fonte?.categoriasDisponiveisNaConsulta) ? bruto.fonte.categoriasDisponiveisNaConsulta : [],
  };
}

// ---------- horarios (America/Sao_Paulo) ----------

const FORMATADOR_SP = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", hourCycle: "h23" });

export function agoraSaoPaulo(data) {
  const partes = Object.fromEntries(FORMATADOR_SP.formatToParts(data).map((p) => [p.type, p.value]));
  return { dia: DIAS[DIA_CURTO[partes.weekday]], hora: Number(partes.hour) };
}

function dentro(ent, sp) {
  return ent._dias.has(sp.dia) && ent._horas.has(sp.hora);
}

// null = disponivel agora; senao o motivo (texto curto e estavel).
export function motivoIndisponivel(dto, produto, data) {
  const cat = dto.categorias.get(produto.categoria);
  if (produto.ativo !== 1 || produto.visivel !== 1 || cat.ativo !== 1 || cat.visivel !== 1) return "indisponivel";
  const sp = agoraSaoPaulo(data);
  if (!dentro(cat, sp) || !dentro(produto, sp)) return "fora_do_horario";
  return null;
}

// ---------- mapa Gama -> HML (opcional, fora de outputs) ----------

function chaveVar(produto, variacao) {
  return `${produto}:${variacao}`;
}

function chaveOpc(produto, variacao, opcao) {
  return `${produto}:${variacao}:${opcao}`;
}

const SO = (obj, chaves) => Object.keys(obj).every((k) => chaves.includes(k)) && chaves.every((k) => k in obj);

export async function carregarMapa(caminho, storeUuid, dto) {
  let bruto;
  try {
    bruto = JSON.parse(await readFile(caminho, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { estado: "ausente" };
    return { estado: "invalido", erro: "mapa_ilegivel" };
  }
  if (bruto === null) return { estado: "ausente" };
  const falha = (erro) => ({ estado: "invalido", erro });
  if (!objeto(bruto) || bruto.schema !== "gama-hml-map" || (bruto.version !== 1 && bruto.version !== 2)) return falha("mapa_schema");
  const v2 = bruto.version === 2;
  if (bruto.storeUuid !== storeUuid) return falha("mapa_loja_diferente");
  const extras = Object.keys(bruto).filter((k) => !["schema", "version", "storeUuid", "itens", "opcoes", "grupos", "comentario"].includes(k));
  if (extras.length || !Array.isArray(bruto.itens) || !Array.isArray(bruto.opcoes) || (bruto.grupos !== undefined && !Array.isArray(bruto.grupos))) return falha("mapa_schema");

  const itens = new Map();
  const codigosItens = new Set();
  for (const e of bruto.itens) {
    if (!objeto(e) || !SO(e, ["produto", "variacao", "codigoHml", "precoCentavos"])) return falha("mapa_item_invalido");
    if (!idOk(e.produto) || !idOk(e.variacao) || typeof e.codigoHml !== "string" || !CODIGO_HML.test(e.codigoHml) || !Number.isSafeInteger(e.precoCentavos) || e.precoCentavos < 0) return falha("mapa_item_invalido");
    if (e.codigoHml === CODIGO_DIVERSOS) return falha("mapa_usa_diversos");
    const k = chaveVar(e.produto, e.variacao);
    if (itens.has(k) || codigosItens.has(e.codigoHml)) return falha("mapa_item_repetido");
    const p = dto.produtos.get(e.produto);
    if (!p || !p.variacoes.some((v) => v.indice === e.variacao)) return falha("mapa_referencia_desconhecida");
    itens.set(k, e);
    codigosItens.add(e.codigoHml);
  }
  const opcoes = new Map();
  for (const e of bruto.opcoes) {
    if (!objeto(e) || !SO(e, v2 ? ["produto", "variacao", "opcao", "codigoHml", "precoCentavos"] : ["opcao", "codigoHml", "precoCentavos"])) return falha("mapa_opcao_invalida");
    if (!idOk(e.opcao) || (v2 && (!idOk(e.produto) || !idOk(e.variacao))) || typeof e.codigoHml !== "string" || !CODIGO_HML.test(e.codigoHml) || !Number.isSafeInteger(e.precoCentavos) || e.precoCentavos < 0) return falha("mapa_opcao_invalida");
    if (e.codigoHml === CODIGO_DIVERSOS) return falha("mapa_usa_diversos");
    const chave = v2 ? chaveOpc(e.produto, e.variacao, e.opcao) : e.opcao;
    if (opcoes.has(chave)) return falha("mapa_opcao_repetida");
    const op = dto.opcoes.get(e.opcao);
    if (!op) return falha("mapa_referencia_desconhecida");
    if (v2) {
      const p = dto.produtos.get(e.produto);
      if (!p || !p.variacoes.some((v) => v.indice === e.variacao) || !p.grupos.includes(op.adicional)) return falha("mapa_referencia_desconhecida");
    }
    opcoes.set(chave, e);
  }
  const grupos = new Map();
  for (const e of bruto.grupos ?? []) {
    if (!objeto(e) || !SO(e, ["grupo", "idStoreChoice"]) || !idOk(e.grupo) || !Number.isSafeInteger(e.idStoreChoice) || e.idStoreChoice < 0) return falha("mapa_grupo_invalido");
    if (grupos.has(e.grupo)) return falha("mapa_grupo_repetido");
    if (!dto.grupos.has(e.grupo)) return falha("mapa_referencia_desconhecida");
    grupos.set(e.grupo, e);
  }
  return { estado: "ok", version: bruto.version, itens, opcoes, grupos };
}

// ---------- ligacao com o catalogo HML ----------

const bloqueio = (motivo, mensagem = "Ainda estamos preparando este item na loja de teste.") =>
  new ErroCardapio("item_nao_pronto", mensagem, { status: 409, motivo });

function motivoDeConector(e) {
  const mapa = {
    CODIGO_NAO_CONFIRMADO: "codigo_hml_ausente",
    CODIGO_DESABILITADO: "desativado",
    PRECO_AMBIGUO: "preco_divergente",
    PRECO_INVALIDO: "preco_divergente",
  };
  return mapa[e?.codigo] ?? "catalogo_hml_invalido";
}

// Item HML da variacao: mapa + catalogo (PRATO habilitado, mesmo preco).
export function resolverItemHml(ctx, produto, variacao) {
  if (ctx.mapa.estado === "ausente") throw bloqueio("mapa_ausente");
  if (ctx.mapa.estado !== "ok") throw bloqueio("mapa_invalido", "O mapa de produtos da loja de teste está inválido.");
  const m = ctx.mapa.itens.get(chaveVar(produto.id, variacao.indice));
  if (!m) throw bloqueio("sem_mapeamento");
  if (m.precoCentavos !== variacao.centavos) throw bloqueio("preco_divergente");
  let it;
  try {
    it = localizarCodigo(ctx.catalogo, m.codigoHml, "item");
  } catch (e) {
    throw bloqueio(motivoDeConector(e));
  }
  if (it.centavos !== variacao.centavos) throw bloqueio("preco_divergente");
  if (it.tipoItem === "pizza" || it.calculo) throw bloqueio("calculo_nao_suportado");
  const pratos = ctx.catalogo.filter((l) => l && l.tipo === "PRATO" && l.codigo_saipos === it.codigo);
  const tamanhos = new Set(pratos.map((l) => l.tamanho ?? null));
  const tamanho = tamanhos.size === 1 ? [...tamanhos][0] : null;
  if (ctx.mapa.version === 2) {
    if (tamanho === null || tamanho !== variacao.nome) throw bloqueio("tamanho_diferente");
    if (pratos.some((l) => l.codigo_interno != null && l.codigo_interno !== `GAMA${produto.id}`)) throw bloqueio("item_de_outro_produto");
    if (new Set(pratos.map((l) => String(l.id_store_item))).size !== 1) throw bloqueio("item_ambiguo");
  }
  return { codigo: it.codigo, descricao: it.descricao, centavos: it.centavos, lojaItem: it.lojaItem, tamanho, produto: produto.id, variacao: variacao.indice };
}

// Complemento HML da opcao. v2: codigo composto (prefixo da variacao + id da opcao), chave produto+variacao+opcao,
// e so vale linha do MESMO id_store_item e MESMO tamanho. v1 (legado): so por opcao, mesmo item.
export function resolverOpcaoHml(ctx, itemHml, opcao, grupo) {
  const v2 = ctx.mapa.version === 2;
  const m = ctx.mapa.opcoes.get(v2 ? chaveOpc(itemHml.produto, itemHml.variacao, opcao.id) : opcao.id);
  if (!m) throw bloqueio("sem_mapeamento");
  if (m.precoCentavos !== opcao.centavos) throw bloqueio("preco_divergente");
  const linhas = ctx.catalogo.filter((l) => l && (l.tipo !== "COMPLEMENTO" || (String(l.id_store_item) === String(itemHml.lojaItem)
    && (!v2 || itemHml.tamanho == null || l.tamanho === itemHml.tamanho))));
  if (v2) {
    const sel = linhas.filter((l) => l.tipo === "COMPLEMENTO" && l.codigo_saipos === m.codigoHml);
    if (sel.length && new Set(sel.map((l) => String(l.id_store_choice))).size !== 1) throw bloqueio("grupo_ambiguo");
    if (sel.some((l) => l.complemento_item !== opcao.nome)) throw bloqueio("opcao_nome_diferente");
    if (sel.some((l) => l.complemento != null && l.complemento !== grupo.nome)) throw bloqueio("grupo_diferente");
  }
  let c;
  try {
    c = localizarCodigo(linhas, m.codigoHml, "complemento");
  } catch (e) {
    throw bloqueio(e?.codigo === "CODIGO_NAO_CONFIRMADO" ? "complemento_outro_item_ou_ausente" : motivoDeConector(e));
  }
  if (String(c.lojaItem) !== String(itemHml.lojaItem)) throw bloqueio("complemento_outro_item_ou_ausente");
  if (c.centavos !== opcao.centavos) throw bloqueio("preco_divergente");
  if (v2 ? (!Number.isInteger(c.min) || !Number.isInteger(c.max) || c.min !== grupo.minimo || c.max !== grupo.maximo)
    : ((Number.isInteger(c.min) && c.min !== grupo.minimo) || (Number.isInteger(c.max) && c.max !== grupo.maximo))) throw bloqueio("limites_diferentes");
  const mg = ctx.mapa.grupos.get(grupo.id);
  if (mg && String(c.grupo) !== String(mg.idStoreChoice)) throw bloqueio("grupo_diferente");
  return { codigo: c.codigo, descricao: c.descricao, centavos: c.centavos };
}

// ---------- visao para o front (sem codigos Saipos) ----------

export function montarVisao(ctx, data) {
  const { dto } = ctx;
  const produtos = dto.ordemProdutos.map((id) => {
    const p = dto.produtos.get(id);
    const motivo = motivoIndisponivel(dto, p, data);
    return {
      id: p.id, nome: p.nome, descricao: p.descricao ?? null, categoria: p.categoria, posicao: p.posicao,
      fotoLocal: p.fotoLocal ?? null,
      disponivelAgora: motivo === null, motivoIndisponivel: motivo,
      horarios: p.horarios, dias: p.dias,
      ocultarObservacao: p.ocultarObservacao, ocultarQuantidade: p.ocultarQuantidade,
      grupos: p.grupos.filter((g) => dto.grupos.get(g).ativo === 1),
      variacoes: p.variacoes.map((v) => {
        let pronto = false;
        let opcoesProntas = [];
        let motivoBloqueio = null;
        try {
          const item = resolverItemHml(ctx, p, v);
          pronto = true;
          for (const gid of p.grupos) {
            const g = dto.grupos.get(gid);
            if (g.ativo !== 1) continue;
            for (const o of dto.opcoes.values()) {
              if (o.adicional !== gid || o.ativo !== 1) continue;
              try { resolverOpcaoHml(ctx, item, o, g); opcoesProntas.push(o.id); } catch { /* opcao ainda nao pronta */ }
            }
          }
        } catch (e) {
          motivoBloqueio = e.motivo ?? "bloqueado";
        }
        return { indice: v.indice, nome: v.nome, centavos: v.centavos, pronto, opcoesProntas, motivoBloqueio };
      }),
    };
  });
  const gruposUsados = new Set(produtos.flatMap((p) => p.grupos));
  return {
    fonte: { consultadoEm: dto.consultadoEm, aviso: "Cardápio copiado do cadastro na data indicada; pode não refletir mudanças posteriores." },
    mapa: ctx.mapa.estado,
    agora: agoraSaoPaulo(data),
    limites: { maxItens: MAX_ITENS, maxQuantidade: MAX_QTD, maxObservacao: MAX_OBS },
    categorias: dto.ordemCategorias.map((id) => {
      const c = dto.categorias.get(id);
      return { id: c.id, nome: c.nome, posicao: c.posicao, horarios: c.horarios, dias: c.dias, ativo: c.ativo, visivel: c.visivel };
    }),
    produtos,
    grupos: [...gruposUsados].map((id) => {
      const g = dto.grupos.get(id);
      return { id: g.id, nome: g.nome, posicao: g.posicao, minimo: g.minimo, maximo: g.maximo, permitirQuantidade: g.permitir_quantidade === 1 };
    }),
    opcoes: [...dto.opcoes.values()].filter((o) => gruposUsados.has(o.adicional) && o.ativo === 1)
      .map((o) => ({ id: o.id, nome: o.nome, descricao: o.descricao ?? null, grupo: o.adicional, posicao: o.posicao, centavos: o.centavos })),
  };
}

// ---------- validacao do carrinho ----------

const bad = (mensagem, codigo = "carrinho_invalido") => new ErroCardapio(codigo, mensagem, { status: 400 });

function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (objeto(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
  return v;
}

// Hash do carrinho (tipo proprio: nao colide com o corpo legado do produto Diversos).
export function hashCarrinho(corpo) {
  const { idempotencyKey, ...resto } = corpo;
  return sha256Json({ tipo: "carrinho/1", corpo: ordenar(resto) });
}

function lerCorpo(corpo) {
  if (!objeto(corpo) || !SO(corpo, ["idempotencyKey", "itens"])) throw bad("Pedido com campos não permitidos.");
  if (!Array.isArray(corpo.itens) || corpo.itens.length < 1 || corpo.itens.length > MAX_ITENS) throw bad(`O carrinho precisa ter de 1 a ${MAX_ITENS} itens.`);
  return corpo.itens.map((it) => {
    if (!objeto(it) || !["produto", "variacao", "quantidade", "opcoes"].every((k) => k in it) || !Object.keys(it).every((k) => ["produto", "variacao", "quantidade", "opcoes", "obs"].includes(k))) throw bad("Item com campos não permitidos.");
    if (!idOk(it.produto) || !idOk(it.variacao)) throw bad("Item inválido.");
    if (!Number.isInteger(it.quantidade) || it.quantidade < 1 || it.quantidade > MAX_QTD) throw bad(`Quantidade deve ser de 1 a ${MAX_QTD}.`);
    if (it.obs !== undefined && (typeof it.obs !== "string" || it.obs.length > MAX_OBS || /[\u0000-\u001f\u007f]/.test(it.obs))) throw bad("Observação inválida.");
    if (!Array.isArray(it.opcoes) || it.opcoes.length > MAX_COMPLEMENTOS_POR_ITEM) throw bad("Opções inválidas.");
    const vistos = new Set();
    for (const o of it.opcoes) {
      if (!objeto(o) || !SO(o, ["opcao", "quantidade"]) || !idOk(o.opcao)) throw bad("Opção inválida.");
      if (!Number.isInteger(o.quantidade) || o.quantidade < 1 || o.quantidade > MAX_QTD) throw bad("Quantidade da opção inválida.");
      if (vistos.has(o.opcao)) throw bad("Opção repetida no mesmo item.");
      vistos.add(o.opcao);
    }
    return it;
  });
}

// Retorna { itensHml, totalCentavos, resumo }. Tudo calculado aqui; nada vem pronto do cliente.
// Lanca ErroCardapio ANTES de qualquer reserva/auth/prepare/ledger/contador.
export function validarCarrinho(ctx, corpo, data) {
  const itens = lerCorpo(corpo);
  const { dto } = ctx;
  let total = 0;
  const itensHml = [];
  const resumoItens = [];
  for (const it of itens) {
    const p = dto.produtos.get(it.produto);
    if (!p) throw bad("Produto desconhecido.");
    const variacao = p.variacoes.find((v) => v.indice === it.variacao);
    if (!variacao) throw bad("Variação desconhecida.");
    const motivo = motivoIndisponivel(dto, p, data);
    if (motivo === "fora_do_horario") throw new ErroCardapio("fora_do_horario", `"${p.nome}" está fora do horário de venda.`, { status: 409, motivo });
    if (motivo) throw new ErroCardapio("indisponivel", `"${p.nome}" não está disponível.`, { status: 409, motivo });
    if (p.ocultarQuantidade && it.quantidade !== 1) throw bad("Este produto só aceita 1 unidade.");
    if (p.ocultarObservacao && it.obs) throw bad("Este produto não aceita observação.");

    // opcoes: so de grupos ATIVOS do produto; grupo inativo e ignorado (nao exige min nem aceita escolha)
    const gruposAtivos = p.grupos.map((g) => dto.grupos.get(g)).filter((g) => g.ativo === 1);
    const escolhas = it.opcoes.map((o) => {
      const op = dto.opcoes.get(o.opcao);
      if (!op) throw bad("Opção desconhecida.");
      const g = gruposAtivos.find((x) => x.id === op.adicional);
      if (!g) throw bad("Opção não pertence a um grupo ativo deste produto.");
      if (op.ativo !== 1) throw bad("Opção inativa.");
      if (o.quantidade > 1 && g.permitir_quantidade !== 1) throw bad("Este grupo não permite quantidade maior que 1.");
      return { op, g, quantidade: o.quantidade };
    });
    for (const g of gruposAtivos) {
      const soma = escolhas.filter((e) => e.g.id === g.id).reduce((s, e) => s + e.quantidade, 0);
      if (soma < g.minimo) throw bad(`Escolha pelo menos ${g.minimo} em "${g.nome}".`);
      if (soma > g.maximo) throw bad(`Escolha no máximo ${g.maximo} em "${g.nome}".`);
    }
    // ordem deterministica: grupos do produto, depois ordem do cadastro de opcoes
    const ordemOpcoes = [...dto.opcoes.keys()];
    escolhas.sort((a, b) => p.grupos.indexOf(a.g.id) - p.grupos.indexOf(b.g.id) || ordemOpcoes.indexOf(a.op.id) - ordemOpcoes.indexOf(b.op.id));

    // ligacao com o catalogo HML (mapa obrigatorio, estrito)
    const itemHml = resolverItemHml(ctx, p, variacao);
    const complementos = escolhas.map((e) => {
      const c = resolverOpcaoHml(ctx, itemHml, e.op, e.g);
      return { codigo: c.codigo, descricao: c.descricao, centavos: c.centavos, quantidade: e.quantidade };
    });
    const linha = totalItemCentavos(variacao.centavos, complementos, it.quantidade);
    total += linha;
    if (!Number.isSafeInteger(total) || total > MAX_TOTAL_CENTAVOS) throw bad("Total acima do limite do ensaio.", "total_fora_do_limite");
    itensHml.push({ codigo: itemHml.codigo, descricao: itemHml.descricao, centavos: itemHml.centavos, quantidade: it.quantidade, nota: it.obs ? it.obs : "", complementos });
    resumoItens.push({ nome: p.nome, variacao: variacao.nome, quantidade: it.quantidade, opcoes: escolhas.map((e) => ({ nome: e.op.nome, quantidade: e.quantidade })), centavos: linha });
  }
  return { itensHml, totalCentavos: total, resumo: { itens: resumoItens, totalCentavos: total } };
}
