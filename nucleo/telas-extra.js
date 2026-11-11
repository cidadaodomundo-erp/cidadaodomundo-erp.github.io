// Peça comum das telas que vêm do portal anterior (06/11/2026, Fase 0 da migração).
// Carrega DEPOIS de nucleo.js. Não lê banco nenhum e não grava nada: só ajuda a tela.
//   1) Ordenar qualquer tabela clicando no título da coluna (clique de novo inverte).
//      Título que já tem onclick próprio, ou com data-sem-ordem, fica de fora.
//   2) Carimbo "dados até": carimboDados(elemento, quando, {avisoMin, velhoMin}) põe ao lado do título
//      um selo verde/amarelo/vermelho com a hora do dado mais novo que a tela recebeu.
// Não tem caixa de anotação de propósito (definição administrativa de 06/11: anotação não atravessa para o ERP).
(function () {
  'use strict';

  var st = document.createElement('style');
  st.textContent =
    'table th:not([onclick]):not([data-sem-ordem]){cursor:pointer;-webkit-user-select:none;user-select:none}' +
    'table th[data-ord]::after{content:" \\25B2";font-size:9px;opacity:.8}' +
    'table th[data-ord="d"]::after{content:" \\25BC"}' +
    '.carimbo-dados{display:inline-block;font-size:11px;line-height:1.5;padding:1px 8px;border-radius:999px;' +
    'border:1px solid currentColor;margin-left:8px;white-space:nowrap;vertical-align:middle}' +
    '.carimbo-dados.ok{color:#38b26a}.carimbo-dados.atencao{color:#e0a33a}.carimbo-dados.velho{color:#e2574c}';
  (document.head || document.documentElement).appendChild(st);

  // ---------- 1) ordenar pelo título ----------
  function valor(c) {
    var t = (c.getAttribute('data-valor') != null ? c.getAttribute('data-valor') : c.textContent).trim();
    var d = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(\d{1,2}):(\d{2}))?/);
    if (d) {
      var ano = d[3] ? (d[3].length === 2 ? 2000 + +d[3] : +d[3]) : 2000;
      return ano * 1e8 + (+d[2]) * 1e6 + (+d[1]) * 1e4 + (d[4] ? +d[4] * 100 + +d[5] : 0);
    }
    var n = t.replace(/R\$|%|\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    if (n !== '' && n !== '-' && !isNaN(n)) return +n;
    return t.toLocaleLowerCase('pt-BR');
  }
  document.addEventListener('click', function (ev) {
    var th = ev.target.closest && ev.target.closest('th');
    if (!th || th.hasAttribute('onclick') || th.hasAttribute('data-sem-ordem')) return;
    if (ev.target.closest('a,button,input,select,label')) return;
    var tab = th.closest('table'), linhaCab = th.parentElement;
    if (!tab || !linhaCab) return;
    var col = Array.prototype.indexOf.call(linhaCab.cells, th);
    var corpo = tab.tBodies[0];
    if (!corpo || col < 0) return;
    var desc = th.getAttribute('data-ord') === 'c';
    Array.prototype.forEach.call(linhaCab.cells, function (c) { c.removeAttribute('data-ord'); });
    th.setAttribute('data-ord', desc ? 'd' : 'c');
    var linhas = Array.prototype.filter.call(corpo.rows, function (r) { return r.parentElement === corpo && r !== linhaCab; });
    linhas.sort(function (a, b) {
      var x = a.cells[col] ? valor(a.cells[col]) : '', y = b.cells[col] ? valor(b.cells[col]) : '';
      if (typeof x !== typeof y) { x = String(x); y = String(y); }
      var r = typeof x === 'string' ? x.localeCompare(y, 'pt-BR', { sensitivity: 'base', numeric: true }) : (x < y ? -1 : x > y ? 1 : 0);
      return desc ? -r : r;
    });
    linhas.forEach(function (r) { corpo.appendChild(r); });
  });

  // ---------- 2) carimbo "dados até" ----------
  // quando: Date, texto ISO ou número (ms). avisoMin: a partir de quantos minutos fica amarelo (padrão 30);
  // velhoMin: a partir de quantos fica vermelho (padrão 180). Sem data: mostra "sem dado" em vermelho.
  window.carimboDados = function (alvo, quando, opc) {
    opc = opc || {};
    var el = typeof alvo === 'string' ? document.querySelector(alvo) : alvo;
    if (!el) return null;
    var c = el.querySelector(':scope > .carimbo-dados');
    if (!c) { c = document.createElement('span'); c.className = 'carimbo-dados'; el.appendChild(c); }
    var d = quando == null || quando === '' ? null : new Date(quando);
    if (!d || isNaN(d)) { c.className = 'carimbo-dados velho'; c.textContent = 'sem dado'; c.title = 'A tela não recebeu data do dado.'; return c; }
    var min = (Date.now() - d.getTime()) / 60000;
    var tz = { timeZone: 'America/Sao_Paulo' };
    var hora = d.toLocaleTimeString('pt-BR', Object.assign({ hour: '2-digit', minute: '2-digit' }, tz));
    var dia = d.toLocaleDateString('pt-BR', Object.assign({ day: '2-digit', month: '2-digit' }, tz));
    var hoje = new Date().toLocaleDateString('pt-BR', Object.assign({ day: '2-digit', month: '2-digit' }, tz));
    c.className = 'carimbo-dados ' + (min >= (opc.velhoMin || 180) ? 'velho' : min >= (opc.avisoMin || 30) ? 'atencao' : 'ok');
    c.textContent = 'dados até ' + (dia === hoje ? hora : dia + ' ' + hora);
    c.title = 'Dado mais novo recebido por esta tela: ' + dia + ' ' + hora;
    return c;
  };
})();

