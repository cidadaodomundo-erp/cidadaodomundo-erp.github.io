// MOTOBOYS RODANDO NO DIA · tela (12/11/2026, Fabio). UMD: no navegador vira window.ChegadaTela; no Node, require().
// Só leitura (GET) da função fabio-delivery-chegada com o JWT do ERP da sessão atual. Nenhum botão que mude dado,
// nenhuma moldura do portal antigo. Atualiza a cada 10 s só no dia operacional atual e com a tela visível, sem sobrepor.
// Cada leitura tem prazo de 30 s e só vale para a mesma sequência, conta, loja e dia; ao ocultar, a leitura em voo é abortada.
(function (raiz, fabrica) {
  const ehNode = typeof module === 'object' && module.exports;
  const api = fabrica(ehNode ? require('./chegada-modelo.js') : (raiz && raiz.ChegadaModelo));
  if (ehNode) module.exports = api; else raiz.ChegadaTela = api;
})(typeof self !== 'undefined' ? self : this, function (MODELO) {
  'use strict';
  const POLL_MS = 10000;
  const TIMEOUT_MS = 30000;
  const CAB = ['Motoboy', 'Entrada combinada', 'Chegada observada', 'Saída registrada', 'Intervalo registrado', 'Garantido', 'Refeição'];

  function avisoHtml(M, msg, tentar, forte) {
    return '<div class="cg-aviso' + (forte ? ' cg-aviso-forte' : '') + '" role="status">' + M.esc(msg) +
      (tentar ? ' <button type="button" class="cg-btn" data-acao="tentar">Tentar de novo</button>' : '') + '</div>';
  }
  function celDireito(M, rot, d) {
    return '<td data-rot="' + rot + '" class="cg-c-dir"><span class="cg-dir cg-' + d.estado + '">' + M.esc(d.texto) +
      (d.manual ? ' <em class="cg-manual">manual</em>' : '') + '</span><small class="cg-motivo">' + M.esc(d.motivo) + '</small></td>';
  }
  function fichaHtml(M, l, ch, iv) {
    const item = (t, v) => '<div><dt>' + M.esc(t) + '</dt><dd>' + M.esc(v == null || v === '' ? '—' : v) + '</dd></div>';
    const fila = M.hora(l.chegada_fila_txt), filaEm = M.horaISO(l.chegada_fila_em, true);
    const man = (v, mot) => (typeof v === 'boolean' ? (v ? 'Sim' : 'Não') + (M.txt(mot) ? ' — ' + M.txt(mot) : '') : null);
    const esc1 = M.hora(l.escala_txt), esc2 = M.hora(l.escala_saida_txt);
    return '<details class="cg-ficha"><summary>Ficha e fontes</summary><dl>' +
      item('Chegada usada', ch ? ch.hora + ' · ' + ch.rotulo : 'nenhuma fonte de chegada') +
      item(M.ROTULO_FONTE.fila, fila ? fila + (filaEm ? ' (registro às ' + filaEm + ')' : '') + (M.filaFonte(l) ? ' · ' + M.filaFonte(l) : '') : null) +
      item('Pátio (GPS)', M.hora(l.patio_gps_txt)) +
      item('Anotado à mão pela loja', M.hora(l.anotado_txt)) +
      item('Primeira entrega (não conta como chegada)', M.hora(l.primeira_entrega_txt)) +
      item('Saída registrada', M.saidaRegistrada(l)) +
      item('Última entrega', M.hora(l.ultima_entrega_txt)) +
      item('Última vez no pátio (GPS)', M.hora(l.ultimo_patio_txt)) +
      item('Último sinal do aplicativo', M.hora(l.ultimo_sinal_txt)) +
      item('Entrada combinada', esc1 ? esc1 + (esc2 ? ' até ' + esc2 : '') : null) +
      item('Limite de tolerância', M.hora(l.limite_txt)) +
      item('Atraso desde a entrada combinada', Number.isFinite(l.atraso_min) ? l.atraso_min + ' min' : null) +
      item('Intervalo registrado', iv ? iv.texto + ' (desde ' + iv.rotulo + ')' : null) +
      item('Sem prova', M.txt(l.motivo_sem_prova)) +
      item('Garantido manual', man(l.garantido_manual, l.garantido_motivo)) +
      item('Refeição manual', man(l.rango_manual, l.rango_motivo)) +
      item('Situação informada pela fonte', M.txt(l.direito)) +
      '</dl><p class="cg-nota">O intervalo registrado vai da chegada (Fila do TrackEat ou pátio GPS) à saída registrada e pode conter pausas: não é hora líquida trabalhada.</p></details>';
  }
  // 13/11/2026 (Fabio): embaixo da saída registrada, última entrega e última vez no pátio, separadas e rotuladas;
  // "Foi embora por volta de" só como estimativa. Sem dado = pendência visível, nunca hora inventada.
  function fimHtml(M, l, aoVivo) {
    const f = M.fimDoTurno(l, aoVivo);
    const lin = (rot, v) => '<small class="cg-motivo cg-fim">' + M.esc(rot) + ' ' + (v ? '<strong>' + M.esc(v) + '</strong>' : '<span class="cg-fraco">sem dado</span>') + '</small>';
    return lin('Última entrega', f.entrega) + lin('Última vez no pátio', f.patio) +
      (f.foiEmbora ? '<small class="cg-motivo cg-estimativa">Foi embora por volta de <strong>' + M.esc(f.foiEmbora) + '</strong> · estimativa, não é saída registrada</small>' : '');
  }
  function linhaHtml(M, l, aoVivo) {
    const ch = M.chegadaObservada(l), sai = M.saidaRegistrada(l), iv = M.intervaloRegistrado(l), d = M.direitos(l), marca = M.marcaEscala(l);
    const ent = M.hora(l.escala_txt), entSai = M.hora(l.escala_saida_txt);
    const sub = [];
    if (Number.isInteger(l.n_turno)) sub.push('Turno ' + l.n_turno);
    if (marca) sub.push('<span class="cg-marca">' + M.esc(marca) + '</span>');
    if (l.vivo_rodando === true) sub.push('<span class="cg-vivo">rodando agora</span>');
    return '<tr>' +
      '<td data-rot="Motoboy" class="cg-c-nome"><strong>' + M.esc(M.txt(l.motoboy) || 'Sem nome na fonte') + '</strong>' +
        (sub.length ? '<small class="cg-sub">' + sub.join(' · ') + '</small>' : '') + fichaHtml(M, l, ch, iv) + '</td>' +
      '<td data-rot="Entrada combinada">' + (ent ? '<span class="cg-hora">' + M.esc(ent) + '</span>' + (entSai ? '<small class="cg-motivo">até ' + M.esc(entSai) + '</small>' : '')
        : '<span class="cg-fraco">Sem escala</span>') + '</td>' +
      '<td data-rot="Chegada observada">' + (ch ? '<span class="cg-hora">' + M.esc(ch.hora) + '</span><small class="cg-motivo cg-f-' + ch.fonte + '">' + M.esc(ch.rotulo) + '</small>'
        : '<span class="cg-fraco">Sem chegada registrada</span><small class="cg-motivo">não é falta confirmada</small>') + '</td>' +
      '<td data-rot="Saída registrada">' + (sai ? '<span class="cg-hora">' + M.esc(sai) + '</span>' : '<span class="cg-fraco">Sem saída registrada</span>') + fimHtml(M, l, aoVivo) + '</td>' +
      '<td data-rot="Intervalo registrado">' + (iv ? '<span class="cg-hora">' + M.esc(iv.texto) + '</span><small class="cg-motivo">desde ' + M.esc(iv.rotulo) +
        ' · pode conter pausas</small>' : '<span class="cg-fraco">—</span>') + '</td>' +
      celDireito(M, 'Garantido', d.garantido) + celDireito(M, 'Refeição', d.refeicao) + '</tr>';
  }
  function lojaHtml(M, u, nomeDe) {
    const nome = (nomeDe && nomeDe(u.unidade)) || M.txt(u.unidade) || 'Loja';
    const robo = M.situacaoRobo(u);
    const cons = M.dataHoraISO(u.consultado_em);
    const meta = ['<span>Fonte atualizada: <strong>' + (robo.atualizado ? M.esc(robo.atualizado) : 'sem horário informado') + '</strong>' +
      (robo.desatualizado ? ' <span class="cg-alerta">(leitura do robô desatualizada: não é falha comprovada da fonte)</span>' : '') + '</span>',
      '<span>Consultado: ' + (cons ? M.esc(cons) : '—') + '</span>'];
    if (u.ao_vivo === true) meta.push('<span class="cg-vivo">ao vivo</span>');
    else if (M.ehHistorico(u)) meta.push('<span>histórico · consulta atual, não é fechamento</span>');
    const n = M.camposInvalidos(u);
    const inval = n ? avisoHtml(M, 'A fonte mandou ' + n + (n === 1 ? ' campo' : ' campos') + ' fora do formato. Esses campos aparecem em branco ou "a conferir".') : '';
    let corpo;
    if (u.status !== 'ok' || !Array.isArray(u.linhas)) {
      corpo = '<div class="cg-aviso cg-aviso-forte" role="status">A fonte desta loja está indisponível agora. A lista não foi lida: isso <strong>não</strong> quer dizer que ninguém veio nem que alguém faltou.</div>';
    } else if (!u.linhas.length) {
      corpo = '<div class="cg-vazio">A fonte foi lida e não trouxe nenhum turno de motoboy para este dia nesta loja.</div>';
    } else {
      corpo = '<div class="cg-tab-wrap"><table class="cg-tab"><thead><tr>' + CAB.map((c) => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>' +
        u.linhas.filter((l) => l && typeof l === 'object').map((l) => linhaHtml(M, l, u.ao_vivo === true)).join('') + '</tbody></table></div>';
    }
    return '<section class="cg-loja"><header class="cg-loja-topo"><h2>' + M.esc(nome) + '</h2><div class="cg-meta">' + meta.join('') + '</div></header>' + inval + corpo + '</section>';
  }
  const NOTA = '<p class="cg-nota">Consulta atual, <strong>não</strong> é lacre financeiro: nada aqui fecha pagamento. Chegada observada usa, nesta ordem, ' +
    'a Fila do TrackEat, o pátio por GPS e o horário anotado à mão pela loja (sempre identificado). Primeira entrega e último sinal nunca ' +
    'contam como chegada ou saída. Intervalo registrado = da chegada (Fila do TrackEat ou pátio GPS) à saída registrada; pode conter pausas e não é hora líquida. ' +
    'Atraso é contado desde a entrada combinada. Sim verde e Não vermelho só quando confirmado; o resto fica Aguardando ou A conferir. Sem prova de atraso não vira perda.</p>';

  function renderizar(dado, ctx) {
    const M = (ctx && ctx.M) || MODELO;
    if (!dado) return '';
    if (dado.fase === 'carregando') return '<div class="cg-vazio">Consultando…</div>';
    if (dado.fase === 'sem_permissao') return avisoHtml(M, 'Esta conta não tem permissão para ver a Chegada dos motoboys desta loja. Peça a liberação a quem cuida dos acessos.', false, true);
    if (dado.fase === 'erro') return avisoHtml(M, (dado.tempo ? 'A consulta passou de 30 s e foi interrompida' : 'Não foi possível consultar a Chegada agora' +
      (dado.status ? ' (erro ' + dado.status + ')' : '')) + '. Nada foi alterado.', true, true);
    const us = M.unidadesVisiveis(dado.resp, ctx.loja, ctx.lojas);
    let h = dado.falha ? avisoHtml(M, 'A última atualização falhou' + (dado.tempo ? ' (passou de 30 s)' : '') + '; abaixo está a consulta anterior.', true) : '';
    h += us.length ? us.map((u) => lojaHtml(M, u, ctx.lojaNome)).join('')
      : avisoHtml(M, 'A resposta não trouxe nenhuma loja autorizada para esta escolha. Isso não quer dizer que ninguém veio.', true, true);
    return h + NOTA;
  }

  function criarTela(env) {
    const M = env.M || MODELO;
    const d = env.doc, w = env.win;
    const $ = (id) => d.getElementById(id);
    const campo = $('dia'), conteudo = $('conteudo'), estado = $('estado'), lojaBox = $('lojaBox'), lojaSel = $('lojaSel');
    const S = { ativo: false, ident: null, dia: null, segueHoje: true, lojas: null, lojaLocal: null, seq: 0, ctrl: null,
                emVoo: false, timer: null, pendente: false, dado: null, msg: null };
    const identDe = (s) => (s && typeof s.email === 'string' && s.email.trim() ? s.email.trim().toLowerCase() : null);
    const hoje = () => M.diaOperacional(env.agora());
    const ehRede = (l) => M.normUnidade(l) === 'REDE';
    function visivel() {
      if (d.hidden) return false;
      try { const f = w.frameElement; if (f && f.hidden) return false; } catch (e) { /* moldura de outra origem */ }
      return true;
    }
    function lojaPedida() { return (!env.naCasca && S.lojaLocal) || env.lojaAtual() || null; }
    // REDE só vale com pelo menos uma loja autorizada de verdade (falha fechada); loja comum só se estiver autorizada.
    function lojaEscolhida() {
      if (!S.lojas || !S.lojas.length) return null;
      const l = lojaPedida();
      if (!l) return null;
      if (ehRede(l)) return M.lojasReais(S.lojas).length ? l : null;
      return S.lojas.indexOf(l) >= 0 ? l : null;
    }
    function pararTimer() { if (S.timer != null) { env.clearTimeout(S.timer); S.timer = null; } }
    function abortar() { S.seq++; if (S.ctrl) { try { S.ctrl.abort(); } catch (e) { /* já encerrada */ } } S.ctrl = null; S.emVoo = false; }
    function desenhar() {
      if (!conteudo) return;
      if (!S.ativo) { conteudo.innerHTML = ''; if (estado) estado.textContent = ''; return; }
      const loja = lojaEscolhida();
      conteudo.innerHTML = S.msg ? avisoHtml(M, S.msg.texto, S.msg.tentar) : renderizar(S.dado, { M, loja, lojas: S.lojas, lojaNome: env.lojaNome });
      if (estado) {
        const ehHoje = S.dia === hoje();
        estado.textContent = 'Dia operacional ' + (M.diaBR(S.dia) || '—') + ' (vira às 05h)' + (loja ? ' · ' + (env.lojaNome(loja) || loja) : '') +
          (ehHoje ? ' · atualiza a cada 10 s com a tela aberta' : ' · dia passado: sem atualização automática');
      }
    }
    function pedir(dia, loja, ctrl) {
      const s = env.sessao();
      if (!s || !s.access_token) return Promise.resolve({ ok: false, status: 401, json: async () => null });
      const op = { method: 'GET', headers: { Authorization: (env.cabecalho() || {}).Authorization }, cache: 'no-store', credentials: 'omit' };
      if (ctrl) op.signal = ctrl.signal;
      return env.fetch(M.montarUrl(dia, loja), op);
    }
    function falha(chave, status, tempo) {
      if (S.dado && S.dado.chave === chave && S.dado.fase === 'ok') return Object.assign({}, S.dado, { falha: true, tempo: !!tempo });
      return { chave, fase: 'erro', status: status || null, tempo: !!tempo };
    }
    function agendar() {
      pararTimer();
      if (!S.ativo || (!S.segueHoje && S.dia !== hoje())) return;   // poll só no dia operacional atual
      if (!visivel()) { S.pendente = true; return; }
      S.timer = env.setTimeout(tick, POLL_MS);
    }
    function tick() {
      S.timer = null;
      if (!S.ativo) return;
      const h = hoje();
      if (campo) campo.max = h;
      if (S.segueHoje && S.dia !== h) { S.dia = h; if (campo) campo.value = h; S.dado = null; consultar(true); return; } // virou 05h
      if (S.dia !== h) return;
      consultar(false);
    }
    async function consultar(novo) {
      if (!S.ativo) return;
      if (novo) abortar();
      else if (S.emVoo) return;                                    // nunca sobrepõe leituras
      pararTimer();
      if (!visivel()) { S.pendente = true; desenhar(); return; }   // oculta: nenhuma leitura
      S.pendente = false;
      if (S.lojas === null) { S.msg = { texto: 'Não deu para carregar as lojas autorizadas desta conta.', tentar: true }; desenhar(); return; }
      if (!S.lojas.length) { S.msg = { texto: 'Esta conta não tem loja cadastrada para ver a Chegada.', tentar: false }; desenhar(); return; }
      const loja = lojaEscolhida();
      if (!loja) {
        S.msg = ehRede(lojaPedida())
          ? { texto: 'Visão da rede sem nenhuma loja autorizada para esta conta: nada é mostrado.', tentar: false }
          : { texto: 'Escolha uma das lojas autorizadas.', tentar: false };
        S.dado = null; desenhar(); return;
      }
      S.msg = null;
      const dia = S.dia, chave = dia + '|' + loja, ident = S.ident;
      if (!S.dado || S.dado.chave !== chave) S.dado = { chave, fase: 'carregando' };
      desenhar();
      const seq = ++S.seq;
      const ctrl = env.AbortController ? new env.AbortController() : null;
      S.ctrl = ctrl; S.emVoo = true;
      // prazo de 30 s para a leitura inteira (pedido, renovação e corpo)
      let estourou = false, prazo = null;
      const limite = new Promise((_, rej) => {
        prazo = env.setTimeout(() => {
          prazo = null; estourou = true;
          if (ctrl) { try { ctrl.abort(); } catch (e) { /* já encerrada */ } }
          rej(Object.assign(new Error('prazo de 30 s'), { name: 'TimeoutError' }));
        }, TIMEOUT_MS);
      });
      limite.catch(() => {});
      const corre = (p) => Promise.race([Promise.resolve(p), limite]);
      // só vale a leitura da mesma sequência, conta, dia e loja, com a tela visível
      const vale = () => {
        if (!S.ativo || seq !== S.seq) return false;
        const s = env.sessao();
        if (identDe(s) !== ident) { trocouConta(s); return false; }
        if (!visivel()) { S.pendente = true; return false; }
        return S.dia === dia && lojaEscolhida() === loja;
      };
      let fim = null;
      try {
        let r = await corre(pedir(dia, loja, ctrl));
        if (!vale()) return;
        if (r.status === 401) {                                    // renova UMA vez pelo núcleo e tenta de novo
          let renovou = false;
          try { renovou = !!(await corre(env.renovar(r))); } catch (e) { if (estourou) throw e; renovou = false; }
          if (!vale()) return;
          if (renovou) { r = await corre(pedir(dia, loja, ctrl)); if (!vale()) return; }
        }
        if (r.status === 401) { encerrar('Sua sessão venceu. Entre de novo para ver a Chegada dos motoboys.'); return; }
        if (r.status === 403) fim = { chave, fase: 'sem_permissao' };
        else if (!r.ok) fim = falha(chave, r.status);
        else {
          let j = null;
          try { j = await corre(r.json()); } catch (e) { if (estourou) throw e; j = null; }
          if (!vale()) return;
          fim = M.validarResposta(j, dia).ok ? { chave, fase: 'ok', resp: j } : falha(chave, null);
        }
      } catch (e) {
        if (!vale()) return;
        if (!estourou && e && e.name === 'AbortError') return;
        fim = falha(chave, null, estourou);
      } finally {
        if (prazo != null) { env.clearTimeout(prazo); prazo = null; }
        if (seq === S.seq) { S.emVoo = false; S.ctrl = null; }
      }
      if (!fim || !vale()) return;
      S.dado = fim;
      desenhar();
      agendar();
    }
    function limpar() { S.ativo = false; abortar(); pararTimer(); S.dado = null; S.msg = null; desenhar(); }
    function encerrar(recado) { limpar(); env.irLogin(recado); }
    // outra conta (ou sessão sumiu) durante a tela: nada da conta anterior fica na tela
    function trocouConta(s) {
      if (!s || !s.access_token) { encerrar('Sua sessão foi encerrada. Entre de novo.'); return; }
      limpar(); env.recarregar();
    }
    async function garantirLojas() {
      try { const i = await env.lojaCarregar(); S.lojas = i && Array.isArray(i.lojas) ? i.lojas.slice() : null; }
      catch (e) { S.lojas = null; }
    }
    function montarSelect() {
      if (!lojaBox || !lojaSel) return;
      if (env.naCasca || !S.lojas || !S.lojas.length) { lojaBox.hidden = true; return; }  // na casca: seletor do topo
      const atual = lojaEscolhida() || S.lojas[0];
      lojaSel.innerHTML = S.lojas.map((l) => '<option value="' + M.esc(l) + '"' + (l === atual ? ' selected' : '') + '>' + M.esc(env.lojaNome(l) || l) + '</option>').join('');
      lojaSel.value = atual; S.lojaLocal = atual; lojaBox.hidden = false;
    }
    async function prosseguir() {
      if (S.lojas === null) { await garantirLojas(); if (!S.ativo) return; montarSelect(); }
      consultar(true);
    }
    function retomar() {
      if (!S.ativo || !visivel()) return;
      if (S.pendente || (S.timer == null && !S.emVoo && S.dia === hoje())) { S.pendente = false; prosseguir(); }
    }
    // ocultou: aborta a leitura em voo e para o timer; voltou: retoma
    function aoMudarVisibilidade() {
      if (!S.ativo) return;
      if (!visivel()) { pararTimer(); if (S.emVoo) abortar(); S.pendente = true; return; }
      retomar();
    }
    function irPara(v) {
      const h = hoje();
      if (!M.diaValido(v) || v > h) v = h;
      if (campo) { campo.value = v; campo.max = h; }
      S.dia = v; S.segueHoje = v === h; S.dado = null;
      consultar(true);
    }

    if (campo) campo.addEventListener('change', () => { if (S.ativo) irPara(campo.value); });
    const bHoje = $('btnHoje'), bAtual = $('btnAtualizar');
    if (bHoje) bHoje.addEventListener('click', () => { if (S.ativo) irPara(hoje()); });
    if (bAtual) bAtual.addEventListener('click', () => { if (S.ativo) prosseguir(); });
    if (lojaSel) lojaSel.addEventListener('change', () => {
      if (!S.ativo || !S.lojas || S.lojas.indexOf(lojaSel.value) < 0) return;
      S.lojaLocal = lojaSel.value; S.dado = null; consultar(true);
    });
    if (conteudo) conteudo.addEventListener('click', (e) => {
      const b = e && e.target && e.target.closest ? e.target.closest('[data-acao="tentar"]') : null;
      if (b && S.ativo) prosseguir();
    });
    env.aoMudarLoja(() => { if (!S.ativo) return; S.dado = null; consultar(true); });
    d.addEventListener('visibilitychange', aoMudarVisibilidade);
    w.addEventListener('resize', aoMudarVisibilidade);   // a moldura da casca muda de tamanho ao aparecer/sumir
    w.addEventListener('pagehide', () => { if (S.ativo) { pararTimer(); abortar(); S.pendente = true; } });
    // Logout encerra; outra conta limpa tudo e recarrega; mesma conta (token renovado) segue.
    w.addEventListener('storage', (e) => {
      if (!S.ativo) return;
      if (e.key === null || (e.key === 'rmbSessao' && e.newValue == null)) { encerrar('Sua sessão foi encerrada. Entre de novo.'); return; }
      if (e.key !== 'rmbSessao') return;
      let nova = null;
      try { nova = identDe(JSON.parse(e.newValue)); } catch (x) { nova = null; }
      if (nova && nova === S.ident) return;
      limpar();
      env.recarregar();
    });
    w.reentrarTela = () => {
      if (!S.ativo) return;
      const h = hoje();
      if (campo) campo.max = h;
      if (S.segueHoje && S.dia !== h) { S.dia = h; if (campo) campo.value = h; S.dado = null; }
      prosseguir();
    };

    async function iniciar() {
      const s = env.sessao();
      if (!s || !s.access_token) { env.irLogin('Entre para ver a Chegada dos motoboys.'); return; }
      S.ativo = true; S.ident = identDe(s);
      try { env.registrarUso('chegada'); } catch (e) { /* uso nunca atrapalha */ }
      if (env.naCasca) env.avisar({ tipo: 'casca-titulo', nome: 'chegada' });
      const h = hoje(); S.dia = h; S.segueHoje = true;
      if (campo) { campo.value = h; campo.max = h; }
      if (!visivel()) { S.pendente = true; return; }              // oculta ao abrir: nada de rede até voltar
      S.msg = { texto: 'Carregando as lojas autorizadas…', tentar: false }; desenhar();
      await garantirLojas();
      if (!S.ativo) return;
      montarSelect();
      await consultar(true);
    }
    return { iniciar, estado: S, consultar, retomar };
  }

  function iniciarNavegador() {
    const w = window, naCasca = w.parent !== w;
    const avisar = (m) => { if (naCasca) { try { w.parent.postMessage(m, w.location.origin); } catch (e) { /* sem casca */ } } };
    /* global rmbSessao, cabecalhoLeitura, rmbRenovarSeExpirado, lojaCarregar, lojaAtual, lojaNome, aoMudarLoja, registrarUso, exigirLogin */
    return criarTela({
      doc: document, win: w, M: w.ChegadaModelo,
      fetch: (u, o) => w.fetch(u, o),
      sessao: () => rmbSessao(), cabecalho: () => cabecalhoLeitura(), renovar: (r) => rmbRenovarSeExpirado(r),
      lojaCarregar: () => lojaCarregar(), lojaAtual: () => lojaAtual(), lojaNome: (l) => lojaNome(l), aoMudarLoja: (f) => aoMudarLoja(f),
      naCasca, avisar, registrarUso: (t) => registrarUso(t),
      agora: () => Date.now(), setTimeout: (f, ms) => w.setTimeout(f, ms), clearTimeout: (id) => w.clearTimeout(id),
      AbortController: w.AbortController,
      irLogin: (r) => { if (typeof exigirLogin === 'function') exigirLogin(r); else if (naCasca) avisar({ tipo: 'casca-login', recado: r || '' }); else w.location.href = '../sistema.html'; },
      recarregar: () => w.location.reload(),
    });
  }

  return { criarTela, renderizar, iniciarNavegador, POLL_MS, TIMEOUT_MS, CAB };
});
