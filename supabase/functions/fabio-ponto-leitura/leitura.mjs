// fabio-ponto-leitura — módulo PURO (sem Deno, sem rede própria: fetch, relógio, cache e leitura privada entram por injeção).
// Só LEITURA. Nada é gravado em lugar nenhum. Chave do Flash e dados privados nunca vão para resposta, log ou erro.
// Contrato de saída: pessoas (mínimo), batidas {data,flash_id,entrada,saida,n_batidas,horarios,lido_em}, refeições por pessoa.
// Sem PIS/documento/payload do Flash; sem observação/cliente/identificador técnico do Saipos.

const ehObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export class ErroLeitura extends Error {
  constructor(codigo, status) { super(codigo); this.name = 'ErroLeitura'; this.codigo = codigo; this.status = status; }
}

export const FONTE = 'Flash — leitura direta';
export const EMPRESAS = Object.freeze({ 'AGUA VERDE': 'rqnYiy_xbQ_tEHSWtt8Xo', 'SAO BRAZ': 'u7u6gvHUmX6DcouyfNIir', 'AHU': 'dJDYVezbaM-6JxDuDK4aP' });
export const FLASH_URL = 'https://api.flashapp.services/time-and-attendance/v1/attendance/day';
export const JANELA_DIAS = 7;            // dia pedido: hoje e os 6 anteriores
export const LIMITE_VIRADA_MIN = 360;    // até 06:00 (Brasília) inclui o dia anterior para a madrugada
export const TTL_CACHE_MS = 60000;

// ---------- texto ----------
export function normalizar(s) {
  return typeof s === 'string' ? s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim() : '';
}
const tokens = (s) => normalizar(s).replace(/[^A-Z0-9]+/g, ' ').trim();
export function textoSeguro(s, max) {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

// ---------- unidades ----------
export function unidadeCanonica(u) {
  const n = normalizar(u);
  if (n === 'REDE') return 'REDE';
  return Object.hasOwn(EMPRESAS, n) ? n : null;
}
export const variantesUnidade = (canon) => (canon === 'SAO BRAZ' ? ['SAO BRAZ', 'SÃO BRAZ'] : [canon]);

// ---------- calendário (UTC puro; sem fuso do servidor) ----------
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
export const diaSeguinte = (s) => deDias(diasDe(s) + 1);
export const diaAnterior = (s) => deDias(diasDe(s) - 1);
export function brtAgora(ms) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const g = (t) => p.find((x) => x.type === t).value;
  return { data: g('year') + '-' + g('month') + '-' + g('day'), min: Number(g('hour')) * 60 + Number(g('minute')) };
}
const BRT_HM = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
// hora_venda: só HH:MM[:SS], timestamp sem fuso, ou timestamp com fuso (convertido para Brasília). Qualquer outra coisa => null.
export function horaDe(v) {
  if (typeof v !== 'string') return null;
  let m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(v); if (m) return m[1] + ':' + m[2];
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return null;
  if (/(Z|[+-]\d{2}(:?\d{2})?)$/.test(v)) {
    let s = v.replace(' ', 'T');
    s = s.replace(/([+-]\d{2})$/, '$1:00').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const d = new Date(s); if (Number.isNaN(d.getTime())) return null;
    return BRT_HM.format(d);
  }
  m = /^\d{4}-\d{2}-\d{2}[T ]([01]\d|2[0-3]):([0-5]\d)/.exec(v); return m ? m[1] + ':' + m[2] : null;
}

// ---------- rede com timeout ----------
export async function comTimeout(fetchImpl, url, init, ms) {
  const ac = new AbortController(); const h = setTimeout(() => ac.abort(), ms);
  try { return await fetchImpl(url, Object.assign({}, init, { signal: ac.signal })); }
  finally { clearTimeout(h); }
}
// leitura REST paginada sob o JWT do chamador (RLS vale). Truncar = erro (nunca lista parcial como completa).
export async function paginar(c, caminho) {
  const { fetchImpl, supabaseUrl, headers, timeoutMs, pageSize, maxPaginas } = c;
  const todas = [];
  for (let p = 0; p < maxPaginas; p++) {
    let r;
    try { r = await comTimeout(fetchImpl, supabaseUrl + '/rest/v1/' + caminho + '&limit=' + pageSize + '&offset=' + (p * pageSize), { headers }, timeoutMs); }
    catch (e) { throw new ErroLeitura('rest_indisponivel', 502); }
    if (r.status === 401) throw new ErroLeitura('nao_autenticado', 401);
    if (!r.ok) throw new ErroLeitura('rest_indisponivel', 502);
    let j; try { j = await r.json(); } catch (e) { throw new ErroLeitura('rest_formato', 502); }
    if (!Array.isArray(j)) throw new ErroLeitura('rest_formato', 502);
    for (const x of j) todas.push(x);
    if (j.length < pageSize) return todas;
  }
  throw new ErroLeitura('rest_truncado', 502);
}

