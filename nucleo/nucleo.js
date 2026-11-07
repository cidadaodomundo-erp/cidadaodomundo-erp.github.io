// Núcleo comum do painel Cidadão do Mundo (24/10/2026, painel em módulos).
// Saiu de docs/dashboard.html, MOVIDO e não copiado: conexão com o banco, leitura paginada, sessão de login, registro de
// uso e formatação. Toda página do painel (dashboard.html, listas/index.html, as próximas) carrega este arquivo ANTES do
// seu próprio código. Cada página define o que é dela: exigirLogin(recado) (a porta de login) — consultarTudo a chama
// quando a sessão vence. NA_CASCA/avisarCasca vêm do <head> de cada página.
// Quem mexe aqui: o chat "Telas do painel". Mudança aqui vale para todas as páginas de uma vez.

// ------------------------------------------------------------------
// Conexao com o Supabase (chave publica, somente leitura por RLS)
// ------------------------------------------------------------------
const SUPABASE_URL = "https://rtmgzsikwglsvpopbfbw.supabase.co";

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0bWd6c2lrd2dsc3Zwb3BiZmJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU4NDgwMjcsImV4cCI6MjEwMTQyNDAyN30.-vwbQkcuAbbonmBVCeUWXjTg54uB5MNN94QmMlBxTA4";

