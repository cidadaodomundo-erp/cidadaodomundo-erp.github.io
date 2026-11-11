/* Manutenção e Quem conserta — camada de tela. Chamados: só campos preparados e desabilitados (nada é enviado ou salvo).
 * Quem conserta: consulta (GET) do cadastro de prestadores que já existe no ERP, diretório geral (sem loja).
 * Depende de nucleo.js (rmbSessao, trFetch), loja.js (lojaCarregar, lojaAtual, aoMudarLoja, lojaNome),
 * manutencao-modelo.js, manutencao-dados.js e de NA_CASCA / avisarCasca definidos no index.html.
 * Sem innerHTML, sem timers, sem armazenamento de dados. O único acesso a rmbSessao é para ler o e-mail (identidade)
 * e, num 401 que sobrou depois da renovação, encerrar a sessão da MESMA conta que fez a leitura.
 * Só a aba Quem conserta consulta o ERP; a aba Chamados só mostra a loja escolhida (precisa da lista de lojas). */
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
    LOJAS_OK = false; PENDENTE = false; LOJA = null;
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
      LOJA = typeof lojaAtual === 'function' ? lojaAtual() : null;
      desenhar();
    });
  }

  function aoLoja() {
    if (BLOQUEIO || !LOJAS_OK) return;
    if (!emailAtual() || emailAtual() !== IDENT) { guarda(); return; }
    LOJA = typeof lojaAtual === 'function' ? lojaAtual() : null;
    desenhar();
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
      aoLoja();
      return;
    }
    if (PENDENTE || LEIT.fase === 'inicial') { PENDENTE = false; carregarPrest(); }
  }

  // ------------------------------------------------------------------ desenho
  function limparDom() {
    ['listaPrest', 'statusPrest', 'fontePrest', 'statusGeral', 'lojaInfo', 'campoLoja'].forEach(function (id) { limpar($(id)); });
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

  // Chamados: só mostra a loja escolhida no seletor do topo. Nada é gravado.
  function desenharChamados() {
    var sel = $('campoLoja'), info = $('lojaInfo');
    limpar(sel); limpar(info);
    var nome = LOJA ? rotuloLoja(LOJA) : null;
    var o = el('option', null, nome || 'Sem loja cadastrada para esta conta');
    o.value = '';
    sel.appendChild(o);
    info.appendChild(el('p', 'mn-nota', nome
      ? 'Loja escolhida no seletor do topo: ' + nome + '. Ela só aparece aqui; nenhum chamado é gravado.'
      : 'O cadastro de loja desta conta ainda está pendente. Nenhum chamado é gravado.'));
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
    fonte.appendChild(el('p', 'mn-fonte', 'Fonte: Cadastro de prestadores do portal novo · consultado em ' + carimbo() + '.'));
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
      lista.appendChild(el('p', 'mn-estado', 'Nenhum prestador ativo no Cadastro de prestadores do portal novo (consulta de ' + carimbo() + ').'));
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