// ---------- autenticação / permissões ----------
export function extrairJwt(h) {
  const m = typeof h === 'string' ? /^Bearer\s+(\S+)$/i.exec(h) : null;
  return m && m[1].length <= 4096 && /^[\w-]+\.[\w-]+\.[\w-]*$/.test(m[1]) ? m[1] : null;
}
export async function autenticar(c, jwt) {
  let r;
  try { r = await comTimeout(c.fetchImpl, c.supabaseUrl + '/auth/v1/user', { headers: { apikey: c.anonKey, Authorization: 'Bearer ' + jwt } }, c.timeoutMs); }
  catch (e) { throw new ErroLeitura('auth_indisponivel', 502); }
  if (r.status === 401 || r.status === 403) throw new ErroLeitura('nao_autenticado', 401);
  if (!r.ok) throw new ErroLeitura('auth_indisponivel', 502);
  let j; try { j = await r.json(); } catch (e) { throw new ErroLeitura('auth_indisponivel', 502); }
  if (!ehObj(j) || typeof j.id !== 'string' || !j.id) throw new ErroLeitura('nao_autenticado', 401);
  return j.id;   // só o id (usado no limitador); e-mail e metadados não saem daqui
}
// limite conservador por USUÁRIO validado (auth user.id): janela fixa, memória limitada, nunca guarda resposta
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
async function rpc(c, headers, fn) {
  let r;
  try { r = await comTimeout(c.fetchImpl, c.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: '{}' }, c.timeoutMs); }
  catch (e) { throw new ErroLeitura('rpc_indisponivel', 502); }
  if (r.status === 401) throw new ErroLeitura('nao_autenticado', 401);
  if (!r.ok) throw new ErroLeitura('rpc_indisponivel', 502);
  try { return await r.json(); } catch (e) { throw new ErroLeitura('rpc_formato', 502); }
}
// exige pode_ver_pessoal === true E pode_cadastrar_pessoal === true; devolve o painel de lojas
export async function exigirPermissoes(c, headers) {
  const [ver, cad, painel] = await Promise.all([rpc(c, headers, 'pode_ver_pessoal'), rpc(c, headers, 'pode_cadastrar_pessoal'), rpc(c, headers, 'painel_minhas_lojas')]);
  if (ver !== true || cad !== true) throw new ErroLeitura('sem_permissao', 403);
  // painel_minhas_lojas() RETURNS TABLE(lojas text[], loja_inicial text, travado boolean) => o PostgREST devolve ARRAY de 1 linha.
  // Aceita exatamente 1 elemento objeto válido (ou, por compatibilidade, o próprio objeto válido); 0, 2+ ou tipo errado = 403.
  const linha = Array.isArray(painel) ? (painel.length === 1 ? painel[0] : null) : painel;
  if (!ehObj(linha) || !Array.isArray(linha.lojas) || !linha.lojas.every((l) => typeof l === 'string')) throw new ErroLeitura('sem_permissao', 403);
  return linha;
}
// unidade pedida precisa estar na lista do chamador; REDE só se a lista tiver REDE (e expande para as lojas reais da lista)
export function unidadesPermitidas(unidade, painel) {
  const canon = unidadeCanonica(unidade); if (!canon) throw new ErroLeitura('unidade_invalida', 400);
  const lista = (painel.lojas || []).map(unidadeCanonica).filter(Boolean);
  const reais = [...new Set(lista.filter((u) => u !== 'REDE'))];
  if (canon === 'REDE') { if (!lista.includes('REDE') || !reais.length) throw new ErroLeitura('sem_permissao', 403); return reais; }
  if (!reais.includes(canon)) throw new ErroLeitura('sem_permissao', 403);
  return [canon];
}
export function validarDia(dia, hoje) {
  if (!dataValida(dia)) throw new ErroLeitura('dia_invalido', 400);
  const d = diasDe(dia), h = diasDe(hoje);
  if (d > h || d < h - (JANELA_DIAS - 1)) throw new ErroLeitura('dia_fora_da_janela', 400);
  return dia;
}

