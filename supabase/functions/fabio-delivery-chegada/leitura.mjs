// fabio-delivery-chegada — módulo PURO (sem Deno; fetch, relógio, limitador e leitura privada entram por injeção).
// Só LEITURA. Autentica EXCLUSIVAMENTE o JWT do ERP (rtmgzsikwglsvpopbfbw) via GET /auth/v1/user e confere permissões por RPC
// do ERP ANTES de qualquer leitura privada. A leitura privada (lerConsulta) roda no projeto antigo por conexão direta.
// Nada de user_metadata, e-mail, "quem", payload bruto ou segredo na resposta, em erro ou em log.

const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export class ErroLeitura extends Error {
  constructor(codigo, status) { super(codigo); this.name = 'ErroLeitura'; this.codigo = codigo; this.status = status; }
}

export const FONTE = 'Chegada motoboys — leitura nativa';
// ERP novo: URL e chave PÚBLICA (anon) copiadas de nucleo/nucleo.js. Não é segredo; service_role nunca entra aqui.
export const ERP_URL = 'https://rtmgzsikwglsvpopbfbw.supabase.co';
export const ERP_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0bWd6c2lrd2dsc3Zwb3BiZmJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NDgwMjcsImV4cCI6MjEwMTQyNDAyN30.-vwbQkcuAbbonmBVCeUWXjTg54uB5MNN94QmMlBxTA4';
export const ORIGEM = 'https://cidadaodomundo-erp.github.io';
export const LOJAS = Object.freeze(['AGUA VERDE', 'SAO BRAZ', 'AHU']);   // ordem fixa de saída
export const MODULO = 'delivery';
export const JANELA_DIAS = 60;      // dia operacional atual e os 60 anteriores
export const VIRADA_MIN = 300;      // dia operacional vira às 05:00 (Brasília)
export const TIMEOUT_MS = 8000;
export const MAX_LINHAS = 500;

// ---------- texto / unidades ----------
export function normalizar(s) {
  return typeof s === 'string' ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim() : '';
}
export function textoSeguro(s, max) {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
export function unidadeCanonica(u) {
  const n = normalizar(u);
  if (n === 'REDE') return 'REDE';
  return LOJAS.includes(n) ? n : null;
}

// ---------- calendário (UTC puro + Intl para Brasília) ----------
const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function dataValida(s) {
  if (typeof s !== 'string') return false;
  const m = DATA_RE.exec(s); if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3]; if (y < 2000) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
const diasDe = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const deDias = (z) => new Date(z * 86400000).toISOString().slice(0, 10);
export function brtAgora(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return { data: g('year') + '-' + g('month') + '-' + g('day'), min: Number(g('hour')) * 60 + Number(g('minute')) };
}
export function diaOperacional(ms) {
  const b = brtAgora(ms);
  return b.min < VIRADA_MIN ? deDias(diasDe(b.data) - 1) : b.data;
}
export function validarDia(dia, op) {
  if (!dataValida(dia)) throw new ErroLeitura('dia_invalido', 400);
  const d = diasDe(dia), h = diasDe(op);
  if (d > h) throw new ErroLeitura('dia_futuro', 400);
  if (d < h - JANELA_DIAS) throw new ErroLeitura('dia_fora_da_janela', 400);
  return dia;
}

// ---------- rede com timeout ----------
export async function comTimeout(fetchImpl, url, init, ms) {
  const ac = new AbortController(); const h = setTimeout(() => ac.abort(), ms);
  try { return await fetchImpl(url, Object.assign({}, init, { signal: ac.signal })); }
  finally { clearTimeout(h); }
}

// ---------- autenticação (somente ERP) ----------
export function extrairJwt(h) {
  const m = typeof h === 'string' ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  return m && m[1].length <= 4096 && /^[\w-]+\.[\w-]+\.[\w-]*$/.test(m[1]) ? m[1] : null;
}
export async function autenticar(c, jwt) {
  let r;
  try { r = await comTimeout(c.fetchImpl, c.erpUrl + '/auth/v1/user', { method: 'GET', headers: { apikey: c.anonKey, Authorization: 'Bearer ' + jwt } }, c.timeoutMs); }
  catch (e) { throw new ErroLeitura('auth_indisponivel', 502); }
  if (r.status === 401 || r.status === 403) throw new ErroLeitura('nao_autenticado', 401);
  if (!r.ok) throw new ErroLeitura('auth_indisponivel', 502);
  let j; try { j = await r.json(); } catch (e) { throw new ErroLeitura('auth_indisponivel', 502); }
  if (!ehObj(j) || typeof j.id !== 'string' || !j.id) throw new ErroLeitura('nao_autenticado', 401);
  return j.id;   // só o id (limitador). user_metadata/e-mail são ignorados de propósito.
}

// limite por usuário validado: janela fixa, memória limitada, nunca guarda resposta
export function criarLimitador({ max = 12, janelaMs = 60000, agora = Date.now, maxUsuarios = 1000 } = {}) {
  const m = new Map();
  return {
    tamanho: () => m.size,
    permitir(id) {
      const t = agora();
      for (const [k, e] of m) if (t - e.ini >= janelaMs) m.delete(k);
      let e = m.get(id);
      if (!e) { if (m.size >= maxUsuarios) m.delete(m.keys().next().value); e = { ini: t, n: 0 }; m.set(id, e); }
      e.n++;
      return e.n <= max;
    },
  };
}

// ---------- permissões (RPC do ERP sob o JWT do chamador) ----------
async function rpc(c, jwt, fn) {
  let r;
  try {
    r = await comTimeout(c.fetchImpl, c.erpUrl + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: { apikey: c.anonKey, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}',
    }, c.timeoutMs);
  } catch (e) { throw new ErroLeitura('rpc_indisponivel', 502); }
  if (r.status === 401) throw new ErroLeitura('nao_autenticado', 401);
  if (!r.ok) throw new ErroLeitura('rpc_indisponivel', 502);           // erro NUNCA vira null nem permissão
  try { return await r.json(); } catch (e) { throw new ErroLeitura('rpc_formato', 502); }
}
const FORMATO_RPC = () => new ErroLeitura('rpc_formato', 502);
const simNao = (v) => { if (v === true) return true; if (v === false || v === null) return false; throw FORMATO_RPC(); };

