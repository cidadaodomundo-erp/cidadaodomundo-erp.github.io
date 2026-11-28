// Freelas por loja (16/11/2026, decisão do Fábio): cada freela é ligado à sua loja.
// 27/11/2026: quadro por setor. "Arrumar" em cada cartão (setor, já chamamos direto, nome, telefone, tirar da lista)
// pela RPC freela_editar, e "Nova pessoa" pela RPC freela_adicionar. O servidor confere a loja igual ao freela_definir_loja.
// Única escrita da tela Taxas e Freelas, isolada aqui (freelas.js / freelas-dados.js continuam só leitura).
//  - Quadro "Freelas sem loja": lista os ativos sem loja (RPC freela_sem_loja_listar) e liga cada um a uma das lojas da conta.
//  - Em cada contato da loja: "Trocar loja" (qualquer gerente da loja atual pode passar para outra loja dele).
// O servidor (RPC freela_definir_loja) confere de novo: só lojas da conta, e só freela sem loja ou da loja da conta.
// Mostra só nome e setor do freela sem loja (sem telefone). Depende de nucleo.js (trRpc, trErroDe) e loja.js (lojaCarregar, lojaNome).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var LOJAS = null;          // lojas concretas da conta (sem REDE)
  var SEQ = 0;
  var aoMudar = null;        // chamado depois de ligar/trocar (a tela relê os contatos)

  function el(tag, cls, texto) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function rotulo(l) { return typeof lojaNome === 'function' ? (lojaNome(l) || l) : l; }
  function chave(l) { return String(l || '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  async function minhasLojas() {
    if (LOJAS) return LOJAS;
    var info = null;
    try { info = await lojaCarregar(); } catch (e) { info = null; }
    if (!info || !Array.isArray(info.lojas)) return null;
    LOJAS = info.lojas.filter(function (l) { return l && chave(l) !== 'REDE'; });
    return LOJAS;
  }

  function seletor(lojas, atual) {
    var sel = el('select');
    var o0 = el('option', null, 'Escolha…'); o0.value = ''; sel.appendChild(o0);
    lojas.forEach(function (l) {
      if (atual && chave(l) === chave(atual)) return;
      var o = el('option', null, rotulo(l)); o.value = l; sel.appendChild(o);
    });
    return sel;
  }

  // Linha "Loja [select] [botão]" + recado. Ao gravar chama aoGravar(lojaNova).
  function linhaEscolha(id, lojas, atual, textoBotao, aoGravar) {
    var box = el('div', 'fl-escolha');
    var campo = el('label', 'fl-campo');
    campo.appendChild(el('span', 'fl-rot', atual ? 'Passar para a loja' : 'Loja'));
    var sel = seletor(lojas, atual);
    campo.appendChild(sel);
    var btn = el('button', 'fl-btn', textoBotao); btn.type = 'button'; btn.disabled = true;
    var recado = el('p', 'fl-recado');
    recado.setAttribute('role', 'status');
    sel.addEventListener('change', function () { btn.disabled = !sel.value; recado.textContent = ''; recado.className = 'fl-recado'; });
    btn.addEventListener('click', async function () {
      var loja = sel.value;
      if (!loja) return;
      btn.disabled = true; sel.disabled = true;
      recado.className = 'fl-recado'; recado.textContent = 'Gravando…';
      var r = null, erro = null;
      try { r = await trRpc('freela_definir_loja', { p_id: id, p_loja: loja }); } catch (e) { erro = 'Sem conexão. Tente de novo.'; }
      if (r && !r.ok) erro = await trErroDe(r);
      if (erro) {
        recado.className = 'fl-recado fl-recado-erro'; recado.textContent = 'Não gravou: ' + erro;
        btn.disabled = false; sel.disabled = false; return;
      }
      recado.className = 'fl-recado fl-recado-ok'; recado.textContent = '✓ Ligado à ' + rotulo(loja);
      if (aoGravar) aoGravar(loja);
    });
    var linha = el('div', 'fl-escolha-linha');
    linha.appendChild(campo); linha.appendChild(btn);
    box.appendChild(linha); box.appendChild(recado);
    return box;
  }

  // Quadro dos freelas sem loja (fica acima da lista de contatos).
  async function carregarSemLoja() {
    var box = $('semLoja');
    if (!box) return;
    var seq = ++SEQ;
    var lojas = await minhasLojas();
    if (seq !== SEQ) return;
    if (!lojas || !lojas.length) { box.hidden = true; return; }
    var r = null, lista = null, erro = null;
    try { r = await trRpc('freela_sem_loja_listar', {}); } catch (e) { erro = 'Sem conexão.'; }
    if (r && !r.ok) erro = await trErroDe(r);
    else if (r) { try { lista = await r.json(); } catch (e) { erro = 'Resposta inválida.'; } }
    if (seq !== SEQ) return;
    box.textContent = '';
    if (erro) {
      box.hidden = false;
      box.appendChild(el('h2', null, 'Freelas sem loja'));
      box.appendChild(el('p', 'fl-estado fl-erro', 'Não foi possível carregar os freelas sem loja: ' + erro));
      return;
    }
    if (!Array.isArray(lista) || !lista.length) { box.hidden = true; return; }
    box.hidden = false;
    var titulo = el('h2', null, 'Freelas sem loja (' + lista.length + ')');
    box.appendChild(titulo);
    box.appendChild(el('p', 'fl-fonte', 'Escolha a loja de cada freela e toque em Ligar. Depois de ligado, ele aparece na lista da loja. Só dá para escolher uma das suas lojas.'));
    var grade = el('div', 'fl-lista');
    var faltam = lista.length;
    lista.forEach(function (f) {
      if (!f || f.id == null || !f.nome) return;
      var card = el('article', 'fl-card');
      card.appendChild(el('h3', 'fl-nome', String(f.nome)));
      var dl = el('dl', 'fl-dados'), par = el('div', 'fl-par');
      par.appendChild(el('dt', null, 'Setor')); par.appendChild(el('dd', null, f.setor || '—'));
      dl.appendChild(par); card.appendChild(dl);
      card.appendChild(linhaEscolha(f.id, lojas, null, 'Ligar', function () {
        faltam--; titulo.textContent = 'Freelas sem loja (' + faltam + ')';
        if (aoMudar) aoMudar();
      }));
      grade.appendChild(card);
    });
    box.appendChild(grade);
  }

  var SETORES = ['Produção', 'Salão', 'Cozinha'];

  function seletorSetor(atual) {
    var sel = el('select');
    var o0 = el('option', null, 'Sem setor'); o0.value = ''; sel.appendChild(o0);
    SETORES.forEach(function (s) { var o = el('option', null, s); o.value = s; sel.appendChild(o); });
    sel.value = SETORES.indexOf(atual) >= 0 ? atual : '';
    return sel;
  }
  function campo(rot, controle) {
    var c = el('label', 'fl-campo');
    c.appendChild(el('span', 'fl-rot', rot));
    c.appendChild(controle);
    return c;
  }
  function caixa(rot, marcado) {
    var c = el('label', 'fl-marca');
    var i = el('input'); i.type = 'checkbox'; i.checked = !!marcado;
    c.appendChild(i); c.appendChild(document.createTextNode(' ' + rot));
    return { label: c, input: i };
  }
  function texto(valor, max, modo) {
    var i = el('input'); i.type = 'text'; i.maxLength = max; i.value = valor || '';
    if (modo) i.inputMode = modo;
    return i;
  }
  function digitos(t) { return String(t || '').replace(/\D/g, ''); }

  async function gravar(fn, args, recado) {
    recado.className = 'fl-recado'; recado.textContent = 'Gravando…';
    var r = null, erro = null;
    try { r = await trRpc(fn, args); } catch (e) { erro = 'Sem conexão. Tente de novo.'; }
    if (r && !r.ok) erro = await trErroDe(r);
    if (erro) { recado.className = 'fl-recado fl-recado-erro'; recado.textContent = 'Não gravou: ' + erro; return false; }
    recado.className = 'fl-recado fl-recado-ok'; recado.textContent = '✓ Gravado';
    return true;
  }

  // "Arrumar" no cartão: setor, já chamamos direto, nome, telefone e tirar da lista.
  function arrumar(contato) {
    var det = el('details', 'fl-trocar');
    det.appendChild(el('summary', null, 'Arrumar'));
    var nome = texto(contato.nome, 120), tel = texto(contato.telefone, 25, 'tel'), setor = seletorSetor(contato.setor);
    var ch = caixa('Já chamamos direto', contato.chamado);
    var recado = el('p', 'fl-recado'); recado.setAttribute('role', 'status');
    var salvar = el('button', 'fl-btn', 'Salvar'); salvar.type = 'button';
    var tirar = el('button', 'fl-btn fl-btn-tirar', 'Tirar da lista'); tirar.type = 'button';
    var form = el('div', 'fl-form');
    [campo('Nome', nome), campo('Telefone', tel), campo('Setor', setor)].forEach(function (c) { form.appendChild(c); });
    form.appendChild(ch.label);
    var botoes = el('div', 'fl-escolha-linha'); botoes.appendChild(salvar); botoes.appendChild(tirar);
    form.appendChild(botoes); form.appendChild(recado);
    det.appendChild(form);
    async function enviar(ativo) {
      if (!nome.value.trim()) { recado.className = 'fl-recado fl-recado-erro'; recado.textContent = 'Escreva o nome.'; return; }
      if (tel.value.trim() && digitos(tel.value).length < 10) { recado.className = 'fl-recado fl-recado-erro'; recado.textContent = 'Telefone curto: ponha o DDD.'; return; }
      salvar.disabled = true; tirar.disabled = true;
      var ok = await gravar('freela_editar', { p_id: Number(contato.id), p_nome: nome.value.trim(), p_telefone: tel.value.trim(),
        p_setor: setor.value || null, p_chamado: ch.input.checked, p_ativo: ativo }, recado);
      salvar.disabled = false; tirar.disabled = false;
      if (ok && aoMudar) aoMudar();
    }
    salvar.addEventListener('click', function () { enviar(true); });
    tirar.addEventListener('click', function () { enviar(false); });
    return det;
  }

  // Acrescenta "Arrumar" e "Trocar loja" no cartão de um contato que já tem loja.
  function enfeitarContato(card, contato) {
    if (!LOJAS || !contato || contato.id == null || !contato.loja) return;
    card.appendChild(arrumar(contato));
    var outras = LOJAS.filter(function (l) { return chave(l) !== chave(contato.loja); });
    if (!outras.length) return;
    var det = el('details', 'fl-trocar');
    det.appendChild(el('summary', null, 'Trocar loja'));
    det.appendChild(linhaEscolha(contato.id, LOJAS, contato.loja, 'Trocar', function () { if (aoMudar) aoMudar(); }));
    card.appendChild(det);
  }

  // "Nova pessoa": nome, telefone, setor, loja (uma das suas) e se já chamamos direto.
  async function montarNova() {
    var box = $('novaPessoa');
    if (!box) return;
    var lojas = await minhasLojas();
    box.textContent = '';
    if (!lojas || !lojas.length) { box.hidden = true; return; }
    box.hidden = false;
    var det = el('details', 'fl-nova');
    det.appendChild(el('summary', null, '➕ Nova pessoa'));
    var nome = texto('', 120), tel = texto('', 25, 'tel'), setor = seletorSetor(null), loja = seletor(lojas, null);
    var ch = caixa('Já chamamos direto', false);
    var recado = el('p', 'fl-recado'); recado.setAttribute('role', 'status');
    var btn = el('button', 'fl-btn', 'Adicionar'); btn.type = 'button';
    var form = el('div', 'fl-form');
    [campo('Nome', nome), campo('Telefone', tel), campo('Setor', setor), campo('Loja', loja)].forEach(function (c) { form.appendChild(c); });
    form.appendChild(ch.label); form.appendChild(btn); form.appendChild(recado);
    det.appendChild(form);
    btn.addEventListener('click', async function () {
      if (!nome.value.trim()) { recado.className = 'fl-recado fl-recado-erro'; recado.textContent = 'Escreva o nome.'; return; }
      if (!loja.value) { recado.className = 'fl-recado fl-recado-erro'; recado.textContent = 'Escolha a loja.'; return; }
      if (tel.value.trim() && digitos(tel.value).length < 10) { recado.className = 'fl-recado fl-recado-erro'; recado.textContent = 'Telefone curto: ponha o DDD.'; return; }
      btn.disabled = true;
      var ok = await gravar('freela_adicionar', { p_nome: nome.value.trim(), p_telefone: tel.value.trim(), p_setor: setor.value || null,
        p_loja: loja.value, p_chamado: ch.input.checked }, recado);
      btn.disabled = false;
      if (ok) { nome.value = ''; tel.value = ''; ch.input.checked = false; if (aoMudar) aoMudar(); }
    });
    box.appendChild(det);
  }

  function definirLojas(lojas) {
    LOJAS = Array.isArray(lojas) ? lojas.filter(function (l) { return l && chave(l) !== 'REDE'; }) : null;
  }

  function esquecer() { LOJAS = null; SEQ++; var b = $('semLoja'); if (b) { b.textContent = ''; b.hidden = true; } }

  window.FreelasLoja = {
    carregarSemLoja: function () { montarNova(); return carregarSemLoja(); },
    enfeitarContato: enfeitarContato,
    esquecer: esquecer,
    definirLojas: definirLojas,
    aoMudar: function (fn) { aoMudar = fn; }
  };
})();