// ---------- Flash ----------
const TS_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
function lerTime(t) {
  if (typeof t !== 'string') return null;
  const m = TS_RE.exec(t); if (!m || !dataValida(m[1]) || +m[2] > 23 || +m[3] > 59 || +m[4] > 59) return null;
  return { dia: m[1], hms: m[2] + ':' + m[3] + ':' + m[4] };
}
// Converte a resposta do Flash (só employeeId + attendances[].time/followingDay são usados) em horários 'YYYY-MM-DDTHH:MM:SS' (sem fuso).
// followingDay=true soma 1 dia SOMENTE se o time ainda traz a data do dia consultado. Funcionário com qualquer batida ilegível,
// fora de {dia, dia+1} ou com id repetido é DESCARTADO (e contado) — nunca meia lista.
export function converterDia(json, dia) {
  if (!ehObj(json) || !Array.isArray(json.data)) throw new ErroLeitura('flash_formato', 502);
  const prox = diaSeguinte(dia), porId = new Map(), desc = { invalidos: 0, duplicados: 0, foraDoDia: 0, naoAprovadas: 0 };
  for (const it of json.data) {
    if (!ehObj(it)) { desc.invalidos++; continue; }
    const id = typeof it.employeeId === 'string' && it.employeeId.trim() ? it.employeeId : (Number.isSafeInteger(it.employeeId) ? String(it.employeeId) : null);
    if (!id || !Array.isArray(it.attendances)) { desc.invalidos++; continue; }
    if (typeof it.date === 'string' && it.date.slice(0, 10) !== dia) { desc.foraDoDia++; continue; }
    if (porId.has(id)) { porId.get(id).repetido = true; continue; }
    let ok = true, nao = 0; const hs = [];
    for (const a of it.attendances) {
      const t = ehObj(a) ? lerTime(a.time) : null;
      if (!t) { ok = false; break; }
      let d = t.dia; if (a.followingDay === true && d === dia) d = prox;
      if (d !== dia && d !== prox) { ok = false; break; }
      if (a.approvalStatus !== 'Approved') nao++;
      hs.push(d + 'T' + t.hms);
    }
    porId.set(id, { id, ok, nao, hs: hs.sort(), repetido: false });
  }
  const funcionarios = [];
  for (const e of porId.values()) {
    if (e.repetido) { desc.duplicados++; continue; }
    if (!e.ok) { desc.invalidos++; continue; }
    desc.naoAprovadas += e.nao;
    funcionarios.push({ flash_id: e.id, horarios: e.hs });
  }
  funcionarios.sort((a, b) => (a.flash_id < b.flash_id ? -1 : 1));
  return { funcionarios, descartes: desc };
}
export async function lerFlashDia(c, empresaId, dia, chave) {
  let r;
  try { r = await comTimeout(c.fetchImpl, FLASH_URL + '?date=' + dia + '&companyId=' + encodeURIComponent(empresaId), { headers: { 'x-flash-auth': chave, Accept: 'application/json' } }, c.timeoutMs); }
  catch (e) { throw new ErroLeitura('flash_indisponivel', 502); }
  if (!r.ok) throw new ErroLeitura('flash_indisponivel', 502);
  let j; try { j = await r.json(); } catch (e) { throw new ErroLeitura('flash_formato', 502); }
  return converterDia(j, dia);
}
// só quem tem cadastro (flash_id permitido) e pelo menos 1 batida sai daqui; n=1 => saida null; n>=2 => saida = última
// janela do dia operacional (regra do antigo): [07:00 do dia, 03:00 do dia seguinte); 03:00 em ponto já é fora
export const janelaOperacional = (dia) => ({ de: dia + 'T07:00:00', ate: diaSeguinte(dia) + 'T03:00:00' });
export function montarBatidas(funcionarios, permitidos, dia, lidoEm) {
  const linhas = []; const j = janelaOperacional(dia); let semCadastro = 0, foraJanela = 0;
  for (const f of funcionarios) {
    const hs = f.horarios.filter((h) => h >= j.de && h < j.ate); foraJanela += f.horarios.length - hs.length;
    if (!hs.length) continue;
    if (!permitidos.has(f.flash_id)) { semCadastro++; continue; }
    const n = hs.length;
    linhas.push({ data: dia, flash_id: f.flash_id, entrada: hs[0], saida: n >= 2 ? hs[n - 1] : null, n_batidas: n, horarios: hs, lido_em: lidoEm });
  }
  return { linhas, semCadastro, foraJanela };
}
export const diaOperacionalDe = (b) => (b.min < 420 ? diaAnterior(b.data) : b.data);   // b = brtAgora(ms): antes das 07:00 é ontem

// ---------- jornada cadastral (retrato privado conferido; NÃO é escala diária) ----------
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
// frescor: conferido_em contra o dia CIVIL de agora (BRT), 0..7 dias; às 04h civil 12/ op 11/ conferida 12 vale
export function construirJornadas({ jornadas, pessoas, hojeCivil, comBatida }) {
  const avisos = [], nomes = new Map();
  for (const p of pessoas) { const un = unidadeCanonica(p.unidade); if (un && un !== 'REDE') { const k = normalizar(p.nome) + '|' + un; nomes.set(k, (nomes.get(k) || []).concat(p.id)); } }
  const grupos = new Map(); let invalidas = 0, vencidas = 0, conflitos = 0, semPessoa = 0;
  for (const x of Array.isArray(jornadas) ? jornadas : []) {
    const un = ehObj(x) ? unidadeCanonica(x.unidade) : null;
    const e = ehObj(x) && typeof x.entrada === 'string' ? HM_RE.exec(x.entrada) : null, s = ehObj(x) && typeof x.saida === 'string' ? HM_RE.exec(x.saida) : null;
    if (!un || un === 'REDE' || typeof x.nome !== 'string' || !normalizar(x.nome) || !e || !s || !dataValida(x.conferido_em)) { invalidas++; continue; }
    const idade = diasDe(hojeCivil) - diasDe(x.conferido_em);
    if (idade < 0 || idade > 7) { vencidas++; continue; }
    const k = normalizar(x.nome) + '|' + un;
    (grupos.get(k) || grupos.set(k, []).get(k)).push({ entrada: e[1] + ':' + e[2], saida: s[1] + ':' + s[2], conferidoEm: x.conferido_em });
  }
  const porPessoa = {};
  for (const [k, ls] of grupos) {
    const ids = nomes.get(k) || [];
    if (ids.length !== 1) { if (ids.length) conflitos++; else semPessoa++; continue; }
    if (ls.length !== 1) { conflitos++; continue; }
    if (comBatida.has(ids[0])) porPessoa[ids[0]] = ls[0];
  }
  if (invalidas) avisos.push(invalidas + ' jornada(s) cadastral(is) inválida(s) ignorada(s).');
  if (vencidas) avisos.push(vencidas + ' jornada(s) cadastral(is) com retrato vencido (mais de 7 dias) ignorada(s).');
  if (conflitos) avisos.push(conflitos + ' jornada(s) cadastral(is) sem pessoa única ou repetida(s) ignorada(s).');
  return { porPessoa, avisos };
}