// Fase 1 (consulta detalhada): (eh_dono OU pode_ver_pessoal) E (meus_modulos null OU inclui 'delivery').
// painel_minhas_lojas RETURNS TABLE(lojas text[], loja_inicial, travado) => array de exatamente 1 linha.
export async function exigirPermissoes(c, jwt) {
  const [dono, ver, modulos, painel] = await Promise.all(['eh_dono', 'pode_ver_pessoal', 'meus_modulos', 'painel_minhas_lojas'].map((f) => rpc(c, jwt, f)));
  const ehDono = simNao(dono), podeVer = simNao(ver);
  let moduloOk;
  if (modulos === null) moduloOk = true;   // padrão da casca: null = sem restrição de módulo
  else if (Array.isArray(modulos) && modulos.every((m) => typeof m === 'string')) moduloOk = modulos.some((m) => m.trim().toLowerCase() === MODULO);
  else throw FORMATO_RPC();
  if (!Array.isArray(painel) || painel.length > 1) throw FORMATO_RPC();
  if (painel.length === 1 && (!ehObj(painel[0]) || !Array.isArray(painel[0].lojas) || !painel[0].lojas.every((l) => typeof l === 'string'))) throw FORMATO_RPC();
  if (!(ehDono || podeVer)) throw new ErroLeitura('sem_permissao', 403);   // restrito sem pessoal: negado (privacidade do balcão)
  if (!moduloOk) throw new ErroLeitura('sem_modulo', 403);
  if (painel.length === 0) throw new ErroLeitura('sem_lojas', 403);
  return painel[0].lojas;
}
// REDE só se a lista do chamador tiver REDE; expande apenas para as lojas reais que estão na lista
export function unidadesPermitidas(pedida, lojas) {
  const lista = lojas.map(unidadeCanonica).filter(Boolean);
  const reais = LOJAS.filter((u) => lista.includes(u));
  if (pedida === 'REDE') { if (!lista.includes('REDE') || !reais.length) throw new ErroLeitura('sem_permissao', 403); return reais; }
  if (!reais.includes(pedida)) throw new ErroLeitura('sem_permissao', 403);
  return [pedida];
}

// ---------- projeção estrita (allowlist) — espelha fabio_delivery.chegada_consulta (docs/chegada-instalacao.sql) ----------
// HH:MM ou HH:MM:SS; segundos PRESERVADOS quando presentes (fila e saída QR vêm com segundos); fração descartada.
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/;
export const hmDe = (v) => { const m = typeof v === 'string' ? HM_RE.exec(v) : null; return m ? m[1] + ':' + m[2] + (m[3] !== undefined ? ':' + m[3] : '') : null; };
export function instante(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) || !/(Z|[+-]\d{2}(:?\d{2})?)$/.test(v)) return null;
  const s = v.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const minDe = (v) => (Number.isInteger(v) && v >= 0 && v <= 1440 ? v : null);
