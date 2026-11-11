/* Reunião semanal — camada de tela. Rascunho só em memória JS desta aba (ModeloReuniao.criarArmazem).
 * Sem localStorage/sessionStorage/IndexedDB/fetch para salvar; sem timers; sem innerHTML com texto digitado.
 * Depende de nucleo.js (rmbSessao, registrarUso, trHoje), loja.js (lojaCarregar, lojaAtual, aoMudarLoja, lojaNome,
 * lojaTravada), reuniao-modelo.js e das variáveis NA_CASCA / avisarCasca definidas no index.html. */
(function () {
  'use strict';
  var M = window.ModeloReuniao;
  var A = M.criarArmazem();
  var DIA = null;
  var LOJA = '';
  var BLOQUEIO = null;          // texto quando a tela está travada (sem sessão / sessão trocada)
  var CONFIRMANDO_LIMPAR = false;
  var INICIADO = false;
  var PRONTO = false;           // só true depois da sessão validada e da lista de lojas carregada
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function emailAtual() {
    var s = typeof rmbSessao === 'function' ? rmbSessao() : null;
    return s && s.email ? s.email : null;
  }
  function rotuloLoja(l) {
    if (!l) return 'Loja não identificada';
    return typeof lojaNome === 'function' ? lojaNome(l) : l;
  }

  /* Compara a identidade da sessão com a do rascunho. Trocou/saiu: apaga na hora e trava a tela. */
  function guarda() { return aplicarIdentidade(A.sincronizarIdentidade(emailAtual())); }

  /* Aplica o resultado de UMA sincronização de identidade (nunca sincronizar de novo antes de tratar 'trocada'). */
  function aplicarIdentidade(r) {
    if (r === 'sem-sessao') {
      var jaAvisou = !!BLOQUEIO;
      BLOQUEIO = 'Sem sessão. Entre para usar a Reunião semanal. A pauta digitada nesta aba foi descartada.';
      if (INICIADO && !jaAvisou) pedirLogin('Entre de novo para usar a Reunião semanal.');
    } else if (r === 'trocada') {
      BLOQUEIO = 'A sessão mudou para outro usuário. A pauta desta aba foi descartada. Recarregue a tela para continuar.';
    }
    if (r === 'sem-sessao' || r === 'trocada') { CONFIRMANDO_LIMPAR = false; desenhar(); return false; }
    return PRONTO && !BLOQUEIO;
  }

  /* Dentro da casca: avisa o pai. Fora dela: vai ao login existente (uma vez só; a página de login não volta para cá). */
  function pedirLogin(recado) {
    if (typeof NA_CASCA !== 'undefined' && NA_CASCA) {
      if (typeof avisarCasca === 'function') avisarCasca({ tipo: 'casca-login', recado: recado });
    } else {
      location.href = '../sistema.html';
    }
  }

  /* Apaga do DOM tudo o que foi digitado (campos escondidos também). */
  function limparDom() {
    ['ata', 'novoPart', 'dia'].forEach(function (id) { $(id).value = ''; });
    ['temas', 'participantes', 'limparBox', 'avisoCtx', 'impressao', 'loja'].forEach(function (id) { $(id).textContent = ''; });
    $('loja').value = '';
  }
  function limparImpressao() { $('impressao').textContent = ''; }

  function rascunho() { return A.obter(DIA, LOJA); }
  function avisoContexto(txt) { $('avisoCtx').textContent = txt || ''; }

  // ------------------------------------------------------------------ desenho
  function desenhar() {
    var bloq = $('bloqueio');
    bloq.textContent = '';
    bloq.hidden = !BLOQUEIO;
    limparImpressao();                         // nunca sobra impressão de outro contexto
    $('app').hidden = !!BLOQUEIO || !PRONTO;
    $('ata').disabled = !!BLOQUEIO || !PRONTO;
    if (BLOQUEIO) {
      limparDom();
      bloq.appendChild(el('p', null, BLOQUEIO));
      var b = el('button', 'rn-btn', 'Recarregar a tela');
      b.type = 'button';
      b.addEventListener('click', function () { location.reload(); });
      bloq.appendChild(b);
      return;
    }
    if (!PRONTO) return;
    desenharContexto();
    desenharParticipantes();
    desenharTemas();
    $('ata').value = rascunho().ata;
    desenharLimpar();
  }

  function desenharContexto() {
    $('dia').value = DIA;
    var sel = $('loja');
    sel.textContent = '';
    var lista = (typeof LOJA_INFO !== 'undefined' && LOJA_INFO && LOJA_INFO.lojas) || [];
    if (!lista.length) {
      var o0 = el('option', null, 'Loja não identificada'); o0.value = ''; sel.appendChild(o0);
    } else {
      lista.forEach(function (l) { var o = el('option', null, rotuloLoja(l)); o.value = l; sel.appendChild(o); });
    }
    sel.value = LOJA;
    sel.disabled = (typeof lojaTravada === 'function' && lojaTravada()) || lista.length < 2;
  }

  function desenharParticipantes() {
    var ul = $('participantes');
    ul.textContent = '';
    rascunho().participantes.forEach(function (nome, i) {
      var li = el('li', 'rn-chip');
      li.appendChild(el('span', null, nome));
      var b = el('button', 'rn-x', '✕');
      b.type = 'button';
      b.setAttribute('aria-label', 'Remover participante ' + nome);
      b.addEventListener('click', function () {
        if (!guarda()) return;
        M.removerParticipante(rascunho(), i);
        desenharParticipantes();
      });
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function campo(rotulo, controle) {
    var l = el('label', 'rn-campo');
    l.appendChild(el('span', 'rn-rot', rotulo));
    l.appendChild(controle);
    return l;
  }
  function ligar(controle, t, nome) {
    controle.addEventListener('input', function () {
      if (!guarda()) return;
      limparImpressao();
      if (!M.definirCampoTema(rascunho(), t.id, nome, controle.value)) controle.value = t[nome];
    });
  }

  function desenharTemas() {
    var box = $('temas');
    box.textContent = '';
    var r = rascunho();
    r.temas.forEach(function (t, i) {
      var card = el('section', 'rn-tema');
      card.setAttribute('aria-label', 'Assunto ' + (i + 1));
      var topo = el('div', 'rn-tema-topo');
      topo.appendChild(el('span', 'rn-num', String(i + 1)));
      var tema = el('input'); tema.type = 'text'; tema.value = t.tema; tema.maxLength = M.LIMITES.tema; tema.placeholder = 'Tema';
      tema.setAttribute('aria-label', 'Tema do assunto ' + (i + 1));
      ligar(tema, t, 'tema');
      topo.appendChild(tema);
      var rem = el('button', 'rn-btn rn-perigo', 'Remover');
      rem.type = 'button';
      rem.setAttribute('aria-label', 'Remover o assunto ' + (i + 1));
      rem.addEventListener('click', function () {
        if (!guarda()) return;
        M.removerTema(rascunho(), t.id);
        desenharTemas();
      });
      topo.appendChild(rem);
      card.appendChild(topo);

      var dec = el('textarea'); dec.rows = 3; dec.value = t.decisao; dec.maxLength = M.LIMITES.decisao;
      ligar(dec, t, 'decisao');
      card.appendChild(campo('Decisão', dec));
      var linha = el('div', 'rn-linha');
      var resp = el('input'); resp.type = 'text'; resp.value = t.responsavel; resp.maxLength = M.LIMITES.curto;
      ligar(resp, t, 'responsavel');
      linha.appendChild(campo('Responsável', resp));
      var prazo = el('input'); prazo.type = 'date'; prazo.value = t.prazo;
      ligar(prazo, t, 'prazo');
      linha.appendChild(campo('Prazo', prazo));
      card.appendChild(linha);
      box.appendChild(card);
    });
    if (!r.temas.length) box.appendChild(el('p', 'rn-vazio', 'Sem assuntos na pauta. Use “Adicionar assunto”.'));
    $('btnTema').disabled = r.temas.length >= M.LIMITES.temas;
  }

  function desenharLimpar() {
    var box = $('limparBox');
    box.textContent = '';
    if (!CONFIRMANDO_LIMPAR) {
      var b = el('button', 'rn-btn rn-perigo', 'Limpar pauta');
      b.type = 'button';
      b.addEventListener('click', function () { if (!guarda()) return; CONFIRMANDO_LIMPAR = true; desenharLimpar(); });
      box.appendChild(b);
      return;
    }
    var s = A.resumo(DIA, LOJA);
    var aviso = el('div', 'rn-confirma');
    aviso.setAttribute('role', 'alert');
    aviso.appendChild(el('p', null,
      'Isto apaga só a pauta de ' + M.diaBR(DIA) + ' · ' + rotuloLoja(LOJA) + ': ' + s.temas + ' assunto(s) (' + s.preenchidos +
      ' com decisão/responsável/prazo), ' + s.participantes + ' participante(s)' + (s.ata ? ' e as anotações' : '') +
      '. Não dá para desfazer; nada foi salvo no sistema.'));
    var ok = el('button', 'rn-btn rn-perigo', 'Sim, apagar esta pauta'); ok.type = 'button';
    var no = el('button', 'rn-btn', 'Cancelar'); no.type = 'button';
    ok.addEventListener('click', function () {
      if (!guarda()) return;
      A.reiniciar(DIA, LOJA);
      CONFIRMANDO_LIMPAR = false;
      avisoContexto('Pauta de ' + M.diaBR(DIA) + ' · ' + rotuloLoja(LOJA) + ' reiniciada.');
      desenhar();
    });
    no.addEventListener('click', function () { CONFIRMANDO_LIMPAR = false; desenharLimpar(); });
    aviso.appendChild(ok); aviso.appendChild(no);
    box.appendChild(aviso);
  }

  // ------------------------------------------------------------------ atalhos
  function montarAtalhos() {
    var box = $('atalhos');
    M.DESTINOS.forEach(function (d) {
      var a = el('a', 'rn-btn', d.rotulo);
      a.href = M.hrefExterno(d.chave);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.addEventListener('click', function (ev) {
        // dentro da casca: a casca abre a tela já existente (respeitando o acesso do usuário) e esta moldura fica em cache com a pauta
        if (typeof NA_CASCA !== 'undefined' && NA_CASCA) {
          ev.preventDefault();
          try { parent.postMessage({ tipo: 'casca-modulo', nome: d.chave }, location.origin); } catch (e) {}
        }
      });
      box.appendChild(a);
    });
  }

  // ------------------------------------------------------------------ ações
  function exportar() {
    if (!guarda()) return;
    var nome = M.nomeArquivo(DIA, LOJA);
    if (!nome) return;
    var txt = M.gerarAta({ dia: DIA, lojaRotulo: LOJA ? rotuloLoja(LOJA) : '' }, rascunho());
    var blob = new Blob(['﻿' + txt], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nome; a.rel = 'noopener'; a.hidden = true;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* Monta o bloco de impressão a partir do contexto ATUAL já validado (ou o esvazia). */
  function montarImpressao() {
    var box = $('impressao');
    box.textContent = '';
    if (!guarda()) return false;
    var r = rascunho();
    box.appendChild(el('h1', null, 'Reunião semanal — Cidadão do Mundo'));
    box.appendChild(el('p', null, 'Pauta temporária (não salva no sistema). Data: ' + M.diaBR(DIA) + ' · ' + rotuloLoja(LOJA)));
    box.appendChild(el('p', null, 'Participantes: ' + (r.participantes.length ? r.participantes.join(', ') : '—')));
    r.temas.forEach(function (t, i) {
      var s = el('div', 'rn-imp-tema');
      s.appendChild(el('h2', null, (i + 1) + '. ' + (t.tema || '(sem título)')));
      s.appendChild(el('p', null, 'Decisão: ' + (t.decisao || '—')));
      s.appendChild(el('p', null, 'Responsável: ' + (t.responsavel || '—') + ' · Prazo: ' + (M.diaBR(t.prazo) || '—')));
      box.appendChild(s);
    });
    if (r.ata.trim()) { box.appendChild(el('h2', null, 'Anotações')); box.appendChild(el('p', 'rn-pre', r.ata)); }
    return true;
  }
  function imprimir() {          // só por clique
    if (montarImpressao()) window.print();
  }

  function adicionarParticipante() {
    if (!guarda()) return;
    var inp = $('novoPart');
    if (M.adicionarParticipante(rascunho(), inp.value)) { inp.value = ''; desenharParticipantes(); }
    inp.focus();
  }

  // ------------------------------------------------------------------ contexto (dia / loja)
  function mudarContexto(novoDia, novaLoja, motivo) {
    if (!guarda()) return false;
    if (!M.validarDia(novoDia) || !A.lojaPermitida(novaLoja)) return false;
    DIA = novoDia; LOJA = novaLoja; CONFIRMANDO_LIMPAR = false;
    avisoContexto(motivo);
    desenhar();
    return true;
  }

  function aoLojaDaCasca(l) {
    if (!guarda()) return;
    var nova = l || '';
    if (nova === LOJA || !A.lojaPermitida(nova)) return;
    mudarContexto(DIA, nova, 'Contexto mudou para ' + rotuloLoja(nova) + '. A pauta é separada por loja e fica só nesta aba: nada foi levado da pauta anterior (' + rotuloLoja(LOJA) + '), que continua guardada até você sair.');
  }

  function revalidar() { if (INICIADO) guarda(); }

  // ------------------------------------------------------------------ início
  function iniciar() {
    montarAtalhos();
    $('btnPart').addEventListener('click', adicionarParticipante);
    $('novoPart').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); adicionarParticipante(); } });
    $('btnTema').addEventListener('click', function () {
      if (!guarda()) return;
      M.adicionarTema(rascunho(), '');
      desenharTemas();
    });
    $('ata').addEventListener('input', function () { if (guarda()) { limparImpressao(); M.definirAta(rascunho(), $('ata').value); } });
    $('btnExportar').addEventListener('click', exportar);
    $('btnImprimir').addEventListener('click', imprimir);
    $('dia').addEventListener('change', function () {
      if (!PRONTO) return;
      var v = $('dia').value;
      if (!M.validarDia(v)) { $('dia').value = DIA; return; }
      mudarContexto(v, LOJA, 'Cada data tem a sua pauta nesta aba. Esta é a de ' + M.diaBR(v) + '; a de ' + M.diaBR(DIA) + ' continua guardada até você sair.');
    });
    $('loja').addEventListener('change', function () {
      if (!PRONTO) return;
      var v = $('loja').value;
      if (!A.lojaPermitida(v)) { $('loja').value = LOJA; return; }
      // na casca o seletor do topo é o único dono da loja: pede a troca e espera a mensagem de volta
      if (typeof NA_CASCA !== 'undefined' && NA_CASCA && !(typeof lojaTravada === 'function' && lojaTravada())) {
        $('loja').value = LOJA;
        avisarCasca({ tipo: 'casca-loja-pedir', loja: v });
      } else aoLojaDaCasca(v);
    });
    if (typeof aoMudarLoja === 'function') aoMudarLoja(aoLojaDaCasca);

    // revalida a identidade sempre que a janela volta ou o login muda em outra aba/janela
    window.addEventListener('storage', function (ev) { if (ev.key === null || ev.key === 'rmbSessao') revalidar(); });
    window.addEventListener('focus', revalidar);
    window.addEventListener('pageshow', revalidar);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) revalidar(); });
    window.addEventListener('beforeunload', function (ev) {
      if (A.temConteudo()) { ev.preventDefault(); ev.returnValue = ''; }
    });
    // Ctrl+P também imprime o contexto atual validado (nunca um bloco antigo); depois da impressão o bloco some
    window.addEventListener('beforeprint', function () { if (PRONTO) montarImpressao(); });
    window.addEventListener('afterprint', limparImpressao);

    // formulário fechado até a sessão e a lista de lojas estarem validadas
    $('app').hidden = true;
    $('ata').disabled = true;
    if (!emailAtual()) {
      A.sincronizarIdentidade(null);
      BLOQUEIO = 'Sem sessão. Entre para usar a Reunião semanal.';
      INICIADO = true;
      desenhar();
      pedirLogin('Entre para usar a Reunião semanal.');
      return;
    }
    A.sincronizarIdentidade(emailAtual());
    if (typeof registrarUso === 'function') registrarUso('reuniao');
    if (typeof NA_CASCA !== 'undefined' && NA_CASCA) avisarCasca({ tipo: 'casca-modulo', nome: 'reuniao' });
    DIA = typeof trHoje === 'function' ? trHoje() : null;
    var pronto = typeof lojaCarregar === 'function' ? lojaCarregar().catch(function () { return null; }) : Promise.resolve(null);
    pronto.then(function (info) {
      A.definirLojas(info && info.lojas);
      LOJA = (typeof lojaAtual === 'function' && lojaAtual()) || '';
      if (!A.lojaPermitida(LOJA)) LOJA = '';
      INICIADO = true;
      if (BLOQUEIO) return;                  // a sessão caiu/trocou durante o carregamento: segue travada
      var r = A.sincronizarIdentidade(emailAtual());
      if (r === 'sem-sessao' || r === 'trocada') { aplicarIdentidade(r); return; }
      PRONTO = true;
      desenhar();
    });
  }

  window.reentrarTela = revalidar;     // a casca chama ao reabrir a moldura: só revalida, não apaga nada
  window.ReuniaoTela = { iniciar: iniciar };
})();