// ---------- cache em memória: TTL + dedupe de leitura em andamento; falha nunca é guardada ----------
export function criarCache({ ttlMs = TTL_CACHE_MS, agora = Date.now, max = 64 } = {}) {
  const m = new Map();
  return {
    tamanho: () => m.size,
    async obter(chave, carregar) {
      const t = agora();
      for (const [k, e] of m) if (e.pronto && t - e.em >= ttlMs) m.delete(k);
      const e = m.get(chave);
      if (e) return e.pronto ? e.valor : e.pendente;
      const p = (async () => {
        try { const v = await carregar(); m.set(chave, { pronto: true, em: agora(), valor: v }); return v; }
        catch (err) { m.delete(chave); throw err; }
      })();
      if (m.size >= max) m.delete(m.keys().next().value);
      m.set(chave, { pendente: p });
      return p;
    },
  };
}

// ---------- cadastro (rh_pessoa, só o mínimo) ----------
const dataOuNull = (v) => (v === null || v === undefined ? null : (dataValida(v) ? v : undefined));
export function projetarPessoas(rows, unidades) {
  const out = []; let invalidas = 0;
  for (const p of Array.isArray(rows) ? rows : []) {
    const un = ehObj(p) ? unidadeCanonica(p.unidade) : null;
    const adm = ehObj(p) ? dataOuNull(p.admissao) : undefined, des = ehObj(p) ? dataOuNull(p.desligamento) : undefined;
    if (!ehObj(p) || !Number.isSafeInteger(p.id) || p.id <= 0 || typeof p.nome !== 'string' || !un || un === 'REDE' || !unidades.includes(un) || !adm || des === undefined) { invalidas++; continue; }
    out.push({
      id: p.id, nome: textoSeguro(p.nome, 80), unidade: p.unidade, admissao: adm, desligamento: des,
      flash_id: typeof p.flash_id === 'string' && p.flash_id.trim() ? p.flash_id : null,
      usa_ponto: p.usa_ponto === false ? false : true, cargo_confianca: typeof p.cargo_confianca === 'boolean' ? p.cargo_confianca : null,
    });
  }
  return { pessoas: out, invalidas };
}
const lista = (vs) => '(' + vs.map((v) => '"' + v + '"').join(',') + ')';
const COLS_PESSOA = 'id,nome,unidade,admissao,desligamento,flash_id,usa_ponto,cargo_confianca';
export const pessoasPath = (variantes, dia) => 'rh_pessoa?select=' + COLS_PESSOA + '&unidade=in.' + lista(variantes) + '&admissao=lte.' + dia
  + '&or=(desligamento.is.null,desligamento.gte.' + diaAnterior(dia) + ')&order=id.asc';
export const vendasPath = (variantes, dia) => 'vendas_saipos?select=id_sale,shift_date,unidade,comanda_id,nome_venda,cliente_nome,cancelada,hora_venda&shift_date=eq.' + dia
  + '&unidade=in.' + lista(variantes) + '&cancelada=not.is.true&order=id_sale.asc';
export const itensPath = (variantes, dia) => 'saipos_itens_venda?select=id_sale,id_sale_item,shift_date,unidade,produto,quantidade,preco_unit,deletado,observacao&shift_date=eq.' + dia
  + '&unidade=in.' + lista(variantes) + '&preco_unit=eq.0&deletado=not.is.true&order=id_sale.asc,id_sale_item.asc';