// A chave anon continua indo no apikey (o PostgREST exige), mas quem manda no
// que pode ser lido e o Bearer: o token da pessoa logada.
function cabecalhoLeitura() {
  const s = rmbSessao();
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${(s && s.access_token) || SUPABASE_ANON_KEY}` };
}

// ORDEM ESTÁVEL NA PAGINAÇÃO (22/10/2026). O PostgREST entrega de 1.000 em 1.000; sem `order=` a ordem entre uma
// página e outra não é garantida e linha some ou repete em silêncio (na Evolução, "parte de combo" deu R$ 426 onde o
// banco tem R$ 846). Se a leitura passar de uma página e não tiver order=, recomeça ordenando pelas colunas do select.
// Com select=* não há como saber as colunas: avisa no console — essa leitura precisa de order= escrito.
function ordemDoSelect(caminho) {
  const m = caminho.match(/[?&]select=([^&]*)/);
  if (!m || m[1] === '*' || m[1].includes('(')) return null;
  const cols = decodeURIComponent(m[1]).split(',').map((c) => c.trim().split(':').pop().split('::')[0]).filter(Boolean);
  return cols.length ? cols.join(',') : null;
}

// 27/10/2026: "Failed to fetch" = a rede caiu no meio (não é erro do banco) — tenta de novo antes de desistir
async function buscarLeitura(url) {
  for (let t = 0; ; t++) {
    try { return await fetch(url, { headers: cabecalhoLeitura() }); }
    catch (e) {
      if (t >= 2 || !(e instanceof TypeError)) throw e;
      await new Promise(r => setTimeout(r, t ? 2500 : 1000));
    }
  }
}
async function consultarTudo(caminho) {
  const PAGE = 1000;
  // uma pagina; podeRenovar=false no paralelo: 401 volta como erro marcado e o resto se le uma por vez
  // quem ja pede o proprio limit (ex.: "a ultima data", limit=1) leva uma pagina so, do tamanho que pediu.
  // Antes o limit=1000 da paginacao entrava depois e ganhava: "a ultima data" baixava a tabela inteira (24/10/2026).
  const proprioLimite = /[?&]limit=\d+/.test(caminho);
  const pagina = async (cam, offset, podeRenovar) => {
    const sep = cam.includes('?') ? '&' : '?';
    const url = proprioLimite ? `${SUPABASE_URL}/rest/v1/${cam}` : `${SUPABASE_URL}/rest/v1/${cam}${sep}limit=${PAGE}&offset=${offset}`;
    // Desde 21/08/2026 o painel le com o token de QUEM ESTA LOGADO: o papel
    // anon perdeu o SELECT (script/fechar_leitura_anonima.sql). Sem sessao
    // valida nao ha painel — e nao ha dado exposto a quem achar o repositorio.
    let resp = await buscarLeitura(url);
    // 26/10/2026: 503 PGRST002 = a API recarregando o mapa do banco depois de uma mudança de estrutura; passa em segundos
    for (let t = 1; resp.status === 503 && t <= 3; t++) {
      await new Promise(r => setTimeout(r, 1500 * t));
      resp = await buscarLeitura(url);
    }
    if (resp.status === 401) {
      if (!podeRenovar) { const e = new Error('401'); e.renovar = true; throw e; }
      if (await rmbRenovarSeExpirado(resp)) resp = await buscarLeitura(url);   // token renovado, tenta de novo
    }
    if (resp.status === 401) { exigirLogin('Sua sessão venceu. Entre de novo.'); throw new Error('sessão vencida'); }
    // Teto de 8 s estourado (57014): uma segunda tentativa, 1,5 s depois. A tela "Hoje" dispara
    // ~20 consultas juntas e a maior passa dos 8 s so na fila; sozinha leva 1,7 s (19/10/2026).
    if (resp.status === 500) {
      const txt = await resp.text();
      if (!txt.includes('57014')) throw new Error(`Erro 500 ao consultar ${cam}: ${txt}`);
      await new Promise(r => setTimeout(r, 1500));
      resp = await buscarLeitura(url);
    }
    if (!resp.ok) { const e = new Error(`Erro ${resp.status} ao consultar ${cam}: ${await resp.text()}`); e.status = resp.status; throw e; }
    return resp.json();
  };
  let t0 = performance.now();
  let p0 = await pagina(caminho, 0, true);
  if (proprioLimite || p0.length < PAGE) return p0;
  // mais de 1.000 linhas: precisa de ordem estavel, senao a paginacao repete/perde linha
  if (!/[?&]order=/.test(caminho)) {
    const ord = ordemDoSelect(caminho);
    if (ord) {
      const comOrdem = caminho + (caminho.includes('?') ? '&' : '?') + 'order=' + ord;
      try { t0 = performance.now(); p0 = await pagina(comOrdem, 0, true); caminho = comOrdem; }
      catch (e) {
        // coluna que o banco não sabe ordenar (json): volta à leitura de antes em vez de quebrar a tela
        if (e.status !== 400) throw e;
        console.warn('consultarTudo: não deu para ordenar pelo select, sigo sem ordem:', caminho.slice(0, 120));
      }
    } else console.warn('consultarTudo: mais de 1.000 linhas sem order= (paginação pode perder linha):', caminho.slice(0, 120));
  }
  let tudo = p0;
  if (p0.length < PAGE) return tudo;
  // 24/10/2026: 4 paginas de cada vez; view pesada (1a pagina > 1,5 s) segue uma por vez
  let par = (performance.now() - t0) > 1500 ? 1 : 4;
  let offset = PAGE;
  while (true) {
    let pags;
    try {
      pags = par === 1 ? [await pagina(caminho, offset, true)]
        : await Promise.all(Array.from({ length: par }, (_, i) => pagina(caminho, offset + i * PAGE, false)));
    } catch (e) {
      if (!e.renovar) throw e;
      par = 1; continue;   // login vencendo no meio: o resto uma por vez, com a renovacao de sempre
    }
    let acabou = false;
    for (const pg of pags) {
      tudo = tudo.concat(pg);
      if (pg.length < PAGE) { acabou = true; break; }
    }
    if (acabou) break;
    offset += pags.length * PAGE;
  }
  return tudo;
}

const MESES_ABREV = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function fmt(v) { return (Math.abs(v) < 0.005 ? 0 : v).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}); }

function pct(v) { return (Math.abs(v) < 0.05 ? 0 : v).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}); }

// Selo de variacao mostrado dentro do card.
//
// A leitura usa DOIS canais que nunca se contradizem:
//   - a PALAVRA ("subiu"/"caiu") diz o que aconteceu com o numero — fato, sem interpretacao;
//   - a COR diz se isso e bom ou ruim para o resultado — interpretacao.
// Antes so havia seta + cor, e o leitor tinha que combinar mentalmente os dois (uma seta pra
// baixo verde confunde, porque seta pra baixo "parece" ruim). Com a palavra explicita, o fato
// fica claro mesmo que a pessoa ignore a cor.
//
// tipo: 'maiorMelhor' (receita, lucro) | 'menorMelhor' (custo) | 'neutro' (investimento —
// gastar mais nao e bom nem ruim por si so, depende do retorno; nao cabe ao painel julgar).
function selo(atual, anterior, tipo = 'maiorMelhor') {
  if (anterior === null || anterior === undefined || !isFinite(anterior)) return '';

  const antesZero = Math.abs(anterior) < 0.005;
  const agoraZero = Math.abs(atual) < 0.005;
  if (antesZero && agoraZero) return '';

  const detalhe = `Antes: R$ ${fmt(anterior)} → agora: R$ ${fmt(atual)}`;

  // Saindo do zero nao existe percentual — o certo e dizer que apareceu agora.
  if (antesZero) {
    const cor = tipo === 'neutro' ? '#8a897e' : (tipo === 'maiorMelhor' ? '#3fb950' : '#ff6b6b');
    return `<div class="card-delta" style="color:${cor};" title="${detalhe}">apareceu neste período (antes era zero)</div>`;
  }

  const variacao = (atual - anterior) / Math.abs(anterior) * 100;
  if (!isFinite(variacao)) return '';

  if (Math.abs(variacao) < 0.05) {
    return `<div class="card-delta" style="color:#8a897e;" title="${detalhe}">sem mudança vs período anterior</div>`;
  }

  const subiu = variacao > 0;
  const palavra = subiu ? 'subiu' : 'caiu';
  const seta = subiu ? '▲' : '▼';
  let cor = '#8a897e';
  if (tipo === 'maiorMelhor') cor = subiu ? '#3fb950' : '#ff6b6b';
  else if (tipo === 'menorMelhor') cor = subiu ? '#ff6b6b' : '#3fb950';

  return `<div class="card-delta" style="color:${cor};" title="${detalhe}">${seta} ${palavra} ${pct(Math.abs(variacao))}% vs período anterior</div>`;
}

function rmbSessao() {
  try { return JSON.parse(localStorage.getItem('rmbSessao') || 'null'); } catch (e) { return null; }
}

function rmbHeaders(extra = {}) {
  const s = rmbSessao();
  // Sem sessao vale o proprio anon: a conciliacao marca sem login desde 19/08.
  return { apikey: SUPABASE_ANON_KEY,
           Authorization: `Bearer ${(s && s.access_token) || SUPABASE_ANON_KEY}`,
           'Content-Type': 'application/json', ...extra };
}

// UMA renovacao de cada vez. O refresh_token do Supabase e' de uso unico: ao
// usar, ele vira outro. O painel dispara dezenas de consultas em paralelo,
// entao um token vencido produzia dezenas de 401 simultaneos e dezenas de
// tentativas de renovar com o MESMO refresh_token — a primeira funcionava e as
// outras recebiam "token ja usado", que o codigo tratava como sessao invalida
// e apagava o login. Resultado: quem passasse de uma hora com o painel aberto
// era jogado para fora, com a sessao ainda viva no servidor. (21/08/2026)
let RENOVANDO = null;

async function rmbRenovar() {
  if (RENOVANDO) return RENOVANDO;          // ja tem uma em curso: espera ela
  RENOVANDO = (async () => {
    const s = rmbSessao();
    if (!s || !s.refresh_token) return false;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    let novo = {};
    try { novo = await r.json(); } catch (e) {}
    if (!r.ok || !novo.access_token) {
      // Falha de rede nao e' motivo para deslogar ninguem — so a recusa do
      // servidor (400/401) significa que o refresh_token nao vale mais.
      if (r.status === 400 || r.status === 401) localStorage.removeItem('rmbSessao');
      return false;
    }
    localStorage.setItem('rmbSessao', JSON.stringify({
      access_token: novo.access_token, refresh_token: novo.refresh_token, email: s.email,
      expira_em: Date.now() + ((novo.expires_in || 3600) * 1000),
    }));
    return true;
  })();
  try { return await RENOVANDO; } finally { RENOVANDO = null; }
}

async function rmbRenovarSeExpirado(resp) {
  if (resp.status !== 401) return false;
  return rmbRenovar();
}

// Renova ANTES de sair disparando consulta. Sem isto, um token vencido vira
// dezenas de 401 e o painel pisca erro antes de se recuperar.
async function rmbGarantirTokenValido() {
  const s = rmbSessao();
  if (!s) return false;
  if (s.expira_em && Date.now() < s.expira_em - 60000) return true;   // ainda vale
  return rmbRenovar();
}

// QUAIS TELAS SAO ABERTAS (15/10/2026, pedido do dono: "junto com a medicao de uso").
// Antes de decidir o que sai do menu, medir — a reorganizacao de 12/09 cortou no chute e
// foi revertida. Uma linha por tela aberta em painel_uso (script/sql/painel_uso.sql): o
// e-mail sai do token no banco, nunca daqui; so o dono le. Falha aqui nunca atrapalha a tela.
// Redesenhar a MESMA tela (troca de filtro, setPerimetro) nao e' abertura nova: so conta de
// novo depois de 30 minutos.
let USO_ULTIMO = { tela: null, quando: 0 };

function registrarUso(tela) {
  try {
    const s = rmbSessao();
    if (!s || !s.access_token || !tela) return;
    const agora = Date.now();
    if (USO_ULTIMO.tela === tela && agora - USO_ULTIMO.quando < 30 * 60000) return;
    USO_ULTIMO = { tela, quando: agora };
    fetch(`${SUPABASE_URL}/rest/v1/rpc/painel_registrar_uso`, {
      method: 'POST', keepalive: true,
      headers: { ...cabecalhoLeitura(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_tela: tela, p_origem: NA_CASCA ? 'casca' : 'painel' }),
    }).catch(() => {});
  } catch (e) {}
}

// ------------------------------------------------------------------
// 24/10/2026 (bloco 2): auxiliares que as telas de Listas e de Estoque usam e o painel também. Saíram do listas.js
// (trHoje, trFetch, trRpc, trErroDe, trEscH) e do dashboard.html (fxSomaDias), com os mesmos nomes.
// ------------------------------------------------------------------
// o dia de hoje em Curitiba (AAAA-MM-DD). Saiu do estoque.js em 05/11/2026: o Fluxo projetado também usa.
function prdHoje() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function trHoje() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
async function trFetch(url, opts = {}) {
  const faz = () => fetch(`${SUPABASE_URL}/rest/v1/${url}`, { ...opts, headers: rmbHeaders(opts.headers || {}) });
  let r = await faz();
  if (await rmbRenovarSeExpirado(r)) r = await faz();
  return r;
}
async function trRpc(fn, args) {
  return trFetch(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args || {}) });
}
async function trErroDe(r) {
  try { const j = await r.json(); return j.message || j.hint || j.error_description || JSON.stringify(j).slice(0, 160); }
  catch (e) { return 'HTTP ' + r.status; }
}
function trEscH(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fxSomaDias(dataStr, n) { const d = new Date(dataStr + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

// ------------------------------------------------------------------
// 29/10/2026 — A BARRA DO RESULTADO (dono, 28/10 18:50 e 19:30: "ele não pode vir até mim perguntar se deu certo alguma
// ação dele no painel"). Fica fixa no pé da tela, fora do que se redesenha (a tabela recarregar não a apaga), e não some
// sozinha: só a próxima ação ou o "fechar aviso" a trocam. Estados: 'enviando' (gravando…), 'ok' (✓ com a hora),
// 'erro' (✗ o motivo; "Tentar de novo" quando a ação pode ser repetida) e 'atencao' (o que falta antes de gravar).
// Uma barra só por tela: o aviso da ação nova substitui o da anterior. Fica por cima das janelinhas (o Caixa usa 9999).
// ------------------------------------------------------------------
// 29/10/2026 (dono): "a barra de rolagem no topo faz sentido? assim não precisaria ir até o fim da tabela pra rolar".
// Toda tabela do painel (div id="tabela…") mais larga que a tela ganha uma barra EM CIMA, ligada à de baixo.
const CEL_FICA_TABELA = new Set(['tabelaDRE', 'tabelaDFC', 'tabelaPonte', 'tabelaPonteLucro', 'tabelaEvolMatriz', 'tabelaAtrasosMatriz', 'tabelaFreteMatriz', 'tabelaTrMensal']);
function barrasTopoTabelas() {
  // 01/11/2026: no celular, tabela mais larga que a tela vira cartão por linha (.cel-cartao, nucleo.css). Ficam como tabela,
  // com a primeira coluna fixa, as matrizes em que comparar colunas é o objetivo e as listas longas demais para cartão.
  if (matchMedia('(max-width:760px)').matches) {
    document.querySelectorAll('table').forEach((t) => {
      const p = t.parentElement;
      if (!t.offsetParent || p.closest('table') || p.classList.contains('cel-cartao') || t.closest('#view-caixa') || CEL_FICA_TABELA.has(p.id)) return;
      if (t.offsetWidth <= p.clientWidth + 2 && t.getBoundingClientRect().right <= document.documentElement.clientWidth + 2) return;
      const cabs = [...t.rows].filter((r) => r.cells.length && [...r.cells].every((c) => c.tagName === 'TH'));
      // 05/11/2026 (dono: "as telas todas responsivas"): o teto era 60 linhas e deixava rolando de lado Engenharia do
      // cardápio (201), Contestações (102), Saipos dos acertos (140) e o Conferir da Contagem (322) — no celular, cartão
      // comprido é melhor que tabela larga; quem precisa comparar colunas fica na CEL_FICA_TABELA
      if (cabs.length !== 1 || [...cabs[0].cells].some((c) => c.colSpan > 1)) return;
      p.classList.add('cel-cartao');
    });
  }
  // cada célula leva o nome da coluna
  document.querySelectorAll('.cel-cartao > table').forEach((t) => {
    const cab = [...t.rows].find((r) => r.cells.length && [...r.cells].every((c) => c.tagName === 'TH'));
    if (!cab) return;
    cab.classList.add('cel-cab');
    const nomes = [...cab.cells].map((c) => (c.firstChild ? c.firstChild.textContent : '').trim());   // o título, sem a legenda embaixo dele
    [...t.rows].forEach((r) => { if (r !== cab) [...r.cells].forEach((c, i) => {
      if (c.dataset.rot !== nomes[i]) c.dataset.rot = nomes[i] || '';
      if (i > 0 && c.textContent.trim() === '—') c.classList.add('cel-vazio');   // no cartão, linha sem valor não ocupa lugar
    }); });
  });
  document.querySelectorAll('div[id^="tabela"]').forEach((d) => {
    if (d.parentElement && d.parentElement.closest('div[id^="tabela"]')) return;   // tabela dentro de tabela: só a de fora
    let b = d.previousElementSibling && d.previousElementSibling.classList.contains('barra-topo-tabela') ? d.previousElementSibling : null;
    const larga = d.clientWidth && d.scrollWidth > d.clientWidth + 2;
    if (!larga) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div'); b.className = 'barra-topo-tabela'; b.appendChild(document.createElement('div'));
      d.parentNode.insertBefore(b, d);
      b.addEventListener('scroll', () => { if (d.scrollLeft !== b.scrollLeft) d.scrollLeft = b.scrollLeft; });
      d.addEventListener('scroll', () => { if (b.scrollLeft !== d.scrollLeft) b.scrollLeft = d.scrollLeft; });
    }
    b.firstChild.style.width = d.scrollWidth + 'px';
    b.style.width = d.clientWidth + 'px';
    b.scrollLeft = d.scrollLeft;
  });
}
if (typeof MutationObserver !== 'undefined') {
  const vigia = () => { clearTimeout(barrasTopoTabelas._t); barrasTopoTabelas._t = setTimeout(barrasTopoTabelas, 300); };
  const ligar = () => { new MutationObserver(vigia).observe(document.body, { childList: true, subtree: true }); vigia(); };
  if (document.body) ligar(); else document.addEventListener('DOMContentLoaded', ligar);
  window.addEventListener('resize', vigia);
  document.addEventListener('toggle', vigia, true);   // tabela dentro de grupo recolhido só tem largura depois de aberto
}
let AVISO_REFAZER = null;
function avisoHora() { return new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); }
function avisoAcao(estado, texto, refazer) {
  let b = document.getElementById('avisoAcao');
  if (!estado) { if (b) b.remove(); document.body.style.paddingBottom = ''; AVISO_REFAZER = null; return; }
  if (!b) {
    b = document.createElement('div'); b.id = 'avisoAcao'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite');
    b.style.cssText = 'position:fixed; left:0; right:0; bottom:0; z-index:10050; display:flex; gap:10px; align-items:center; flex-wrap:wrap;'
      + ' padding:12px 16px; background:var(--surface); border-top:4px solid var(--line); box-shadow:0 -4px 14px rgba(0,0,0,.35);'
      + ' font-size:15px; font-weight:700; line-height:1.35; color:var(--tx-1);';
    document.body.appendChild(b);
  }
  AVISO_REFAZER = estado === 'erro' && typeof refazer === 'function' ? refazer : null;
  const cor = { ok: 'var(--farol-ok)', erro: 'var(--farol-fora)', atencao: 'var(--farol-perto)' }[estado] || 'var(--tx-3)';
  b.style.borderTopColor = cor;
  b.innerHTML = `<span style="flex:1 1 240px; color:${cor};">${trEscH(texto)}</span>`
    + (AVISO_REFAZER ? `<button class="preset-btn" onclick="avisoRefazer()" style="font-size:14px; padding:9px 14px;">Tentar de novo</button>` : '')
    + `<button class="preset-btn" onclick="avisoAcao(null)" style="font-size:12.5px;">fechar aviso</button>`;
  document.body.style.paddingBottom = (b.offsetHeight + 12) + 'px';
}
function avisoRefazer() { const f = AVISO_REFAZER; AVISO_REFAZER = null; if (f) f(); }
// trRpc que não estoura: sem rede, devolve uma resposta de erro que o trErroDe sabe ler (a barra nunca fica presa em "gravando")
async function trRpcSeguro(fn, args) {
  try { return await trRpc(fn, args); }
  catch (e) { return { ok: false, status: 0, json: async () => ({ message: 'sem conexão com o banco (' + (e && e.message || e) + ')' }) }; }
}

// ------------------------------------------------------------------
// 26/10/2026 (bloco 3): quem é o dono — saiu do dashboard.html; o Caixa e o painel usam.
// ------------------------------------------------------------------
// Quem e' o dono vem do BANCO (rmb_config.email_dono) — a mesma linha que a
// funcao eh_dono() consulta nas policies. Ate 21/08/2026 este e-mail estava
// escrito aqui como 'netoavft@gmail.com' e ficou para tras quando o dono mudou
// para o endereco da empresa, em 20/08: o painel escondia os botoes de aprovar
// reembolso do proprio dono, porque comparava com o endereco velho.
let EMAIL_DONO = null;

async function carregarEmailDono() {
  if (EMAIL_DONO) return EMAIL_DONO;
  // 07/11/2026: login vencido na abertura dava 401 aqui, e o '' ficava guardado: o dono virava "não é o dono" até recarregar
  // (a Minha agenda dizia "chega em breve"). Agora renova e tenta de novo; se ainda falhar, fica null e a próxima chamada relê.
  const ler = () => fetch(`${SUPABASE_URL}/rest/v1/rmb_config?chave=eq.email_dono&select=valor`, { headers: rmbHeaders() });
  let r = null;
  try { r = await ler(); if (await rmbRenovarSeExpirado(r)) r = await ler(); } catch (e) { r = null; }
  const d = r && r.ok ? await r.json().catch(() => null) : null;
  EMAIL_DONO = d ? ((d[0] && d[0].valor) || '') : null;
  return EMAIL_DONO || '';
}

function souODono() {
  const s = rmbSessao();
  return !!(s && s.email && EMAIL_DONO &&
            s.email.toLowerCase() === String(EMAIL_DONO).toLowerCase());
}

// ------------------------------------------------------------------
// 26/10/2026 (bloco 4): o login (o Plano e os Reembolsos usam) e a data curta (Fluxo, Contas a pagar, Pessoas).
// ------------------------------------------------------------------
// pref: prefixo dos ids dos campos. O modulo Plano usa os seus proprios
// ('plano'), porque os ids do Reembolsos existem em paralelo no documento e
// getElementById devolve o PRIMEIRO — quem abrisse Reembolsos e depois Plano
// mandaria credencial vazia (causa C de 21/08/2026).
// 29/10/2026 (dono): entra-se só com o nome — "rita" vira rita@cidadaodomundo.com.br; com @ segue como está
const emailDoLogin = (t) => { t = String(t || '').trim(); return !t || t.includes('@') ? t : t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase() + '@cidadaodomundo.com.br'; };
async function rmbFazerLogin(pref) {
  const idE = pref ? pref + 'Email' : 'rmbEmail';
  const idS = pref ? pref + 'Senha' : 'rmbSenha';
  const idR = pref ? pref + 'LoginErro' : 'rmbLoginErro';
  const campoE = document.getElementById(idE), campoS = document.getElementById(idS);
  if (!campoE || !campoS) return false;
  const email = emailDoLogin(campoE.value);
  const senha = campoS.value;
  const erroEl = document.getElementById(idR);
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
  const s = await r.json();
  if (!r.ok || !s.access_token) {
    if (erroEl) {
      erroEl.textContent = 'Não deu: ' + (s.error_description || s.msg || 'e-mail ou senha errados, ou usuário ainda não criado no Supabase (ver rotinas/REEMBOLSOS-PAINEL.md).');
      erroEl.style.display = 'block';
    }
    return false;
  }
  localStorage.setItem('rmbSessao', JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token,
    email: (s.user && s.user.email) || email,
    expira_em: Date.now() + ((s.expires_in || 3600) * 1000),
  }));
  // NAO redesenha modulo nenhum: quem chamou decide o que fazer. Antes daqui
  // saia um renderModuloReembolsos(REEMBOLSOS) que explodia quando o login vinha
  // do modulo Plano (REEMBOLSOS ainda null), matando a funcao DEPOIS de salvar a
  // sessao — o login funcionava e a tela nunca ficava sabendo (21/08/2026).
  return true;
}
function ffDdmm(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '—'; }

// 30/10/2026 (dono): botão Ajuda também na página aberta fora da casca; na casca ele fica na barra do topo
(function () {
  try {
    if (typeof NA_CASCA === 'undefined' || NA_CASCA || !document.currentScript) return;
    const s = document.createElement('script');
    s.src = new URL('ajuda.js?v=20261030b', document.currentScript.src).href;
    document.head.appendChild(s);
  } catch (e) {}
})();