const atrasoDe = (v) => (Number.isInteger(v) && v >= -1440 && v <= 1440 ? v : null);
const nTurnoDe = (v) => (Number.isInteger(v) && v >= 0 && v <= 99 ? v : null);
const boolDe = (v) => (typeof v === 'boolean' ? v : null);   // só boolean JSON; 'true'/'false'/1/0 são inválidos
const textoDe = (max) => (v) => (typeof v === 'string' ? (textoSeguro(v, max) || null) : null);
const enumDe = (lista) => (v) => (typeof v === 'string' && lista.includes(v) ? v : null);
const campo = (ctx, v, f) => { if (v === null || v === undefined) return null; const r = f(v); if (r === null) ctx.invalidos++; return r; };

// enums da fonte real (public.chegada_direito e chegada_consulta)
export const DIREITOS = Object.freeze(['ok', 'perdeu', 'rango_excecao', 'sem_prova', 'no_prazo', 'nao_chegou', 'fora']);
export const MOTIVOS_SEM_PROVA = Object.freeze(['nome', 'gps', 'robo', 'balcao']);
export const FONTES_CHEGADA = Object.freeze(['fila', 'patio_gps']);   // única chegada real; 1ª entrega fica em campo próprio
const FORMATO_DB = () => new ErroLeitura('consulta_formato', 502);

export function projetarLinha(x, un, ctx) {
  if (!ehObj(x)) throw FORMATO_DB();
  if (unidadeCanonica(x.unidade) !== un) throw new ErroLeitura('linha_de_outra_loja', 502);
  const motoboy = textoSeguro(x.motoboy, 80); if (!motoboy) throw FORMATO_DB();
  const n_turno = nTurnoDe(x.n_turno); if (n_turno === null) throw FORMATO_DB();   // obrigatório por linha

  const fila = campo(ctx, x.chegada_fila_txt, hmDe);
  const patio = campo(ctx, x.patio_gps_txt, hmDe);
  const fonte = campo(ctx, x.chegou_fonte, enumDe(FONTES_CHEGADA));
  const chegouBruto = campo(ctx, x.chegou_txt, hmDe);
  if (chegouBruto !== null && fonte === null) ctx.invalidos++;          // chegada sem fonte real não é exibida
  const saida = campo(ctx, x.saida_registrada_txt, hmDe);
  const tempoFonte = campo(ctx, x.tempo_fonte, enumDe(FONTES_CHEGADA));
  const tempo = campo(ctx, x.tempo_registrado_min, minDe);
  // tempo só com saída QR + início real (fila ou pátio GPS) presente na própria linha; anotado/1ª entrega não sustentam
  const inicio = tempoFonte === 'fila' ? fila : tempoFonte === 'patio_gps' ? patio : null;
  const tempoOk = tempo !== null && saida !== null && inicio !== null;

  return {
    unidade: un,
    motoboy,
    n_turno,
    na_escala: campo(ctx, x.na_escala, boolDe),
    vivo_rodando: campo(ctx, x.vivo_rodando, boolDe),
    escala_txt: campo(ctx, x.escala_txt, hmDe),
    escala_saida_txt: campo(ctx, x.escala_saida_txt, hmDe),
    limite_txt: campo(ctx, x.limite_txt, hmDe),
    chegada_fila_txt: fila,
    chegada_fila_em: campo(ctx, x.chegada_fila_em, instante),
    patio_gps_txt: patio,
    anotado_txt: campo(ctx, x.anotado_txt, hmDe),
    chegou_txt: fonte ? chegouBruto : null,
    chegou_fonte: fonte && chegouBruto ? fonte : null,
    primeira_entrega_txt: campo(ctx, x.primeira_entrega_txt, hmDe),   // evidência separada; NÃO é chegada
    saida_registrada_txt: saida,
    tempo_registrado_min: tempoOk ? tempo : null,
    tempo_fonte: tempoOk ? tempoFonte : null,
    // regra herdada de public.chegada_direito: validada, nunca recalculada
    direito: campo(ctx, x.direito, enumDe(DIREITOS)),
    garantido_perdido: campo(ctx, x.garantido_perdido, boolDe),
    motivo_sem_prova: campo(ctx, x.motivo_sem_prova, enumDe(MOTIVOS_SEM_PROVA)),
    atraso_min: campo(ctx, x.atraso_min, atrasoDe),
    // escolha manual da equipe, separada por direito (null = segue a regra)
    garantido_manual: campo(ctx, x.garantido_manual, boolDe),
    garantido_motivo: campo(ctx, x.garantido_motivo, textoDe(120)),
    rango_manual: campo(ctx, x.rango_manual, boolDe),
    rango_motivo: campo(ctx, x.rango_motivo, textoDe(120)),
  };
}
// robô: sem leitura => atualizado_em null e ok null (desconhecido; não autoriza afirmar "não chegou")
function projetarRobo(r, ctx) {
  if (r === null || r === undefined) return { atualizado_em: null, ok: null };
  if (!ehObj(r)) { ctx.invalidos++; return { atualizado_em: null, ok: null }; }
  const atualizado_em = campo(ctx, r.atualizado_em, instante);
  const ok = campo(ctx, r.ok, boolDe);
  return { atualizado_em, ok: atualizado_em ? ok : null };
}
export function projetarUnidade(raw, un, dia) {
  if (!ehObj(raw) || raw.dia !== dia || !dataValida(raw.hoje) || typeof raw.ao_vivo !== 'boolean' || !Array.isArray(raw.linhas) || raw.linhas.length > MAX_LINHAS) throw FORMATO_DB();
  if (unidadeCanonica(raw.unidade) !== un) throw new ErroLeitura('linha_de_outra_loja', 502);
  const consultado = instante(raw.consultado_em); if (!consultado) throw FORMATO_DB();
  const ctx = { invalidos: 0 };
  const linhas = raw.linhas.map((l) => projetarLinha(l, un, ctx));
  return { unidade: un, status: 'ok', hoje: raw.hoje, ao_vivo: raw.ao_vivo, consultado_em: consultado, robo: projetarRobo(raw.robo, ctx), campos_invalidos: ctx.invalidos, linhas };
}
const indisponivel = (un) => ({ unidade: un, status: 'indisponivel', hoje: null, ao_vivo: null, consultado_em: null, robo: null, campos_invalidos: 0, linhas: null });