// ---------- refeição ----------
const DIAS_SEMANA = /^(SEGUNDA|TERCA|QUARTA|QUINTA|SEXTA|SABADO|DOMINGO)\s*-/;
export function ehItemRefeicao(item, venda) {
  if (!ehObj(item) || !ehObj(venda)) return false;
  if (venda.cancelada === true || item.deletado === true) return false;
  if (!(item.preco_unit !== null && item.preco_unit !== undefined && item.preco_unit !== '' && Number(item.preco_unit) === 0)) return false;
  const p = normalizar(item.produto);
  return p.includes('FUNCION') || DIAS_SEMANA.test(p);
}
function tipoDe(produto) {
  const p = normalizar(produto);
  if (p.includes('ALMOCO')) return 'almoço'; if (p.includes('JANTAR')) return 'jantar'; if (p.includes('LANCHE')) return 'lanche'; if (p.includes('CAFE')) return 'café';
  return 'refeição';
}
function produtoExibido(produto) {
  return textoSeguro(produto, 80).replace(/^(SEGUNDA|TER[CÇ]A|QUARTA|QUINTA|SEXTA|S[AÁ]BADO|DOMINGO)\s*-\s*/i, '').replace(/\s*FUNCION[AÁ]RIOS?\s*$/i, '').toLowerCase().slice(0, 60);
}
export const TIPOS_VINCULO = Object.freeze(['CARTAO', 'APELIDO', 'CATEGORIA_CARTAO', 'CATEGORIA_CLIENTE', 'PESSOA_VENDA', 'CATEGORIA_VENDA']);
const TIPOS_CATEGORIA = ['CATEGORIA_CARTAO', 'CATEGORIA_CLIENTE', 'CATEGORIA_VENDA'];
export function validarVinculos(rows, dia) {
  const ok = []; let invalidos = 0;
  for (const v of Array.isArray(rows) ? rows : []) {
    const un = ehObj(v) ? unidadeCanonica(v.unidade) : null;
    const tipo = ehObj(v) ? (TIPOS_VINCULO.includes(v.tipo) ? v.tipo : null) : null;
    const chaveTxt = ehObj(v) && (typeof v.chave === 'string' || Number.isSafeInteger(v.chave)) ? String(v.chave).trim() : '';
    // APELIDO: frase por tokens inteiros (mínimo 2 caracteres); CATEGORIA_CLIENTE: nome do cliente EXATO normalizado (sem substring); cartões: texto da comanda
    const chave = tipo === 'APELIDO' ? tokens(chaveTxt) : (tipo === 'CATEGORIA_CLIENTE' ? normalizar(chaveTxt) : chaveTxt);
    const categoria = TIPOS_CATEGORIA.includes(tipo);
    const porVenda = tipo === 'PESSOA_VENDA' || tipo === 'CATEGORIA_VENDA';   // lançamento avulso: chave = id_sale textual, vale SÓ na data exata
    const nome = ehObj(v) && typeof v.nome === 'string' ? (categoria ? textoSeguro(v.nome, 30).trim() : v.nome) : '';   // categoria: rótulo sanitizado, até 30 caracteres
    // valido_desde NULL = sem limite inicial explícito (vigente desde sempre); data inválida (não nula) = vínculo inválido
    const semInicio = v && (v.valido_desde === null || v.valido_desde === undefined);
    if (!un || un === 'REDE' || !tipo || !chave || (tipo === 'APELIDO' && chave.length < 2) || !normalizar(nome) || (!semInicio && !dataValida(v.valido_desde)) || (porVenda && semInicio)) { invalidos++; continue; }
    if (porVenda && v.valido_desde !== dia) continue;   // por venda: só vale quando a data do lançamento === dia pedido; outro dia é ignorado (não é inválido)
    if (!semInicio && v.valido_desde > dia) continue;   // ainda não vigente nesse dia
    ok.push({ un, tipo, chave, nome, desde: semInicio ? '' : v.valido_desde });   // '' ordena antes de qualquer data: NULL nunca vence uma data explícita
  }
  return { vinculos: ok, invalidos };
}
const CONFLITO = Symbol('conflito');
export function construirRefeicoes({ vendas, itens, vinculos, pessoas, dia }) {
  const avisos = [];
  const nomes = new Map();
  for (const p of pessoas) { const un = unidadeCanonica(p.unidade); if (!un || un === 'REDE') continue; const k = normalizar(p.nome) + '|' + un; nomes.set(k, (nomes.get(k) || []).concat(p.id)); }
  const v = validarVinculos(vinculos, dia);
  let homonimo = 0, conflitoVinc = 0, conflitoCat = 0;
  const pendentes = [];   // vínculo de pessoa sem pessoa única ativa: só vira aviso se for USADO por item elegível do dia
  const grupos = new Map();
  for (const x of v.vinculos) {
    const ehCat = TIPOS_CATEGORIA.includes(x.tipo);
    let quem;   // pessoa: id único do cadastro; categoria: o próprio rótulo (conjunto, nunca pessoa)
    if (ehCat) quem = x.nome;
    else {
      const ids = nomes.get(normalizar(x.nome) + '|' + x.un) || [];
      if (ids.length === 0) { pendentes.push({ tipo: x.tipo, un: x.un, chave: x.chave }); continue; }
      if (ids.length > 1) { homonimo++; continue; }
      quem = ids[0];
    }
    const k = x.tipo + '|' + x.un + '|' + x.chave;   // mapas separados por tipo + unidade + chave
    const g = grupos.get(k) || { tipo: x.tipo, un: x.un, chave: x.chave, linhas: [] };
    g.linhas.push({ id: quem, desde: x.desde }); grupos.set(k, g);
  }
  const cartao = new Map(), aliases = new Map(), catCartao = new Map(), catCliente = new Map(), catVenda = new Map(), pessoaVenda = new Map(), identificados = new Set();
  for (const g of grupos.values()) {
    const max = g.linhas.reduce((a, l) => (l.desde > a ? l.desde : a), '');
    const noMax = g.linhas.filter((l) => l.desde === max);
    if (TIPOS_CATEGORIA.includes(g.tipo)) {
      const porNorm = new Map(); for (const l of noMax) if (!porNorm.has(normalizar(l.id))) porNorm.set(normalizar(l.id), l.id);
      const rot = porNorm.size === 1 ? [...porNorm.values()][0] : CONFLITO;
      if (rot === CONFLITO) conflitoCat++;
      (g.tipo === 'CATEGORIA_CARTAO' ? catCartao : g.tipo === 'CATEGORIA_VENDA' ? catVenda : catCliente).set(g.un + '|' + g.chave, rot);
      continue;
    }
    const ids = [...new Set(noMax.map((l) => l.id))];
    const dono = ids.length === 1 ? ids[0] : CONFLITO;
    if (dono === CONFLITO) conflitoVinc++; else identificados.add(dono);
    if (g.tipo === 'CARTAO') cartao.set(g.un + '|' + g.chave, dono);
    else if (g.tipo === 'PESSOA_VENDA') pessoaVenda.set(g.un + '|' + g.chave, dono);
    else aliases.set(g.un, (aliases.get(g.un) || []).concat([{ alias: g.chave, dono }]));
  }
  const temCategoria = catCartao.size + catCliente.size + catVenda.size > 0;
  if (v.invalidos) avisos.push(v.invalidos + ' vínculo(s) de refeição inválido(s) ignorado(s).');
  if (homonimo) avisos.push(homonimo + ' vínculo(s) de refeição com nome repetido no cadastro foram ignorados (sem vínculo).');
  if (conflitoVinc) avisos.push(conflitoVinc + ' chave(s) de vínculo de refeição em conflito: ninguém recebe refeição por elas.');
  if (conflitoCat) avisos.push(conflitoCat + ' chave(s) de categoria de refeição em conflito: nenhuma categoria recebe refeição por elas.');

  const vendaPor = new Map();
  for (const x of Array.isArray(vendas) ? vendas : []) {
    const un = ehObj(x) ? unidadeCanonica(x.unidade) : null;
    if (!un || x.cancelada === true || x.id_sale === null || x.id_sale === undefined) continue;
    const cm = x.comanda_id === null || x.comanda_id === undefined ? '' : String(x.comanda_id).trim();
    vendaPor.set(un + '|' + String(x.id_sale), { un, idSale: String(x.id_sale), cancelada: false, comanda: cm && cm !== '0' ? cm : '', texto: tokens((x.nome_venda || '') + ' ' + (x.cliente_nome || '')), cliente: normalizar(x.cliente_nome), hora: horaDe(x.hora_venda) });
  }
  const porPessoa = {}, porCategoria = new Map(); let semDono = 0, conflitoItem = 0;
  const usados = new Set();   // índices de `pendentes` realmente usados por item elegível do dia
  for (const it of Array.isArray(itens) ? itens : []) {
    const un = ehObj(it) ? unidadeCanonica(it.unidade) : null;
    const venda = un ? vendaPor.get(un + '|' + String(it.id_sale)) : null;
    if (!venda || !ehItemRefeicao(it, venda)) continue;
    const texto = ' ' + venda.texto + ' ' + tokens(it.observacao) + ' ';
    pendentes.forEach((p, i) => {
      if (p.un !== un) return;
      if ((p.tipo === 'CARTAO' && venda.comanda && p.chave === venda.comanda) || (p.tipo === 'PESSOA_VENDA' && p.chave === venda.idSale) || (p.tipo === 'APELIDO' && texto.includes(' ' + p.chave + ' '))) usados.add(i);
    });
    // categoria (conjunto, não pessoa) vence o alias da observação; com cartão de pessoa explícita na mesma venda = conflito
    const cats = new Set(); let confCat = false;
    for (const k of [venda.comanda ? catCartao.get(un + '|' + venda.comanda) : undefined, venda.cliente ? catCliente.get(un + '|' + venda.cliente) : undefined, catVenda.get(un + '|' + venda.idSale)]) {
      if (k === CONFLITO) confCat = true; else if (k !== undefined) cats.add(k);
    }
    const pv = pessoaVenda.get(un + '|' + venda.idSale);   // pessoa atribuída a esta venda (lançamento avulso do dia)
    if (pv !== undefined && (confCat || cats.size > 0)) { conflitoItem++; continue; }   // qualquer categoria × PESSOA_VENDA = conflito
    if (confCat || cats.size > 1) { conflitoItem++; continue; }
    if (cats.size === 1) {
      if (venda.comanda && cartao.get(un + '|' + venda.comanda) !== undefined) { conflitoItem++; continue; }
      const q = Number(it.quantidade), rot = [...cats][0];
      (porCategoria.get(rot) || porCategoria.set(rot, []).get(rot)).push({ tipo: tipoDe(it.produto), produto: produtoExibido(it.produto), quantidade: Number.isFinite(q) && q >= 1 ? Math.min(99, Math.round(q)) : 1, hora: venda.hora });
      continue;
    }
    const achados = new Set(); let confAlias = false;
    for (const a of aliases.get(un) || []) if (texto.includes(' ' + a.alias + ' ')) { if (a.dono === CONFLITO) confAlias = true; else achados.add(a.dono); }
    const c = venda.comanda ? cartao.get(un + '|' + venda.comanda) : undefined;
    if (c === CONFLITO || confAlias || pv === CONFLITO) { conflitoItem++; continue; }
    // PESSOA_VENDA pode atribuir órfão, mas contra qualquer cartão/alias pessoal de OUTRA pessoa é conflito (nada silencia regra)
    const ids = new Set(achados); if (c !== undefined) ids.add(c); if (pv !== undefined) ids.add(pv);
    if (ids.size > 1) { conflitoItem++; continue; }
    const dono = ids.size === 1 ? [...ids][0] : null;
    if (dono === null) { semDono++; continue; }
    const q = Number(it.quantidade);
    (porPessoa[dono] = porPessoa[dono] || []).push({ tipo: tipoDe(it.produto), produto: produtoExibido(it.produto), quantidade: Number.isFinite(q) && q >= 1 ? Math.min(99, Math.round(q)) : 1, hora: venda.hora });
  }
  for (const k of Object.keys(porPessoa)) porPessoa[k].sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
  const categorias = [...porCategoria].map(([rotulo, its]) => ({ rotulo, total: its.reduce((a, i) => a + i.quantidade, 0), itens: its.sort((a, b) => String(a.hora).localeCompare(String(b.hora))) }))
    .sort((a, b) => (a.rotulo < b.rotulo ? -1 : a.rotulo > b.rotulo ? 1 : 0));
  // órfãos reais (sem categoria e sem pessoa) seguem avisados à parte; só contagens e rótulos de categoria, nunca chave/cliente/observação
  if (categorias.length) avisos.push('Refeição em categoria (não é pessoa): ' + categorias.map((c) => c.rotulo + ' (' + c.itens.length + ')').join(', ') + '.');
  if (usados.size) avisos.push(usados.size + ' vínculo(s) de refeição sem pessoa ativa nesse dia (vínculo inativo ou cadastro a conferir) foram ignorados.');   // só vínculo usado; o não usado não é pendência atual
  if (semDono) avisos.push(semDono + ' item(ns) de refeição sem dono identificado (não atribuídos a ninguém).');
  if (conflitoItem) avisos.push(conflitoItem + ' item(ns) de refeição com identificação em conflito (não atribuídos a ninguém).');
  return { porPessoa, categorias, identificados: [...identificados].sort((a, b) => a - b), avisos, semVinculos: identificados.size === 0 && !temCategoria };
}

