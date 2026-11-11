/* Páginas "Em construção" (Cozinha, TVs, Salão, Mercado Livre, Encomendas). Cada página passa só a sua configuração
 * (título, aviso, campos, atalhos). Os campos ficam num fieldset desabilitado: nada é lido, enviado ou salvo daqui.
 * Depende de nucleo.js (rmbSessao), loja.js (lojaCarregar, lojaAtual, aoMudarLoja, lojaNome) e de NA_CASCA / avisarCasca
 * definidos no index.html. Sem innerHTML, sem timers, sem armazenamento, sem fetch próprio.
 * A única consulta é a lista de lojas autorizadas (lojaCarregar), uma por vez; resposta que chega depois de logout ou
 * troca de conta é descartada. */
(function () {
  'use strict';
  var CFG = null;
  var $ = function (id) { return document.getElementById(id); };

  var IDENT = null;          // e-mail normalizado da conta com que a página abriu
  var BLOQUEIO = null;       // texto do bloqueio ('sem' sessão ou 'troca' de conta)
  var INICIADO = false;
  var LOJAS_OK = false;
  var LOJAS_FALHA = false;   // falha ao carregar não é "lista vazia"
  var CARREGANDO = false;
  var SEQ = 0;
  var PENDENTE = false;      // carga pulada porque a tela estava oculta
  var LOJA = null;

  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function limpar(e) { e.textContent = ''; }
  function naCasca() { return typeof NA_CASCA !== 'undefined' && NA_CASCA; }

  function emailAtual() {
    var s = typeof rmbSessao === 'function' ? rmbSessao() : null;
    return s && typeof s.email === 'string' && s.email.trim() ? s.email.trim().toLowerCase() : null;
  }
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
    if (naCasca()) { if (typeof avisarCasca === 'function') avisarCasca({ tipo: 'casca-login', recado: recado }); }
    else location.href = '../sistema.html';
  }
  function rotuloLoja(l) { return typeof lojaNome === 'function' ? (lojaNome(l) || l) : l; }

  /* Confere a identidade a cada ponto de decisão. Sem sessão ou outra conta: descarta o DOM e trava.
   * Mesma conta (renovação de token) não muda nada. Nunca mexe no armazenamento da sessão. */
  function guarda() {
    var e = emailAtual();
    if (!e) {
      if (!BLOQUEIO) {
        bloquear('Sem sessão. Entre para ver esta tela. Os dados desta tela foram descartados.');
        if (INICIADO) pedirLogin('Entre de novo para ver ' + CFG.titulo + '.');
      }
      return false;
    }
    if (IDENT && e !== IDENT) {
      if (!BLOQUEIO) bloquear('A sessão mudou para outro usuário. Os dados desta tela foram descartados. Recarregue a tela para continuar.');
      return false;
    }
    return !BLOQUEIO;
  }
  function bloquear(texto) {
    SEQ++; CARREGANDO = false; LOJAS_OK = false; LOJAS_FALHA = false; PENDENTE = false; LOJA = null;
    BLOQUEIO = texto;
    desenhar();
  }

  function carregarLojas() {
    if (CARREGANDO || BLOQUEIO || LOJAS_OK) return;
    guarda();
    if (BLOQUEIO || !emailAtual()) return;
    if (!telaVisivel()) { PENDENTE = true; return; }
    CARREGANDO = true; LOJAS_FALHA = false;
    var seq = ++SEQ, ident = IDENT;
    desenhar();
    var p = typeof lojaCarregar === 'function'
      ? Promise.resolve().then(function () { return lojaCarregar(); }).catch(function () { return null; })
      : Promise.resolve(null);
    p.then(function (info) {
      if (seq !== SEQ) return;                                // contexto trocado durante o await: resposta antiga some
      CARREGANDO = false;
      if (emailAtual() !== ident) { guarda(); return; }       // logout/troca durante a carga: trava com aviso
      if (BLOQUEIO) return;
      if (!info || !Array.isArray(info.lojas)) { LOJAS_FALHA = true; LOJA = null; desenhar(); return; }
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

  function retomar() {
    if (!INICIADO) return;
    guarda();
    if (BLOQUEIO || !emailAtual() || !telaVisivel()) return;
    if (!LOJAS_OK) { if (PENDENTE && !LOJAS_FALHA) { PENDENTE = false; carregarLojas(); } return; }
    PENDENTE = false;
    aoLoja();
  }

  // ------------------------------------------------------------------ desenho
  function abrirAtalho(chave) {
    if (naCasca() && typeof avisarCasca === 'function') avisarCasca({ tipo: 'casca-modulo', nome: chave });
  }

  function campo(c, idx) {
    var id = 'oc-campo-' + idx;
    var lab = el('label', 'oc-campo');
    lab.setAttribute('for', id);
    lab.appendChild(el('span', 'oc-rot', c.r));
    var ctl;
    if (c.t === 'loja') {
      ctl = el('select');
      var nome = LOJA ? rotuloLoja(LOJA) : 'Loja não identificada';
      var o = el('option', null, nome); o.value = '';
      ctl.appendChild(o);
    } else if (c.t === 'select') {
      ctl = el('select');
      var o0 = el('option', null, c.o && c.o.length ? 'Escolher' : 'Ainda não ligado'); o0.value = '';
      ctl.appendChild(o0);
      (c.o || []).forEach(function (txt) { var op = el('option', null, txt); op.value = txt; ctl.appendChild(op); });
    } else {
      ctl = el('input');
      ctl.type = c.t || 'text';
      if (c.m) ctl.setAttribute('inputmode', c.m);
    }
    ctl.id = id;
    ctl.disabled = true;
    lab.appendChild(ctl);
    return lab;
  }

  function desenhar() {
    var bloq = $('bloqueio'), status = $('statusGeral'), app = $('app');
    limpar(bloq); limpar(status); limpar(app);
    bloq.hidden = !BLOQUEIO;
    app.hidden = true;
    if (BLOQUEIO) {
      bloq.appendChild(el('p', null, BLOQUEIO));
      var b = el('button', 'oc-btn', 'Recarregar a tela');
      b.type = 'button';
      b.addEventListener('click', function () { location.reload(); });
      bloq.appendChild(b);
      return;
    }
    if (!LOJAS_OK && !LOJAS_FALHA) {
      status.appendChild(el('p', 'oc-estado', CARREGANDO ? 'Carregando as lojas autorizadas…' : 'A tela começa quando estiver visível.'));
      return;
    }
    app.hidden = false;

    // 1) situação primeiro
    var aviso = el('div', 'oc-aviso');
    aviso.setAttribute('role', 'note');
    aviso.appendChild(el('strong', null, 'Em construção. '));
    aviso.appendChild(document.createTextNode(CFG.aviso));
    app.appendChild(aviso);
    (CFG.extras || []).forEach(function (t) { app.appendChild(el('p', 'oc-nota', t)); });
    if (LOJAS_FALHA) {
      var falha = el('div', 'oc-estado oc-erro');
      falha.appendChild(el('p', null, 'Loja não identificada: não foi possível carregar as lojas autorizadas agora. Isto não quer dizer que a conta não tenha lojas.'));
      var r = el('button', 'oc-btn', 'Tentar de novo');
      r.type = 'button';
      r.addEventListener('click', function () { LOJAS_FALHA = false; carregarLojas(); });
      falha.appendChild(r);
      app.appendChild(falha);
    } else if (!LOJA) {
      app.appendChild(el('p', 'oc-estado oc-erro', 'Loja não identificada: o cadastro de loja desta conta está pendente.'));
    }

    // 2) campos (desabilitados)
    app.appendChild(el('p', 'oc-nota', 'Campos preparados. O registro e o acompanhamento ainda não estão ligados.'));
    var fs = el('fieldset', 'oc-form');
    fs.disabled = true;
    fs.appendChild(el('legend', null, CFG.legenda));
    CFG.campos.forEach(function (c, i) { fs.appendChild(campo(c, i)); });
    app.appendChild(fs);
    if (CFG.camposFuturos && CFG.camposFuturos.length) {
      var fs2 = el('fieldset', 'oc-form');
      fs2.disabled = true;
      fs2.appendChild(el('legend', null, 'Mais adiante'));
      CFG.camposFuturos.forEach(function (c, i) { fs2.appendChild(campo(c, 100 + i)); });
      app.appendChild(fs2);
    }

    // 3) atalhos abaixo
    if (CFG.atalhos && CFG.atalhos.length) {
      var nav = el('nav', 'oc-atalhos');
      nav.setAttribute('aria-label', 'Telas relacionadas');
      CFG.atalhos.forEach(function (a) {
        var l = el('a', 'oc-btn', a.r);
        l.href = '../sistema.html#' + a.chave;
        l.target = '_blank';
        l.rel = 'noopener';
        l.addEventListener('click', function (ev) {
          if (naCasca()) { ev.preventDefault(); abrirAtalho(a.chave); }
        });
        nav.appendChild(l);
      });
      app.appendChild(nav);
    }
  }

  function iniciar(cfg) {
    CFG = cfg;
    if (typeof aoMudarLoja === 'function') aoMudarLoja(aoLoja);
    window.addEventListener('storage', function (ev) { if (ev.key === null || ev.key === 'rmbSessao') retomar(); });
    window.addEventListener('focus', retomar);
    window.addEventListener('pageshow', retomar);
    window.addEventListener('resize', retomar);              // a moldura da casca muda de tamanho ao aparecer
    document.addEventListener('visibilitychange', retomar);
    $('app').hidden = true;
    IDENT = emailAtual();
    INICIADO = true;
    if (!IDENT) {
      bloquear('Sem sessão. Entre para ver ' + CFG.titulo + '.');
      pedirLogin('Entre para ver ' + CFG.titulo + '.');
      return;
    }
    desenhar();
    if (!telaVisivel()) { PENDENTE = true; return; }          // oculta ao abrir: nada de rede até a tela voltar
    carregarLojas();
  }

  window.reentrarTela = retomar;     // a casca chama ao reabrir a moldura
  window.OperacaoConstrucao = { iniciar: iniciar };
})();
