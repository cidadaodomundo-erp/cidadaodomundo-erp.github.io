// Horário de cada pessoa (entrada e saída fixas), usado pela Consulta de ponto para "saiu mais cedo" e "hora extra".
// Vale até alguém mudar. Lê e grava só pelas funções do banco ponto_horarios_listar / ponto_horario_salvar
// (elas conferem a permissão de RH e a loja). Painel abaixo da Consulta de ponto; não guarda nada no navegador.
(function () {
  'use strict';
  var original = window.entrarPesPonto;
  var ligado = false, pode = false, gen = 0;
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function caixa() { return document.getElementById('view-phorarios'); }
  async function rpc(fn, args) {
    var r = await trRpc(fn, args);
    if (!r.ok) { var m = ''; try { m = (await r.json()).message || ''; } catch (e) { } throw new Error(m || ('HTTP ' + r.status)); }
    var t = await r.text(); return t ? JSON.parse(t) : null;
  }
  async function carregar() {
    var box = caixa(); if (!box) return;
    var g = ++gen, loja = typeof lojaAtual === 'function' ? lojaAtual() : null;
    box.replaceChildren();
    if (!loja || loja === 'REDE') return;
    var det = el('details', 'phor'); var sum = el('summary', 'phor-tit', 'Horário de cada pessoa');
    det.appendChild(sum);
    det.appendChild(el('p', 'phor-nota', 'Usado para marcar "saiu mais cedo" e "hora extra". Vale até alguém mudar. Deixe em branco quem não tem horário fixo.'));
    var st = el('p', 'phor-nota', 'Carregando…'); det.appendChild(st);
    box.appendChild(det);
    var lista;
    try { lista = await rpc('ponto_horarios_listar', { p_unidade: loja }); }
    catch (e) { if (g === gen) st.textContent = 'Não foi possível carregar os horários agora.'; return; }
    try { pode = (await rpc('pode_cadastrar_pessoal', {})) === true; } catch (e) { pode = false; }
    if (g !== gen) return;
    st.textContent = pode ? '' : 'Só quem cadastra o RH pode mudar os horários.';
    var tab = el('table', 'pcart-tab phor-tab'), cab = el('tr');
    ['Pessoa', 'Entrada', 'Saída', ''].forEach(function (t) { cab.appendChild(el('th', null, t)); });
    var th = el('thead'); th.appendChild(cab); tab.appendChild(th);
    var tb = el('tbody');
    (Array.isArray(lista) ? lista : []).forEach(function (p) {
      var tr = el('tr'), td = function (rot, n) { var c = el('td'); c.setAttribute('data-rot', rot); c.appendChild(n); tr.appendChild(c); return c; };
      td('Pessoa', document.createTextNode(p.nome));
      var e = el('input'); e.type = 'time'; e.value = p.entrada || ''; e.disabled = !pode;
      var s = el('input'); s.type = 'time'; s.value = p.saida || ''; s.disabled = !pode;
      td('Entrada', e); td('Saída', s);
      var b = el('button', 'pcart-btn', 'Salvar'); b.type = 'button'; b.hidden = !pode;
      var ok = el('span', 'phor-ok');
      var c = td('', b); c.appendChild(ok);
      if (!p.entrada) tr.className = 'phor-vazio';
      b.addEventListener('click', async function () {
        if ((e.value === '') !== (s.value === '')) { ok.textContent = 'Preencha entrada e saída (ou deixe as duas em branco).'; return; }
        if (e.value && e.value === s.value) { ok.textContent = 'Entrada e saída não podem ser iguais.'; return; }
        b.disabled = true; ok.textContent = 'Salvando…';
        try {
          await rpc('ponto_horario_salvar', { p_unidade: loja, p_nome: p.nome, p_entrada: e.value || null, p_saida: s.value || null });
          ok.textContent = '✓ salvo'; tr.className = e.value ? '' : 'phor-vazio';
        } catch (x) { ok.textContent = '✗ não salvou: ' + x.message; }
        b.disabled = false;
      });
      tb.appendChild(tr);
    });
    tab.appendChild(tb);
    var rol = el('div', 'pcart-rolagem'); rol.appendChild(tab); det.appendChild(rol);
  }
  window.entrarPesPonto = function () {
    var r = typeof original === 'function' ? original.apply(this, arguments) : undefined;
    if (!ligado && typeof aoMudarLoja === 'function') { ligado = true; aoMudarLoja(carregar); }
    carregar();
    return r;
  };
})();
