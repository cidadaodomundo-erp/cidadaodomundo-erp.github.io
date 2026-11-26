/* Manutenção e Quem conserta — camada de tela. Pedidos de manutenção (24/11/2026): abre pedido, lista os abertos e marca
 * em andamento / resolvido / cancelado, só pelas funções erp_manutencao_* do ERP (elas conferem tela e loja da conta).
 * Quem conserta: consulta (GET) do cadastro de prestadores que já existe no ERP, diretório geral (sem loja).
 * Depende de nucleo.js (rmbSessao, trFetch), loja.js (lojaCarregar, lojaAtual, aoMudarLoja, lojaNome),
 * manutencao-modelo.js, manutencao-dados.js e de NA_CASCA / avisarCasca definidos no index.html.
 * Sem innerHTML, sem timers, sem armazenamento de dados. O único acesso a rmbSessao é para ler o e-mail (identidade)
 * e, num 401 que sobrou depois da renovação, encerrar a sessão da MESMA conta que fez a leitura.
 * A aba Chamados (Pedidos) precisa da lista de lojas. */
(function () {
  'use strict';
  var M = window.ModeloManutencao;
  var DD = null;
  var $ = function (id) { return document.getElementById(id); };

  var ABAS = ['chamados', 'prestadores'];
  var IDENT = null;            // e-mail normalizado da conta com que a página abriu
  var BLOQUEIO = null;         // { tipo: 'sem' | 'troca', texto } — tela travada
  var INICIADO = false;
  var LOJAS_OK = false;        // true só depois da lista de lojas (lojaCarregar) válida; só a aba Chamados precisa
  var LOJAS_FALHA = false;     // lojaCarregar falhou: não é "lista vazia"
  var CARREGANDO_LOJAS = false;
  var SEQ_LOJAS = 0;
  var PENDENTE = false;        // houve leitura pulada porque a tela estava oculta
  var ABA = 'chamados';
  var LOJA = null;             // loja que a aba Chamados está mostrando
  var FILTRO = { texto: '', setor: '' };
  var LEIT = novaLeitura();
  var LOJAS_LISTA = [];        // lojas da conta (sem 'REDE'), para escolher onde abrir o pedido quando o topo está na Rede
  var PED = { gen: 0, fase: 'inicial', lista: [], quando: null, msg: null, enviando: false };
  var PRIOR = [['urgente', 'Urgente'], ['alta', 'Alta'], ['media', 'Média'], ['baixa', 'Baixa']];
  var SIT = { aberto: 'Aberto', em_andamento: 'Em andamento', resolvido: 'Resolvido', cancelado: 'Cancelado' };

  function novaLeitura() { return { gen: 0, fase: 'inicial', dados: null, quando: null }; }

  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function limpar(e) { e.textContent = ''; }

  // ------------------------------------------------------------------ identidade e visibilidade
  function emailAtual() {
    var s = typeof rmbSessao === 'function' ? rmbSessao() : null;
    return s && typeof s.email === 'string' && s.email.trim() ? s.email.trim().toLowerCase() : null;
  }
  // Tela visível = aba do navegador em primeiro plano E nenhuma moldura (iframe) ancestral escondida.
  function telaVisivel() {
    try { if (document.hidden) return false; } catch (e) { /* segue */ }
    try {
      var w = window;
      for (var i = 0; i < 8; i++) {
        var f = w.frameElement;
        if (f && f.hidden) return false;
        if (!w.parent || w.parent === w) break;
        w = w.parent;
      }
    } catch (e) { /* sem acesso à moldura: segue só com o documento */ }
    return true;
  }
  function pedirLogin(recado) {
    if (typeof NA_CASCA !== 'undefined' && NA_CASCA) {
      if (typeof avisarCasca === 'function') avisarCasca({ tipo: 'casca-login', recado: recado });
    } else {
      location.href = '../sistema.html';
    }
  }
  function rotuloLoja(l) { return typeof lojaNome === 'function' ? (lojaNome(l) || l) : l; }

  // A aba atual tem o que precisa para mostrar conteúdo? Quem conserta só precisa de sessão; Chamados precisa das lojas.
  function pronto() { return ABA === 'prestadores' ? true : LOJAS_OK; }

  /* Confere a identidade a cada ponto de decisão. Outra conta ou sem sessão: apaga dados e DOM ANTES de qualquer outra
   * coisa e trava. Mesma conta (renovação de token) não muda nada. Nunca mexe no armazenamento da sessão. */
  function guarda() {
    var e = emailAtual();
    if (!e) {
      if (!BLOQUEIO || BLOQUEIO.tipo !== 'sem') {
        bloquear('sem', 'Sem sessão. Entre para ver Manutenção e Quem conserta. Os dados desta tela foram descartados.');
        if (INICIADO) pedirLogin('Entre de novo para ver Manutenção e Quem conserta.');
      }
      return false;
    }
    if (IDENT && e !== IDENT) {
      if (!BLOQUEIO || BLOQUEIO.tipo !== 'troca') bloquear('troca', 'A sessão mudou para outro usuário. Os dados desta tela foram descartados. Recarregue a tela para continuar.');
      return false;
    }
    return !BLOQUEIO && pronto();
  }

  function descartarTudo() {
    var g = LEIT.gen + 1; LEIT = novaLeitura(); LEIT.gen = g;
    SEQ_LOJAS++;
    CARREGANDO_LOJAS = false;
  }
  function bloquear(tipo, texto) {
    descartarTudo();
    PED = { gen: PED.gen + 1, fase: 'inicial', lista: [], quando: null, msg: null, enviando: false };
    LOJAS_OK = false; PENDENTE = false; LOJA = null; LOJAS_LISTA = [];
    BLOQUEIO = { tipo: tipo, texto: texto };
    FILTRO = { texto: '', setor: '' };
    desenhar();
  }

  // ------------------------------------------------------------------ leitura do diretório
  /* Uma leitura vale só se: mesma geração, mesma conta, aba Quem conserta ativa, tela visível e sem bloqueio. */
  function criarVigente(gen, ident) {
    return function () {
      if (BLOQUEIO) return false;
      if (LEIT.gen !== gen) return false;
      if (emailAtual() !== ident) { guarda(); return false; }
      if (ABA !== 'prestadores') return false;
      if (!telaVisivel()) { PENDENTE = true; return false; }
      return true;
    };
  }

  async function carregarPrest(forcar) {
    if (ABA !== 'prestadores' || !guarda()) return;
    if (!forcar && LEIT.fase !== 'inicial') return;
    if (!telaVisivel()) { PENDENTE = true; return; }
    var ident = IDENT;
    LEIT.gen++;
    var gen = LEIT.gen;
    LEIT.fase = 'carregando'; LEIT.dados = null; LEIT.quando = null;
    desenhar();
    var vig = criarVigente(gen, ident);
    var r;
    try { r = await DD.ler(vig); } catch (e) { r = { fase: 'pronto', resultado: { estado: 'falha' } }; }
    if (LEIT.gen !== gen) return;                            // contexto trocado durante o await: resposta/erro antigo some
    if (r.fase === 'descartado' || !vig()) {
      if (LEIT.gen === gen && !BLOQUEIO) { LEIT.fase = 'inicial'; desenhar(); }   // escondida/aba trocada no meio: relê quando voltar
      return;
    }
    if (r.fase === 'sessao') { sessaoRecusada(ident); return; }
    var res = r.resultado || { estado: 'falha' };
    LEIT.quando = Date.now();
    if (res.estado === 'ok' || res.estado === 'parcial') { LEIT.fase = res.estado; LEIT.dados = res; }
    else if (res.estado === 'naoliberada') LEIT.fase = 'naoliberada';
    else LEIT.fase = 'falha';
    desenhar();
  }

  /* 401 que sobrou depois da renovação do núcleo. Só encerra a sessão se a conta ainda é a que fez a leitura:
   * erro atrasado de A nunca remove a sessão de B. */
  function sessaoRecusada(ident) {
    if (emailAtual() !== ident) { guarda(); return; }
    try { localStorage.removeItem('rmbSessao'); } catch (e) { /* segue */ }
    bloquear('sem', 'Sua sessão foi encerrada. Entre de novo. Os dados desta tela foram descartados.');
    pedirLogin('Entre de novo para ver Manutenção e Quem conserta.');
  }

  // ------------------------------------------------------------------ lojas (só a aba Chamados)
  function carregarLojas() {
    if (CARREGANDO_LOJAS || BLOQUEIO || LOJAS_OK) return;
    guarda();                                                // identidade primeiro: pode travar a tela
    if (BLOQUEIO || !emailAtual()) return;
    if (!telaVisivel()) { PENDENTE = true; return; }
    CARREGANDO_LOJAS = true; LOJAS_FALHA = false;
    var seq = ++SEQ_LOJAS, ident = IDENT;
    desenhar();
    var p = typeof lojaCarregar === 'function' ? Promise.resolve().then(function () { return lojaCarregar(); }).catch(function () { return null; }) : Promise.resolve(null);
    p.then(function (info) {
      if (seq !== SEQ_LOJAS) return;
      CARREGANDO_LOJAS = false;
      if (emailAtual() !== ident) { guarda(); return; }       // logout/troca durante a carga: trava, nunca fica oculta sem aviso
      if (BLOQUEIO) return;
      if (!info || !Array.isArray(info.lojas)) { LOJAS_FALHA = true; desenhar(); return; }   // falha NÃO é lista vazia
      LOJAS_OK = true;
      LOJAS_LISTA = info.lojas.filter(function (l) { return l && l !== 'REDE'; });
      LOJA = typeof lojaAtual === 'function' ? lojaAtual() : null;
      desenhar();
      carregarPedidos();
    });
  }

  function aoLoja() {
    if (BLOQUEIO || !LOJAS_OK) return;
    if (!emailAtual() || emailAtual() !== IDENT) { guarda(); return; }
    LOJA = typeof lojaAtual === 'function' ? lojaAtual() : null;
    desenhar();
    carregarPedidos(true);
  }

  // ------------------------------------------------------------------ pedidos de manutenção
  async function rpc(fn, args) {
    var r;
    try { r = await trFetch('rpc/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) }); }
    catch (e) { return { ok: false, status: 0, msg: 'Sem conexão agora.' }; }
    if (r.status === 401) return { ok: false, status: 401 };
    var j = null;
    try { j = await r.json(); } catch (e) { j = null; }
    if (!r.ok) return { ok: false, status: r.status, msg: (j && (j.message || j.hint)) || ('Erro ' + r.status) };
    return { ok: true, dados: j };
  }

  async function carregarPedidos(forcar) {
    if (ABA !== 'chamados' || !LOJAS_OK || BLOQUEIO) return;
    if (!forcar && PED.fase !== 'inicial') return;
    if (!telaVisivel()) { PENDENTE = true; return; }
    var ident = IDENT, gen = ++PED.gen;
    PED.fase = 'carregando'; desenharPedidos();
    var r = await rpc('erp_manutencao_pedidos_ler', { p_loja: LOJA || null });
    if (gen !== PED.gen || BLOQUEIO) return;
    if (emailAtual() !== ident) { guarda(); return; }
    if (!r.ok && r.status === 401) { sessaoRecusada(ident); return; }
    PED.quando = Date.now();
    if (!r.ok) { PED.fase = r.status === 403 || /acesso/.test(r.msg || '') ? 'naoliberada' : 'falha'; PED.lista = []; PED.msg = r.msg || null; }
    else { PED.fase = 'ok'; PED.lista = (r.dados && Array.isArray(r.dados.pedidos)) ? r.dados.pedidos : []; }
    desenharPedidos();
  }

  async function abrirPedido() {
    if (!guarda() || PED.enviando) return;
    var loja = LOJA && LOJA !== 'REDE' ? LOJA : $('campoLoja').value;
    var eq = ($('campoLocal').value || '').trim(), pb = ($('campoProblema').value || '').trim(), pr = $('campoPrioridade').value || 'media';
    var st = $('statusEnvio'); limpar(st);
    if (!loja) { st.appendChild(el('p', 'mn-estado mn-erro', 'Escolha a loja.')); return; }
    if (!eq || !pb) { st.appendChild(el('p', 'mn-estado mn-erro', 'Preencha o que precisa arrumar e qual é o problema.')); return; }
    PED.enviando = true; $('btnAbrir').disabled = true;
    st.appendChild(el('p', 'mn-estado', 'Enviando…'));
    var ident = IDENT;
    var r = await rpc('erp_manutencao_pedido_abrir', { p_loja: loja, p_equipamento: eq, p_problema: pb, p_prioridade: pr });
    PED.enviando = false; $('btnAbrir').disabled = false;
    if (emailAtual() !== ident) { guarda(); return; }
    if (!r.ok && r.status === 401) { sessaoRecusada(ident); return; }
    limpar(st);
    if (!r.ok) { st.appendChild(el('p', 'mn-estado mn-erro', 'Não foi possível abrir o pedido: ' + (r.msg || 'erro') + '.')); return; }
    $('campoLocal').value = ''; $('campoProblema').value = ''; $('campoPrioridade').value = 'media';
    st.appendChild(el('p', 'mn-estado mn-ok', 'Pedido nº ' + r.dados + ' aberto para ' + rotuloLoja(loja) + '.'));
    carregarPedidos(true);
  }

  async function mudarSituacao(id, sit) {
    if (!guarda() || PED.enviando) return;
    PED.enviando = true;
    var ident = IDENT;
    var r = await rpc('erp_manutencao_pedido_situacao', { p_id: id, p_situacao: sit });
    PED.enviando = false;
    if (emailAtual() !== ident) { guarda(); return; }
    if (!r.ok && r.status === 401) { sessaoRecusada(ident); return; }
    if (!r.ok) { var st = $('statusEnvio'); limpar(st); st.appendChild(el('p', 'mn-estado mn-erro', 'Não foi possível mudar o pedido nº ' + id + ': ' + (r.msg || 'erro') + '.')); return; }
    carregarPedidos(true);
  }

  /* Retoma o que foi pulado (tela oculta) e revalida a identidade. Nunca lê nada por conta própria enquanto oculta. */
  function retomar() {
    if (!INICIADO) return;
    guarda();
    if (BLOQUEIO || !emailAtual() || !telaVisivel()) return;
    if (ABA === 'chamados') {
      // lojas ainda não carregadas: só retoma o que foi pulado por tela oculta; falha de lojas pede o botão (sem repetição sozinha)
      if (!LOJAS_OK) { if (PENDENTE && !LOJAS_FALHA) { PENDENTE = false; carregarLojas(); } return; }
      PENDENTE = false;
      if (PED.fase === 'inicial') carregarPedidos(); else aoLoja();
      return;
    }
    if (PENDENTE || LEIT.fase === 'inicial') { PENDENTE = false; carregarPrest(); }
  }

  // ------------------------------------------------------------------ desenho
  function limparDom() {
    ['listaPrest', 'statusPrest', 'fontePrest', 'statusGeral', 'lojaInfo', 'campoLoja', 'listaPed', 'statusPed', 'statusEnvio'].forEach(function (id) { limpar($(id)); });
    $('buscaTexto').value = '';
    limpar($('filtroSetor'));
    $('filtroSetor').value = '';
  }

  function botaoRetentar(box, rotulo, fn) {
    var b = el('button', 'mn-btn', rotulo || 'Tentar de novo');
    b.type = 'button';
    b.addEventListener('click', fn);
    box.appendChild(b);
  }

  function desenhar() {
    var bloq = $('bloqueio');
    limpar(bloq);
    bloq.hidden = !BLOQUEIO;
    var visivelApp = !BLOQUEIO && pronto();
    $('app').hidden = !visivelApp;
    $('btnAtualizar').hidden = ABA !== 'prestadores';
    $('btnAtualizar').disabled = !visivelApp;
    if (BLOQUEIO) {
      limparDom();
      bloq.appendChild(el('p', null, BLOQUEIO.texto));
      var b = el('button', 'mn-btn', 'Recarregar a tela');
      b.type = 'button';
      b.addEventListener('click', function () { location.reload(); });
      bloq.appendChild(b);
      return;
    }
    desenharGeral();
    if (!visivelApp) return;
    ABAS.forEach(function (a) {
      var ativa = a === ABA;
      var tab = $(a === 'chamados' ? 'abaChamados' : 'abaPrestadores');
      tab.setAttribute('aria-selected', ativa ? 'true' : 'false');
      tab.className = 'mn-aba' + (ativa ? ' on' : '');
      $(a === 'chamados' ? 'painelChamados' : 'painelPrestadores').hidden = !ativa;
    });
    if (ABA === 'chamados') desenharChamados(); else desenharPrest();
  }

  function desenharGeral() {
    var box = $('statusGeral');
    limpar(box);
    if (pronto()) return;
    if (LOJAS_FALHA) {
      box.appendChild(el('p', 'mn-estado mn-erro', 'Não foi possível carregar as lojas autorizadas agora. Isto não quer dizer que a conta não tenha lojas.'));
      botaoRetentar(box, 'Tentar de novo', function () { LOJAS_FALHA = false; carregarLojas(); });
    } else if (CARREGANDO_LOJAS) {
      box.appendChild(el('p', 'mn-estado', 'Carregando as lojas autorizadas…'));
    } else {
      box.appendChild(el('p', 'mn-estado', 'A tela começa quando estiver visível.'));
    }
  }

  // Pedidos: o formulário abre pedido na loja do topo (ou na loja escolhida, quando o topo está na Rede).
  function desenharChamados() {
    var sel = $('campoLoja'), info = $('lojaInfo');
    limpar(sel); limpar(info);
    var naRedeTopo = LOJA === 'REDE';
    if (!LOJA) {
      var o = el('option', null, 'Sem loja cadastrada para esta conta'); o.value = ''; sel.appendChild(o);
      sel.disabled = true;
      info.appendChild(el('p', 'mn-nota', 'O cadastro de loja desta conta ainda está pendente. Sem loja, não dá para abrir pedido.'));
    } else if (naRedeTopo) {
      var o0 = el('option', null, 'Escolha a loja'); o0.value = ''; sel.appendChild(o0);
      LOJAS_LISTA.forEach(function (l) { var x = el('option', null, rotuloLoja(l)); x.value = l; sel.appendChild(x); });
      sel.disabled = false;
      info.appendChild(el('p', 'mn-nota', 'O topo está em Rede: a lista mostra os pedidos de todas as suas lojas.'));
    } else {
      var o1 = el('option', null, rotuloLoja(LOJA)); o1.value = LOJA; sel.appendChild(o1);
      sel.disabled = true;
      info.appendChild(el('p', 'mn-nota', 'Loja escolhida no seletor do topo: ' + rotuloLoja(LOJA) + '.'));
    }
    $('btnAbrir').disabled = !LOJA || PED.enviando;
    desenharPedidos();
  }

  function desenharPedidos() {
    var lista = $('listaPed'), status = $('statusPed');
    if (!lista || !status) return;
    limpar(lista); limpar(status);
    var f = PED.fase;
    if (f === 'inicial') return;
    if (f === 'carregando') { status.appendChild(el('p', 'mn-estado', 'Carregando os pedidos…')); return; }
    if (f === 'naoliberada') { status.appendChild(el('p', 'mn-estado mn-aviso', 'Esta conta ainda não tem acesso aos pedidos de manutenção.')); return; }
    if (f === 'falha') {
      status.appendChild(el('p', 'mn-estado mn-erro', 'Não foi possível ler os pedidos agora. Isto não quer dizer que não haja pedidos.'));
      botaoRetentar(status, 'Tentar de novo', function () { carregarPedidos(true); });
      return;
    }
    status.appendChild(el('p', 'mn-fonte', 'Fonte: pedidos de manutenção deste sistema · consultado em ' + (PED.quando ? M.formatarDataHora(PED.quando) : '—') + '.'));
    var abertos = PED.lista.filter(function (p) { return p.situacao === 'aberto' || p.situacao === 'em_andamento'; });
    var fechados = PED.lista.filter(function (p) { return !(p.situacao === 'aberto' || p.situacao === 'em_andamento'); });
    lista.appendChild(el('h2', 'mn-sub', 'Para arrumar (' + abertos.length + ')'));
    if (!abertos.length) lista.appendChild(el('p', 'mn-estado', 'Nenhum pedido aberto. 👍'));
    abertos.forEach(function (p) { lista.appendChild(cartaoPedido(p, true)); });
    if (fechados.length) {
      lista.appendChild(el('h2', 'mn-sub', 'Resolvidos ou cancelados nos últimos 30 dias (' + fechados.length + ')'));
      fechados.forEach(function (p) { lista.appendChild(cartaoPedido(p, false)); });
    }
  }

  function quando(iso) { var t = Date.parse(iso); return isFinite(t) ? M.formatarDataHora(t) : '—'; }
  function cartaoPedido(p, aberto) {
    var card = el('article', 'mn-card mn-ped mn-pr-' + (p.prioridade || 'media'));
    card.appendChild(el('h3', 'mn-nome', '#' + p.id + ' · ' + (p.equipamento || '—')));
    card.appendChild(el('p', 'mn-problema', p.problema || ''));
    var dl = el('dl', 'mn-dados');
    var pr = PRIOR.filter(function (x) { return x[0] === p.prioridade; })[0];
    [['Loja', rotuloLoja(p.loja)], ['Prioridade', pr ? pr[1] : p.prioridade], ['Situação', SIT[p.situacao] || p.situacao],
     ['Aberto', quando(p.aberto_em) + (p.aberto_por ? ' · ' + String(p.aberto_por).split('@')[0] : '')]]
      .concat(p.resolvido_em ? [['Resolvido', quando(p.resolvido_em) + (p.resolvido_por ? ' · ' + String(p.resolvido_por).split('@')[0] : '')]] : [])
      .forEach(function (par) {
        var g = el('div', 'mn-par'); g.appendChild(el('dt', null, par[0])); g.appendChild(el('dd', null, par[1] || '—')); dl.appendChild(g);
      });
    card.appendChild(dl);
    var acoes = el('div', 'mn-acoes');
    var botoes = aberto
      ? (p.situacao === 'aberto' ? [['em_andamento', 'Já estão vendo']] : []).concat([['resolvido', '✔ Arrumado'], ['cancelado', 'Cancelar']])
      : [['aberto', 'Reabrir']];
    botoes.forEach(function (b) {
      var x = el('button', 'mn-btn' + (b[0] === 'resolvido' ? ' mn-btn-ok' : ''), b[1]); x.type = 'button';
      x.addEventListener('click', function () { mudarSituacao(p.id, b[0]); });
      acoes.appendChild(x);
    });
    card.appendChild(acoes);
    return card;
  }

  function carimbo() { return LEIT.quando ? M.formatarDataHora(LEIT.quando) : '—'; }

  function desenharPrest() {
    var lista = $('listaPrest'), status = $('statusPrest'), fonte = $('fontePrest'), sel = $('filtroSetor');
    limpar(lista); limpar(status); limpar(fonte);
    var f = LEIT.fase;
    var vazioSel = function () { limpar(sel); sel.value = ''; };
    if (f === 'inicial') { status.appendChild(el('p', 'mn-estado', 'A consulta começa quando esta tela estiver visível.')); vazioSel(); return; }
    if (f === 'carregando') { status.appendChild(el('p', 'mn-estado', 'Carregando os prestadores…')); vazioSel(); return; }
    if (f === 'naoliberada') {
      status.appendChild(el('p', 'mn-estado mn-aviso', 'A consulta de prestadores ainda não foi liberada. Nenhum dado foi lido.'));
      botaoRetentar(status, 'Tentar de novo', function () { carregarPrest(true); });
      vazioSel(); return;
    }
    if (f === 'falha') {
      status.appendChild(el('p', 'mn-estado mn-erro', 'Não foi possível consultar os prestadores agora (conexão ou serviço). Isto não quer dizer que não existam prestadores.'));
      botaoRetentar(status, 'Tentar de novo', function () { carregarPrest(true); });
      vazioSel(); return;
    }
    // 'ok' | 'parcial'
    fonte.appendChild(el('p', 'mn-fonte', 'Fonte: Cadastro de prestadores deste sistema · consultado em ' + carimbo() + '.'));
    if (f === 'parcial') status.appendChild(el('p', 'mn-estado mn-aviso', 'Lista parcial: a consulta chegou ao limite de ' + (M.LIMITE_PAGINA * M.MAX_PAGINAS) + ' registros e pode haver mais prestadores que não aparecem aqui.'));
    var inv = LEIT.dados.avisos ? LEIT.dados.avisos.invalidas : 0;
    if (inv > 0) status.appendChild(el('p', 'mn-estado mn-aviso', inv + ' registro(s) com dados incompletos foram ignorados.'));
    var linhas = LEIT.dados.linhas;
    var setores = M.listarSetores(linhas), atual = FILTRO.setor;
    limpar(sel);
    var o0 = el('option', null, 'Todos os setores'); o0.value = ''; sel.appendChild(o0);
    var achou = false;
    setores.forEach(function (s) { var o = el('option', null, s.rotulo); o.value = s.valor; sel.appendChild(o); if (s.valor === atual) achou = true; });
    if (!achou) FILTRO.setor = '';
    sel.value = FILTRO.setor;
    if (!linhas.length) {
      lista.appendChild(el('p', 'mn-estado', 'Nenhum prestador ativo no Cadastro de prestadores deste sistema (consulta de ' + carimbo() + ').'));
      return;
    }
    var vis = M.filtrarPrestadores(linhas, FILTRO);
    lista.appendChild(el('p', 'mn-contagem', vis.length === linhas.length ? linhas.length + ' prestador(es)' : vis.length + ' de ' + linhas.length + ' prestador(es)'));
    if (!vis.length) { lista.appendChild(el('p', 'mn-estado', 'Nenhum prestador bate com a busca.')); return; }
    vis.forEach(function (c) {
      var card = el('article', 'mn-card');
      card.appendChild(el('h3', 'mn-nome', c.nome));
      var dl = el('dl', 'mn-dados');
      [['Setor', c.setor], ['Telefone', c.telefone]].forEach(function (par) {
        var grupo = el('div', 'mn-par');
        grupo.appendChild(el('dt', null, par[0]));
        grupo.appendChild(el('dd', null, par[1] || '—'));
        dl.appendChild(grupo);
      });
      card.appendChild(dl);
      lista.appendChild(card);
    });
  }

  // ------------------------------------------------------------------ navegação entre as abas
  function irParaAba(a) {
    if (ABAS.indexOf(a) < 0) return;
    ABA = a;
    guarda();
    if (BLOQUEIO || !emailAtual()) return;
    desenhar();
    if (a === 'prestadores') carregarPrest();
    else if (!LOJAS_OK) { if (telaVisivel()) carregarLojas(); else PENDENTE = true; }
    else carregarPedidos();
  }
  /* Dentro da casca cada aba é uma rota da própria casca: o pedido vai por mensagem (a casca valida o nome contra o menu).
   * Fora da casca troca a aba aqui mesmo. */
  function clicarAba(a) {
    if (a === ABA) return;
    if (typeof NA_CASCA !== 'undefined' && NA_CASCA) {
      if (typeof avisarCasca === 'function') avisarCasca({ tipo: 'casca-modulo', nome: a === 'prestadores' ? 'prestadores' : 'manutencao' });
      return;
    }
    try { location.hash = a; } catch (e) { /* segue */ }
    irParaAba(a);
  }

  function iniciar() {
    DD = window.ManutencaoDados.criar({
      trFetch: function (u, o) { return trFetch(u, o); },
      modelo: M
    });
    $('abaChamados').addEventListener('click', function () { clicarAba('chamados'); });
    $('abaPrestadores').addEventListener('click', function () { clicarAba('prestadores'); });
    $('btnQuemConserta').addEventListener('click', function () { clicarAba('prestadores'); });
    $('btnAbrir').addEventListener('click', abrirPedido);
    $('btnAtualizarPed').addEventListener('click', function () { if (guarda()) carregarPedidos(true); });
    $('btnAtualizar').addEventListener('click', function () { if (guarda()) carregarPrest(true); });
    $('buscaTexto').addEventListener('input', function () {
      if (!guarda()) return;
      FILTRO.texto = $('buscaTexto').value;
      desenharPrest();
    });
    $('filtroSetor').addEventListener('change', function () {
      if (!guarda()) return;
      FILTRO.setor = $('filtroSetor').value;
      desenharPrest();
    });
    if (typeof aoMudarLoja === 'function') aoMudarLoja(aoLoja);

    window.addEventListener('storage', function (ev) { if (ev.key === null || ev.key === 'rmbSessao') retomar(); });
    window.addEventListener('focus', retomar);
    window.addEventListener('pageshow', retomar);
    window.addEventListener('resize', retomar);              // a moldura da casca muda de tamanho ao aparecer
    window.addEventListener('hashchange', function () { if (!(typeof NA_CASCA !== 'undefined' && NA_CASCA)) irParaAba(M.abaDoHash(location.hash)); });
    document.addEventListener('visibilitychange', retomar);

    ABA = M.abaDoHash(location.hash);
    $('app').hidden = true;
    IDENT = emailAtual();
    INICIADO = true;
    if (!IDENT) {
      bloquear('sem', 'Sem sessão. Entre para ver Manutenção e Quem conserta.');
      pedirLogin('Entre para ver Manutenção e Quem conserta.');
      return;
    }
    if (typeof NA_CASCA !== 'undefined' && NA_CASCA && typeof avisarCasca === 'function') avisarCasca({ tipo: 'casca-modulo', nome: ABA === 'prestadores' ? 'prestadores' : 'manutencao' });
    desenhar();
    if (!telaVisivel()) { PENDENTE = true; return; }          // oculta ao abrir: nada de rede até a tela voltar
    if (ABA === 'prestadores') carregarPrest(); else carregarLojas();
  }

  window.reentrarTela = retomar;     // a casca chama ao reabrir a moldura: revalida e retoma só o que foi pulado
  window.ManutencaoTela = { iniciar: iniciar };
})();