// ---------- orquestração ----------
/** c: { metodo, authorization, query:{dia,unidade}, env:{supabaseUrl,anonKey}, fetchImpl, agora, cache, obterChaveFlash(), obterVinculos(),
 *       timeoutMs, pageSize, maxPaginas } -> { status, corpo }.  Erros devolvem só { erro: codigo }. */
export async function responder(c) {
  try { return await executar(c); }
  catch (e) { return e instanceof ErroLeitura ? { status: e.status, corpo: { erro: e.codigo } } : { status: 500, corpo: { erro: 'interno' } }; }
}
async function executar(c) {
  if (!origemPermitida(c.origem, c.origens || ORIGENS_PADRAO)) throw new ErroLeitura('origem_nao_permitida', 403);   // antes de ler qualquer coisa
  if (c.metodo !== 'GET') throw new ErroLeitura('metodo_nao_permitido', 405);
  const jwt = extrairJwt(c.authorization); if (!jwt) throw new ErroLeitura('nao_autenticado', 401);
  const agora = c.agora || Date.now;
  const base = { fetchImpl: c.fetchImpl, supabaseUrl: c.env.supabaseUrl, anonKey: c.env.anonKey, timeoutMs: c.timeoutMs || 8000, pageSize: c.pageSize || 1000, maxPaginas: c.maxPaginas || 30 };
  const headers = { apikey: c.env.anonKey, Authorization: 'Bearer ' + jwt, Accept: 'application/json' };
  const userId = await autenticar(base, jwt);
  if (c.limitador && !c.limitador.permitir(userId)) throw new ErroLeitura('limite_de_chamadas', 429);
  const painel = await exigirPermissoes(base, headers);
  const q = ehObj(c.query) ? c.query : {};
  const unidades = unidadesPermitidas(q.unidade, painel);
  const t0 = agora(), b = brtAgora(t0), op = diaOperacionalDe(b);
  const dia = validarDia(q.dia, op);   // teto e base dos 7 dias = dia OPERACIONAL (antes das 07:00 o dia civil atual é futuro)
  const avisos = [];
  const variantes = unidades.flatMap(variantesUnidade);

  const { pessoas, invalidas } = projetarPessoas(await paginar({ ...base, headers }, pessoasPath(variantes, dia)), unidades);
  if (invalidas) avisos.push(invalidas + ' cadastro(s) com dados inválidos não foram enviados.');

  const lerEmpresa = (un, d) => c.cache.obter(EMPRESAS[un] + '|' + d, async () => {
    let chave; try { chave = await c.obterChaveFlash(); } catch (e) { chave = null; }
    if (typeof chave !== 'string' || !chave) throw new ErroLeitura('config_indisponivel', 502);
    const r = await lerFlashDia(base, EMPRESAS[un], d, chave);
    return { funcionarios: r.funcionarios, descartes: r.descartes, lidoEm: new Date(agora()).toISOString() };
  });
  const montar = (un, d, r) => {
    const permitidos = new Set(pessoas.filter((p) => unidadeCanonica(p.unidade) === un && p.flash_id).map((p) => p.flash_id));
    return montarBatidas(r.funcionarios, permitidos, d, r.lidoEm);
  };
  const dias = await Promise.all(unidades.map((un) => lerEmpresa(un, dia)));   // falha do Flash => erro 502 (nunca vira "lote")
  const batidas = [], lidos = [];
  let semCad = 0, descartadas = 0, naoAprov = 0;
  let foraJanela = 0;
  dias.forEach((r, i) => { const m = montar(unidades[i], dia, r); batidas.push(...m.linhas); semCad += m.semCadastro; foraJanela += m.foraJanela; lidos.push(r.lidoEm); descartadas += r.descartes.invalidos + r.descartes.duplicados + r.descartes.foraDoDia; naoAprov += r.descartes.naoAprovadas; });
  // sem "dia anterior": o dia operacional já cobre a madrugada (campos mantidos vazios só pelo contrato com a tela)
  const batidasAnterior = [], anterior = { pedido: false, ok: false };
  if (foraJanela) avisos.push(foraJanela + ' batida(s) fora da janela operacional (07:00 do dia até 03:00 do seguinte) não foram contadas.');
  // jornada cadastral (callback privado, só cadastro): falha = 2 batidas seguem ambíguas dentro das 2 h; nunca bloqueia o ponto
  let jornadas = {};
  if (dia === op && typeof c.obterJornadas === 'function') {   // só no vivo (dia operacional atual); histórico nem consulta a jornada
    try {
      const flashes = new Set(batidas.map((x) => x.flash_id));
      const r = construirJornadas({ jornadas: await c.obterJornadas(), pessoas, hojeCivil: b.data, comBatida: new Set(pessoas.filter((p) => p.flash_id && flashes.has(p.flash_id)).map((p) => p.id)) });
      jornadas = r.porPessoa; avisos.push(...r.avisos);
    } catch (e) { avisos.push('Jornada cadastral indisponível agora: duas batidas recentes seguem como saída ou intervalo, sem afirmar.'); }
  }
  if (semCad) avisos.push(semCad + ' funcionário(s) do Flash com batida e sem cadastro nesta consulta não foram enviados.');
  if (descartadas) avisos.push(descartadas + ' registro(s) do Flash ilegíveis, repetidos ou de outro dia foram descartados.');
  if (naoAprov) avisos.push(naoAprov + ' batida(s) com aprovação diferente de Approved foram contadas como lidas; o Flash não informa o motivo aqui.');

  // refeição: falha = indisponível; nunca "não lançou" sem leitura bem-sucedida e sem pessoa identificada
  let refeicoes = { disponivel: false, porPessoa: {}, identificados: [] };
  const refeicoesAnterior = { disponivel: false, porPessoa: {}, identificados: [] };
  try {
    const vinculos = await c.obterVinculos();
    const lerDia = async (d) => {
      const [vendas, itens] = await Promise.all([paginar({ ...base, headers }, vendasPath(variantes, d)), paginar({ ...base, headers }, itensPath(variantes, d))]);
      return construirRefeicoes({ vendas, itens, vinculos, pessoas, dia: d });
    };
    const r = await lerDia(dia);
    if (r.semVinculos) avisos.push('Refeição: nenhum vínculo confirmado no cadastro; ninguém pode ser identificado.');
    else refeicoes = { disponivel: true, porPessoa: r.porPessoa, identificados: r.identificados, categorias: r.categorias };
    avisos.push(...r.avisos);
  } catch (e) {
    if (e instanceof ErroLeitura && e.status === 401) throw e;
    avisos.push('Refeição indisponível agora: nada foi afirmado sobre refeições.');
  }
  return {
    status: 200,
    corpo: {
      fonte: FONTE, dia, unidade: unidades.length === 1 ? unidades[0] : 'REDE', unidades, consultadoEm: new Date(t0).toISOString(), lidoEm: lidos.slice().sort()[0],
      modoAguaVerde: true, diaOperacional: diaOperacionalDe(b), jornadas,
      pessoas, batidas, batidasAnterior, anterior, refeicoes, refeicoesAnterior, avisos,
    },
  };
}

// ---------- CORS ----------
export const ORIGENS_PADRAO = Object.freeze(['https://cidadaodomundo-erp.github.io']);
// lista vinda do ambiente: '*' nunca vale; vazia => padrão explícito
export const origensDe = (txt) => { const l = String(txt || '').split(',').map((s) => s.trim()).filter((s) => s && s !== '*'); return l.length ? l : ORIGENS_PADRAO.slice(); };
// sem Origin (chamada de servidor/curl autenticada) passa; com Origin só se estiver na lista
export const origemPermitida = (origin, permitidas = ORIGENS_PADRAO) => !origin || permitidas.includes(origin);
export function corsHeaders(origin, permitidas = ORIGENS_PADRAO) {
  const ok = origin && permitidas.includes(origin) ? origin : null;
  const h = { 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (ok) h['Access-Control-Allow-Origin'] = ok;
  return h;
}

