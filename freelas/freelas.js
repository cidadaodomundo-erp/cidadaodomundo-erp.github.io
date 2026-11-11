/* Taxas e Freelas — camada de tela. Só consulta (GET) dos cadastros que já existem no ERP; nada é gravado.
 * Depende de nucleo.js (rmbSessao, registrarUso, trFetch), loja.js (lojaCarregar, lojaAtual, aoMudarLoja, lojaNome),
 * freelas-modelo.js, freelas-dados.js e de NA_CASCA / avisarCasca definidos no index.html.
 * Sem innerHTML, sem timers, sem localStorage de dados. O único acesso a rmbSessao é para ler o e-mail (identidade)
 * e, num 401 que sobrou depois da renovação, encerrar a sessão da MESMA conta que fez a leitura. */
(function () {
  'use strict';
  var M = window.ModeloFreelas;
  var DD = null;
  var $ = function (id) { return document.getElementById(id); };

  var IDENT = null;            // e-mail normalizado da conta com que a página abriu
  var BLOQUEIO = null;         // { tipo: 'sem' | 'troca', texto } — tela travada
  var INICIADO = false;
  var PRONTO = false;          // true só depois da allowlist (lojaCarregar) válida
  var LOJAS_FALHA = false;     // lojaCarregar falhou: não é "lista vazia"
  var CARREGANDO_LOJAS = false;
  var SEQ_LOJAS = 0;
  var PENDENTE = false;        // houve leitura pulada porque a tela estava oculta
  var USO_REGISTRADO = false;
  var ABA = 'contatos';
  var LOJA = null;             // loja do recorte vigente
  var FILTRO = { texto: '', setor: '' };
  var ABAS = ['contatos', 'valores'];
  var LEIT = { contatos: novaLeitura(), valores: novaLeitura() };

  function novaLeitura() { return { gen: 0, fase: 'inicial', dados: null, mensagem: '', loja: null, quando: null, retentar: false }; }

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

  /* Confere a identidade a cada ponto de decisão. Outra conta ou sem sessão: apaga dados e DOM ANTES de qualquer outra
   * coisa e trava. Mesma conta (renovação de token) não muda nada. Nunca mexe no armazenamento da sessão. */
  function guarda() {
    var e = emailAtual();
    if (!e) {
      if (!BLOQUEIO || BLOQUEIO.tipo !== 'sem') {
        bloquear('sem', 'Sem sessão. Entre para ver Taxas e Freelas. Os dados desta tela foram descartados.');
        if (INICIADO) pedirLogin('Entre de novo para ver Taxas e Freelas.');
      }
      return false;
    }
    if (IDENT && e !== IDENT) {
      if (!BLOQUEIO || BLOQUEIO.tipo !== 'troca') bloquear('troca', 'A sessão mudou para outro usuário. Os dados desta tela foram descartados. Recarregue a tela para continuar.');
      return false;
    }
    return !BLOQUEIO && PRONTO;
  }

  function descartarTudo() {
    ABAS.forEach(function (a) { var g = LEIT[a].gen + 1; LEIT[a] = novaLeitura(); LEIT[a].gen = g; });
    SEQ_LOJAS++;
    CARREGANDO_LOJAS = false;
  }
  function bloquear(tipo, texto) {
    descartarTudo();
    PRONTO = false; PENDENTE = false;
    BLOQUEIO = { tipo: tipo, texto: texto };
    FILTRO = { texto: '', setor: '' };
    desenhar();
  }

  // ------------------------------------------------------------------ leitura
  /* Uma leitura vale só se: mesma geração, mesma conta, mesma loja, tela visível e sem bloqueio. */
  function criarVigente(aba, gen, ident, loja) {
    return function () {
      if (BLOQUEIO || !PRONTO) return false;
      if (LEIT[aba].gen !== gen) return false;
      if (emailAtual() !== ident) { guarda(); return false; }
      if (typeof lojaAtual === 'function' && lojaAtual() !== loja) return false;
      if (!telaVisivel()) { PENDENTE = true; return false; }
      return true;
    };
  }

  async function carregarAba(aba, forcar) {
    if (!guarda()) return;
    var L = LEIT[aba];
    if (!forcar && L.fase !== 'inicial') return;
    if (!telaVisivel()) { PENDENTE = true; return; }
    var loja = typeof lojaAtual === 'function' ? lojaAtual() : null;
    var ident = IDENT;
    L.gen++;
    var gen = L.gen;
    L.fase = 'carregando'; L.dados = null; L.mensagem = ''; L.loja = loja; L.retentar = false; L.quando = null;
    desenhar();
    var vig = criarVigente(aba, gen, ident, loja);
    var r;
    try { r = await DD.ler(aba, vig); } catch (e) { r = { fase: 'falha' }; }
    if (LEIT[aba].gen !== gen) return;                       // contexto trocado durante o await: resposta/erro antigo some
    if (r.fase === 'descartado') {
      if (!BLOQUEIO) { L.fase = 'inicial'; desenhar(); }     // escondida no meio: relê quando voltar
      return;
    }
    if (!vig()) { if (LEIT[aba].gen === gen && !BLOQUEIO) { L.fase = 'inicial'; desenhar(); } return; }
    if (r.fase === 'sessao') { sessaoRecusada(ident); return; }
    if (r.fase === 'aviso') {
      L.fase = 'aviso'; L.mensagem = r.mensagem || ''; L.retentar = r.estado === 'falha_lojas';
      desenhar();
      return;
    }
    if (r.fase === 'pronto' && r.resultado) {
      var res = r.resultado;
      L.quando = Date.now();
      if (res.estado === 'ok' || res.estado === 'parcial') { L.fase = res.estado; L.dados = res; }
      else if (res.estado === 'naoliberada') L.fase = 'naoliberada';
      else L.fase = 'falha';
    } else L.fase = 'falha';
    desenhar();
  }

  /* 401 que sobrou depois da renovação do núcleo. Só encerra a sessão se a conta ainda é a que fez a leitura:
   * erro atrasado de A nunca remove a sessão de B. */
  function sessaoRecusada(ident) {
    if (emailAtual() !== ident) { guarda(); return; }
    try { localStorage.removeItem('rmbSessao'); } catch (e) { /* segue */ }
    bloquear('sem', 'Sua sessão foi encerrada. Entre de novo. Os dados desta tela foram descartados.');
    pedirLogin('Entre de novo para ver Taxas e Freelas.');
  }

  function carregarLojas() {
    if (CARREGANDO_LOJAS || BLOQUEIO || PRONTO) return;
    guarda();                                                // identidade primeiro: pode travar a tela
    if (BLOQUEIO || !emailAtual()) return;
    if (!telaVisivel()) { PENDENTE = true; return; }
    if (!USO_REGISTRADO) { USO_REGISTRADO = true; if (typeof registrarUso === 'function') registrarUso('freelas'); }
    CARREGANDO_LOJAS = true; LOJAS_FALHA = false;
    var seq = ++SEQ_LOJAS, ident = IDENT;
    desenhar();
    var p = typeof lojaCarregar === 'function' ? Promise.resolve().then(function () { return lojaCarregar(); }).catch(function () { return null; }) : Promise.resolve(null);
    p.then(function (info) {
      if (seq !== SEQ_LOJAS) return;
      CARREGANDO_LOJAS = false;
      if (emailAtual() !== ident) { guarda(); return; }       // logout/troca durante a carga: trava, não libera nada
      if (BLOQUEIO) return;
      if (!info || !Array.isArray(info.lojas)) { LOJAS_FALHA = true; desenhar(); return; }   // falha NÃO é lista vazia
      PRONTO = true;
      LOJA = typeof lojaAtual === 'function' ? lojaAtual() : null;
      desenhar();
      carregarAba(ABA);
    });
  }

  function aoLoja() {
    if (!guarda()) return;
    var nova = typeof lojaAtual === 'function' ? lojaAtual() : null;
    if (nova === LOJA) return;
    LOJA = nova;
    ABAS.forEach(function (a) { var g = LEIT[a].gen + 1; LEIT[a] = novaLeitura(); LEIT[a].gen = g; });   // recorte mudou: some o anterior
    FILTRO = { texto: '', setor: '' };
    $('buscaTexto').value = '';
    desenhar();
    carregarAba(ABA);
  }

  /* Retoma o que foi pulado (tela oculta) e revalida a identidade. Nunca lê nada por conta própria enquanto oculta. */
  function retomar() {
    if (!INICIADO) return;
    guarda();
    if (BLOQUEIO || !emailAtual() || !telaVisivel()) return;
    // lojas ainda não carregadas: só retoma o que foi pulado por tela oculta; falha de lojas pede o botão (sem repetição sozinha)
    if (!PRONTO) { if (PENDENTE && !LOJAS_FALHA) { PENDENTE = false; carregarLojas(); } return; }
    var loja = typeof lojaAtual === 'function' ? lojaAtual() : null;
    if (loja !== LOJA) { aoLoja(); return; }
    if (PENDENTE || LEIT[ABA].fase === 'inicial') { PENDENTE = false; carregarAba(ABA); }
  }

  // ------------------------------------------------------------------ desenho
  function limparDom() {
    ['listaContatos', 'listaValores', 'statusContatos', 'statusValores', 'fonteContatos', 'fonteValores', 'statusGeral'].forEach(function (id) { limpar($(id)); });
    $('buscaTexto').value = '';
    limpar($('filtroSetor'));
    $('filtroSetor').value = '';
  }

  function desenhar() {
    var bloq = $('bloqueio');
    limpar(bloq);
    bloq.hidden = !BLOQUEIO;
    $('app').hidden = !!BLOQUEIO || !PRONTO;
    $('btnAtualizar').disabled = !!BLOQUEIO || !PRONTO;
    if (BLOQUEIO) {
      limparDom();
      bloq.appendChild(el('p', null, BLOQUEIO.texto));
      var b = el('button', 'fl-btn', 'Recarregar a tela');
      b.type = 'button';
      b.addEventListener('click', function () { location.reload(); });
      bloq.appendChild(b);
      return;
    }
    desenharGeral();
    if (!PRONTO) return;
    ABAS.forEach(function (a) {
      var ativa = a === ABA;
      var tab = $(a === 'contatos' ? 'abaContatos' : 'abaValores');
      tab.setAttribute('aria-selected', ativa ? 'true' : 'false');
      tab.className = 'fl-aba' + (ativa ? ' on' : '');
      $(a === 'contatos' ? 'painelContatos' : 'painelValores').hidden = !ativa;
    });
    desenharContatos();
    desenharValores();
  }

  function botaoRetentar(box, rotulo, fn) {
    var b = el('button', 'fl-btn', rotulo || 'Tentar de novo');
    b.type = 'button';
    b.addEventListener('click', fn);
    box.appendChild(b);
  }

  function desenharGeral() {
    var box = $('statusGeral');
    limpar(box);
    if (PRONTO) return;
    if (LOJAS_FALHA) {
      box.appendChild(el('p', 'fl-estado fl-erro', window.FreelasDados.MSG_LOJAS_FALHA + ' Isto não quer dizer que a conta não tenha lojas.'));
      botaoRetentar(box, 'Tentar de novo', function () { LOJAS_FALHA = false; carregarLojas(); });
    } else if (CARREGANDO_LOJAS) {
      box.appendChild(el('p', 'fl-estado', 'Carregando as lojas autorizadas…'));
    } else {
      box.appendChild(el('p', 'fl-estado', 'A consulta começa quando esta tela estiver visível.'));
    }
  }

  function carimbo(L) { return L.quando ? M.formatarDataHora(L.quando) : '—'; }
  function lojasTexto(L) { return L.dados && L.dados.lojas ? L.dados.lojas.map(rotuloLoja).join(', ') : ''; }

  /* Estado comum das duas abas. Devolve true quando há lista para mostrar. */
  function estadoAba(aba, L, status, fonte, o) {
    limpar(status); limpar(fonte);
    var f = L.fase;
    if (f === 'inicial') { status.appendChild(el('p', 'fl-estado', 'A consulta começa quando esta tela estiver visível.')); return false; }
    if (f === 'carregando') { status.appendChild(el('p', 'fl-estado', 'Carregando ' + o.plural + '…')); return false; }
    if (f === 'aviso') {
      status.appendChild(el('p', 'fl-estado fl-aviso', L.mensagem));
      if (L.retentar) botaoRetentar(status, 'Tentar de novo', function () { carregarAba(aba, true); });
      return false;
    }
    if (f === 'naoliberada') {
      status.appendChild(el('p', 'fl-estado fl-aviso', 'A consulta dos ' + o.plural + ' ainda não foi liberada. Nenhum dado foi lido.'));
      botaoRetentar(status, 'Tentar de novo', function () { carregarAba(aba, true); });
      return false;
    }
    if (f === 'falha') {
      status.appendChild(el('p', 'fl-estado fl-erro', 'Não foi possível consultar os ' + o.plural + ' agora (conexão ou serviço). Isto não quer dizer que não existam ' + o.plural + '.'));
      botaoRetentar(status, 'Tentar de novo', function () { carregarAba(aba, true); });
      return false;
    }
    // 'ok' | 'parcial'
    fonte.appendChild(el('p', 'fl-fonte', 'Fonte: portal novo, ' + o.fonte + ' · lojas: ' + lojasTexto(L) + ' · consultado em ' + carimbo(L) + '.'));
    if (f === 'parcial') status.appendChild(el('p', 'fl-estado fl-aviso', 'Lista parcial: a consulta chegou ao limite de ' + (M.LIMITE_PAGINA * M.MAX_PAGINAS) + ' registros e pode haver mais cadastros que não aparecem aqui.'));
    var av = L.dados.avisos || {};
    if (av.semLoja > 0) status.appendChild(el('p', 'fl-estado fl-aviso', 'Há cadastros sem loja definida (ou com loja não reconhecida). Eles não foram incluídos nem ligados a nenhuma loja.'));
    if (av.invalidas > 0) status.appendChild(el('p', 'fl-estado fl-aviso', av.invalidas + ' registro(s) com dados incompletos foram ignorados.'));
    return true;
  }

  function desenharContatos() {
    var L = LEIT.contatos, lista = $('listaContatos');
    limpar(lista);
    var tem = estadoAba('contatos', L, $('statusContatos'), $('fonteContatos'), { plural: 'contatos', fonte: 'cadastro de contatos' });
    var sel = $('filtroSetor');
    if (!tem) { limpar(sel); sel.value = ''; return; }
    var linhas = L.dados.linhas;
    // opções de setor vindas dos dados; mantém a escolha se ela ainda existe
    var setores = M.listarSetores(linhas), atual = FILTRO.setor;
    limpar(sel);
    var o0 = el('option', null, 'Todos os setores'); o0.value = ''; sel.appendChild(o0);
    var achou = false;
    setores.forEach(function (s) { var o = el('option', null, s.rotulo); o.value = s.valor; sel.appendChild(o); if (s.valor === atual) achou = true; });
    if (!achou) FILTRO.setor = '';
    sel.value = FILTRO.setor;
    if (!linhas.length) {
      lista.appendChild(el('p', 'fl-estado', 'Sem registros de contatos ativos para ' + lojasTexto(L) + ' no cadastro de contatos (consulta de ' + carimbo(L) + ').'));
      return;
    }
    var vis = M.filtrarContatos(linhas, FILTRO);
    lista.appendChild(el('p', 'fl-contagem', vis.length === linhas.length ? linhas.length + ' contato(s)' : vis.length + ' de ' + linhas.length + ' contato(s)'));
    if (!vis.length) { lista.appendChild(el('p', 'fl-estado', 'Nenhum contato bate com a busca.')); return; }
    vis.forEach(function (c) {
      var card = el('article', 'fl-card');
      card.appendChild(el('h3', 'fl-nome', c.nome));
      var dl = el('dl', 'fl-dados');
      [['Setor', c.setor], ['Tipo', c.tipo], ['Loja', rotuloLoja(c.loja)], ['Telefone', c.telefone]].forEach(function (par) {
        var grupo = el('div', 'fl-par');
        grupo.appendChild(el('dt', null, par[0]));
        grupo.appendChild(el('dd', null, par[1] || '—'));
        dl.appendChild(grupo);
      });
      card.appendChild(dl);
      lista.appendChild(card);
    });
  }

  function desenharValores() {
    var L = LEIT.valores, lista = $('listaValores');
    limpar(lista);
    var tem = estadoAba('valores', L, $('statusValores'), $('fonteValores'), { plural: 'valores por hora', fonte: 'cadastro de valores por hora' });
    if (!tem) return;
    var linhas = L.dados.linhas;
    if (!linhas.length) {
      lista.appendChild(el('p', 'fl-estado', 'Sem registros de valor-hora para ' + lojasTexto(L) + ' no cadastro de valores por hora (consulta de ' + carimbo(L) + ').'));
      return;
    }
    lista.appendChild(el('p', 'fl-nota', 'Valores cadastrados no portal novo, sem cálculo de pagamento. O cadastro não indica qual valor está em vigor: confirme com quem mantém o cadastro.'));
    linhas.forEach(function (v) {
      var card = el('article', 'fl-card');
      card.appendChild(el('h3', 'fl-nome', rotuloLoja(v.loja)));
      var dl = el('dl', 'fl-dados');
      var valor = v.valorStatus === 'ok' ? v.valorTexto : (v.valorStatus === 'ausente' ? 'Não informado no cadastro' : 'Valor inválido no cadastro');
      var data = v.atualizadoStatus === 'ok' ? v.atualizadoTexto : (v.atualizadoStatus === 'ausente' ? 'Data não informada' : 'Data inválida no cadastro');
      [['Valor-hora cadastrado', valor], ['Atualizado na fonte em', data]].forEach(function (par) {
        var grupo = el('div', 'fl-par');
        grupo.appendChild(el('dt', null, par[0]));
        grupo.appendChild(el('dd', null, par[1]));
        dl.appendChild(grupo);
      });
      card.appendChild(dl);
      lista.appendChild(card);
    });
  }

  // ------------------------------------------------------------------ início
  function trocarAba(a) {
    if (!guarda()) return;
    ABA = a;
    desenhar();
    carregarAba(a);
  }

  function iniciar() {
    DD = window.FreelasDados.criar({
      trFetch: function (u, o) { return trFetch(u, o); },
      modelo: M,
      lojaCarregar: function () { return lojaCarregar(); },
      lojaAtual: function () { return lojaAtual(); }
    });
    $('abaContatos').addEventListener('click', function () { trocarAba('contatos'); });
    $('abaValores').addEventListener('click', function () { trocarAba('valores'); });
    $('btnAtualizar').addEventListener('click', function () { if (guarda()) carregarAba(ABA, true); });
    $('buscaTexto').addEventListener('input', function () {
      if (!guarda()) return;
      FILTRO.texto = $('buscaTexto').value;
      desenharContatos();
    });
    $('filtroSetor').addEventListener('change', function () {
      if (!guarda()) return;
      FILTRO.setor = $('filtroSetor').value;
      desenharContatos();
    });
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
      bloquear('sem', 'Sem sessão. Entre para ver Taxas e Freelas.');
      pedirLogin('Entre para ver Taxas e Freelas.');
      return;
    }
    if (typeof NA_CASCA !== 'undefined' && NA_CASCA && typeof avisarCasca === 'function') avisarCasca({ tipo: 'casca-modulo', nome: 'freelas' });
    desenhar();
    if (telaVisivel()) carregarLojas();
    else PENDENTE = true;                                    // oculta ao abrir: nada de rede até a tela voltar
  }

  window.reentrarTela = retomar;     // a casca chama ao reabrir a moldura: revalida e retoma só o que foi pulado
  window.FreelasTela = { iniciar: iniciar };
})();