// ---------- CORS ----------
export const origemPermitida = (o) => !o || o === ORIGEM;   // sem Origin = chamada de servidor (ainda exige JWT do ERP)
export function corsHeaders(o) {
  const h = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store, private', Vary: 'Origin, Authorization', 'X-Content-Type-Options': 'nosniff',
  };
  if (o === ORIGEM) h['Access-Control-Allow-Origin'] = ORIGEM;
  return h;
}

// ---------- orquestração ----------
/** c: { metodo, origem, authorization, query:{dia,unidade}, fetchImpl, lerConsulta(dia, unidades[]) -> [{unidade, ok, valor}],
 *       agora, limitador, timeoutMs?, erpUrl?, anonKey? } -> { status, corpo }. Erros: só { erro: codigo }. */
export async function responder(c) {
  try { return await executar(c); }
  catch (e) { return e instanceof ErroLeitura ? { status: e.status, corpo: { erro: e.codigo } } : { status: 500, corpo: { erro: 'interno' } }; }
}
async function executar(c) {
  if (!origemPermitida(c.origem)) throw new ErroLeitura('origem_nao_permitida', 403);
  if (c.metodo === 'OPTIONS') return { status: 204, corpo: null };
  if (c.metodo !== 'GET') throw new ErroLeitura('metodo_nao_permitido', 405);
  const jwt = extrairJwt(c.authorization); if (!jwt) throw new ErroLeitura('nao_autenticado', 401);
  if (typeof c.fetchImpl !== 'function' || typeof c.lerConsulta !== 'function') throw new ErroLeitura('config_indisponivel', 500);
  const base = { fetchImpl: c.fetchImpl, erpUrl: c.erpUrl || ERP_URL, anonKey: c.anonKey || ERP_ANON_KEY, timeoutMs: c.timeoutMs || TIMEOUT_MS };

  const userId = await autenticar(base, jwt);                                   // (1) sempre antes de tudo que é privado
  if (c.limitador && !c.limitador.permitir(userId)) throw new ErroLeitura('limite_de_chamadas', 429);
  const q = ehObj(c.query) ? c.query : {};
  const pedida = unidadeCanonica(q.unidade); if (!pedida) throw new ErroLeitura('unidade_invalida', 400);
  const op = diaOperacional((c.agora || Date.now)());
  const dia = validarDia(q.dia, op);
  const lojas = await exigirPermissoes(base, jwt);                               // (2) permissão
  const unidades = unidadesPermitidas(pedida, lojas);                            // (3) escopo de lojas

  let brutos;                                                                    // (4) só agora o banco privado
  try { brutos = await c.lerConsulta(dia, unidades.slice()); } catch (e) { throw new ErroLeitura('consulta_indisponivel', 502); }
  if (!Array.isArray(brutos)) throw new ErroLeitura('consulta_indisponivel', 502);
  const por_unidade = unidades.map((un) => {
    const b = brutos.filter((x) => ehObj(x) && x.unidade === un);
    if (b.length !== 1 || b[0].ok !== true) return indisponivel(un);
    try { return projetarUnidade(b[0].valor, un, dia); } catch (e) { return indisponivel(un); }   // falha = indisponível, nunca lista vazia
  });
  if (!por_unidade.some((p) => p.status === 'ok')) throw new ErroLeitura('consulta_indisponivel', 502);
  return { status: 200, corpo: { fonte: FONTE, dia, dia_operacional: op, unidade: pedida, unidades, por_unidade } };
}
