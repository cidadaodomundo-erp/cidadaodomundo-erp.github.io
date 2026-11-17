// BOTÃO AJUDA (dono, sex 30/10/2026 11:55 e 11:59: "um botão ajuda nas telas, ele serviria para comunicação entre o usuário e vc,
// pra dúvidas, sugestões e outros assuntos"; proposta contexto/propostas-telas/2026-10-30-botao-ajuda.md).
// Na casca fica na barra do topo; página aberta fora da casca ganha o botão no canto (nucleo.js carrega este arquivo).
// Grava por painel_ajuda_gravar: o login vem do token. Nunca select=* na painel_ajuda (a coluna interna é fechada) e "Meus pedidos"
// filtra sempre pelo login, porque Neto e Fabio recebem os de todos. O resultado fica na própria janela: enviando → ✓ com a hora /
// ✗ com o motivo + Tentar de novo; o texto só some depois do ✓.
(function () {
  const COLS = 'id,criado_em,email,tela,loja,tipo,texto,print_url,estado,resposta,respondido_em,encaminhado_a,resolvido_em';
  const ESTADO = { aberto: 'Recebido', encaminhado: 'Em análise', respondido: 'Respondido', resolvido: 'Resolvido' };
  const TIPOS = [['duvida', 'Dúvida'], ['sugestao', 'Sugestão'], ['erro', 'Erro']];
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  const MAX_PRINT = 5 * 1024 * 1024;
  const A = { tipo: null, arquivo: null, printUrl: null, caminho: null, enviando: false };
  const h = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const el = (id) => document.getElementById(id);
  const naBarra = () => { const a = el('acoes'); return a && a.parentElement && a.parentElement.classList.contains('top') ? a : null; };

  function sessaoAj() { try { return JSON.parse(localStorage.getItem('rmbSessao') || 'null'); } catch (e) { return null; } }
  const emailAj = () => String((sessaoAj() || {}).email || '').trim().toLowerCase();
  function hdr(extra) { return Object.assign({ apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + ((sessaoAj() || {}).access_token || SUPABASE_ANON_KEY) }, extra || {}); }
  // renova o token do jeito do núcleo; recusa aqui nunca apaga a sessão — quem decide isso é o núcleo das telas
  async function renovarAj() {
    if (typeof rmbRenovar === 'function') return rmbRenovar();
    const s = sessaoAj();
    if (!s || !s.refresh_token) return false;
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    const n = await r.json().catch(() => ({}));
    if (!r.ok || !n.access_token) return false;
    localStorage.setItem('rmbSessao', JSON.stringify({ access_token: n.access_token, refresh_token: n.refresh_token, email: s.email,
      expira_em: Date.now() + ((n.expires_in || 3600) * 1000) }));
    return true;
  }
  async function pedir(url, op) {
    const s = sessaoAj();
    if (s && s.expira_em && Date.now() > s.expira_em - 60000) await renovarAj();
    const faz = () => fetch(url, Object.assign({}, op, { headers: hdr((op || {}).headers) }));
    let r = await faz();
    if (r.status === 401 && await renovarAj()) r = await faz();
    return r;
  }
  async function motivo(r) {
    const d = await r.json().catch(() => ({}));
    return d.message || d.error || d.msg || `o servidor respondeu ${r.status}`;
  }
  function contexto() {
    if (naBarra() && typeof ATUAL !== 'undefined') return { tela: ATUAL || 'inicio', loja: typeof lojaAtual === 'function' ? lojaAtual() : null };
    const p = location.pathname.split('/').filter(Boolean);
    const ult = p[p.length - 1] || '';
    return { tela: (/index\.html$/.test(ult) || !ult ? p[p.length - 2] || 'inicio' : ult.replace(/\.html$/, '')) + (location.hash ? ' ' + location.hash.slice(1) : ''),
             loja: typeof lojaAtual === 'function' ? lojaAtual() : null };
  }
  function rotuloTela(t) { try { if (typeof ITENS !== 'undefined' && ITENS[t]) return ITENS[t].rotulo; } catch (e) {} return t === 'inicio' ? 'Início' : (t || ''); }
  const quando = (v) => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';

  function estilo() {
    if (el('ajEstilo')) return;
    const s = document.createElement('style'); s.id = 'ajEstilo';
    s.textContent = `
      #btnAjuda { position:relative; }
      #btnAjuda[hidden] { display:none; }
      #btnAjuda.aj-solto { position:fixed; right:14px; bottom:14px; z-index:9000; padding:8px 14px; border-radius:8px; cursor:pointer; font:inherit; font-size:13px; font-weight:700;
        background:var(--surface,#1e1e1c); color:var(--tx-1,#fff); border:1px solid var(--line-2,#45443f); }
      #btnAjuda .aj-ponto { position:absolute; top:-3px; right:-3px; width:9px; height:9px; border-radius:50%; background:var(--marca-amarelo,#f6c63e); }
      #ajFundo { position:fixed; inset:0; z-index:10100; background:rgba(0,0,0,.6); display:flex; justify-content:center; align-items:flex-start; padding:5vh 16px; overflow:auto; }
      #ajFundo[hidden] { display:none; }
      #ajJanela { width:100%; max-width:560px; background:var(--surface,#1e1e1c); color:var(--tx-1,#fff); border:1px solid var(--line-2,#45443f); border-radius:12px; padding:18px; font-size:14px; line-height:1.4; text-align:left; }
      #ajJanela h3 { margin:0; font-size:17px; color:var(--tx-1,#fff); }
      #ajJanela h4 { margin:18px 0 8px; font-size:14px; color:var(--tx-1,#fff); }
      #ajJanela textarea { width:100%; box-sizing:border-box; min-height:110px; padding:10px; border-radius:8px; resize:vertical; font:inherit; background:var(--bg,#111110); color:var(--tx-1,#fff); border:1px solid var(--line-2,#45443f); }
      .aj-linha { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:10px 0; }
      .aj-btn { padding:7px 12px; border-radius:8px; cursor:pointer; font:inherit; font-size:13px; background:transparent; color:var(--tx-1,#fff); border:1px solid var(--line-2,#45443f); }
      .aj-btn.ativo { background:var(--surface-2,#2a2a27); border-color:var(--marca-amarelo,#f6c63e); font-weight:700; }
      .aj-btn.forte { background:var(--marca-amarelo,#f6c63e); border-color:var(--marca-amarelo,#f6c63e); color:#111110; font-weight:700; padding:9px 18px; }
      .aj-btn:disabled { opacity:.55; cursor:default; }
      #ajResultado { margin:10px 0 0; font-weight:700; font-size:14px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
      .aj-item { border-top:1px solid var(--line,#34332f); padding:9px 0; }
      .aj-meta { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; font-size:12px; color:var(--tx-3,#a5a49a); }
      .aj-texto { margin-top:3px; white-space:pre-wrap; overflow-wrap:anywhere; }
      .aj-resposta { margin-top:6px; padding:7px 10px; border-left:3px solid var(--marca-amarelo,#f6c63e); background:var(--surface-2,#2a2a27); white-space:pre-wrap; overflow-wrap:anywhere; }
      #ajJanela a { color:var(--marca-amarelo,#f6c63e); }`;
    document.head.appendChild(s);
  }
  function resultado(estado, texto, refazer) {
    const b = el('ajResultado');
    if (!b) return;
    const cor = { ok: 'var(--farol-ok,#3fb950)', erro: 'var(--farol-fora,#ff6b6b)', atencao: 'var(--marca-amarelo,#f6c63e)' }[estado] || 'var(--tx-3,#a5a49a)';
    b.innerHTML = texto ? `<span style="color:${cor};flex:1 1 200px;">${h(texto)}</span>` + (refazer ? '<button type="button" class="aj-btn" id="ajRefazer">Tentar de novo</button>' : '') : '';
    if (texto && refazer) el('ajRefazer').onclick = refazer;
  }
  function pintarTipos() { TIPOS.forEach(([k]) => { const b = el('ajTipo_' + k); if (b) b.classList.toggle('ativo', A.tipo === k); }); }
  function pintarPrint() {
    const n = el('ajPrintNome');
    if (n) n.innerHTML = A.arquivo ? `${h(A.arquivo.name || 'print colado')} <button type="button" class="aj-btn" id="ajPrintTira">tirar</button>` : '';
    if (n && A.arquivo) el('ajPrintTira').onclick = () => { limparPrint(); pintarPrint(); };
  }
  function limparPrint() { A.arquivo = null; A.printUrl = null; A.caminho = null; const i = el('ajPrint'); if (i) i.value = ''; }
  function escolherPrint(f) {
    if (!f) return;
    if (!EXT[f.type]) return resultado('atencao', '! Print precisa ser PNG, JPG ou WEBP.');
    if (f.size > MAX_PRINT) return resultado('atencao', '! Print maior que 5 MB. Use um menor.');
    A.arquivo = f; A.printUrl = null; A.caminho = null; resultado(null, ''); pintarPrint();
  }
  // sobe uma vez só: Tentar de novo reaproveita o print que já subiu
  async function subirPrint() {
    if (!A.arquivo || A.printUrl) return A.printUrl;
    if (!A.caminho) A.caminho = `${emailAj()}/${Date.now()}.${EXT[A.arquivo.type]}`;
    const up = await pedir(`${SUPABASE_URL}/storage/v1/object/ajuda-prints/${A.caminho}`, { method: 'POST', headers: { 'Content-Type': A.arquivo.type }, body: A.arquivo });
    if (!up.ok) {
      const t = await up.text().catch(() => '');
      if (!/duplicate|already exists/i.test(t)) throw new Error(`o print não subiu (${up.status})`);
    }
    const sg = await pedir(`${SUPABASE_URL}/storage/v1/object/sign/ajuda-prints/${A.caminho}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 2592000 }) });
    const d = sg.ok ? await sg.json() : {};
    if (!d.signedURL) throw new Error(`o print não subiu (${sg.status})`);
    A.printUrl = `${SUPABASE_URL}/storage/v1${d.signedURL}`;
    return A.printUrl;
  }
  async function enviar() {
    if (A.enviando) return;
    const texto = el('ajTexto').value.trim();
    if (!texto) return resultado('atencao', '! Escreva o que você precisa.');
    A.enviando = true; el('ajEnviar').disabled = true;
    resultado('enviando', 'Enviando…');
    try {
      const print = await subirPrint();
      const c = contexto();
      const r = await pedir(`${SUPABASE_URL}/rest/v1/rpc/painel_ajuda_gravar`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_tela: c.tela, p_loja: c.loja, p_tipo: A.tipo, p_texto: texto, p_print_url: print }) });
      if (!r.ok) throw new Error(await motivo(r));
      el('ajTexto').value = ''; A.tipo = null; limparPrint(); pintarTipos(); pintarPrint();
      resultado('ok', `✓ Recebemos o seu pedido — às ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}.`);
      carregarLista();
    } catch (e) {
      const m = e && e.message === 'Failed to fetch' ? 'sem conexão' : (e && e.message) || 'erro desconhecido';
      resultado('erro', `✗ Não chegou: ${m}`, enviar);
    } finally { A.enviando = false; const b = el('ajEnviar'); if (b) b.disabled = false; }
  }
  async function carregarLista() {
    const c = el('ajLista');
    if (!c) return;
    try {
      const r = await pedir(`${SUPABASE_URL}/rest/v1/painel_ajuda?select=${COLS}&email=eq.${encodeURIComponent(emailAj())}&order=criado_em.desc&limit=50`, {});
      if (!r.ok) throw new Error(await motivo(r));
      const L = await r.json();
      c.innerHTML = L.length ? L.map((x) => `<div class="aj-item">
          <div class="aj-meta"><span>${quando(x.criado_em)} · ${h(rotuloTela(x.tela))}</span><b style="color:${x.resposta ? 'var(--marca-amarelo,#f6c63e)' : 'var(--tx-2,#c3c2b7)'};">${h(ESTADO[x.estado] || x.estado)}</b></div>
          <div class="aj-meta" style="margin-top:2px;">${x.respondido_em || x.resolvido_em ? `<span style="color:var(--farol-ok,#5cb85c);">✓ tratado ${quando(x.respondido_em || x.resolvido_em)}</span>` : `<span>recebido ${quando(x.criado_em)} — em análise</span>`}</div>
          <div class="aj-texto">${h(x.texto)}</div>
          ${x.print_url ? `<div style="font-size:12px;margin-top:3px;"><a href="${h(x.print_url)}" target="_blank" rel="noopener">ver print</a></div>` : ''}
          ${x.resposta ? `<div class="aj-resposta">${h(x.resposta)}</div>` : ''}</div>`).join('') : '<div class="aj-meta">Nenhum pedido ainda.</div>';
      const ult = L.map((x) => x.respondido_em).filter(Boolean).sort().pop();
      if (ult) { try { localStorage.setItem('ajudaVisto:' + emailAj(), ult); } catch (e) {} }
      ponto(false);
    } catch (e) { c.innerHTML = `<div class="aj-meta" style="color:var(--farol-fora,#ff6b6b);">✗ Não consegui ler os pedidos: ${h(e.message)}</div>`; }
  }
  function abrirAjuda() {
    estilo();
    let f = el('ajFundo');
    if (f) { f.hidden = false; carregarLista(); el('ajTexto').focus(); return; }
    f = document.createElement('div'); f.id = 'ajFundo';
    f.innerHTML = `<div id="ajJanela" role="dialog" aria-modal="true" aria-labelledby="ajTitulo">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><h3 id="ajTitulo">Ajuda</h3><button type="button" class="aj-btn" id="ajFechar">✕ fechar</button></div>
        <div class="aj-linha">${TIPOS.map(([k, r]) => `<button type="button" class="aj-btn" id="ajTipo_${k}">${r}</button>`).join('')}</div>
        <textarea id="ajTexto" maxlength="2000" aria-label="O que você precisa" placeholder="O que você precisa?"></textarea>
        <div class="aj-linha"><label class="aj-btn" style="display:inline-block;">📎 Anexar print<input type="file" id="ajPrint" accept="image/png,image/jpeg,image/webp" style="display:none;"></label><span id="ajPrintNome" style="font-size:12px;"></span></div>
        <div class="aj-linha"><button type="button" class="aj-btn forte" id="ajEnviar">Enviar</button></div>
        <div id="ajResultado" role="status" aria-live="polite"></div>
        <h4>Meus pedidos</h4><div id="ajLista"><div class="aj-meta">Lendo…</div></div></div>`;
    document.body.appendChild(f);
    const fechar = () => { f.hidden = true; };
    el('ajFechar').onclick = fechar;
    f.addEventListener('mousedown', (e) => { if (e.target === f) fechar(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !f.hidden) fechar(); });
    TIPOS.forEach(([k]) => { el('ajTipo_' + k).onclick = () => { A.tipo = A.tipo === k ? null : k; pintarTipos(); }; });
    el('ajPrint').onchange = (e) => escolherPrint(e.target.files[0]);
    el('ajTexto').addEventListener('paste', (e) => { const it = [...((e.clipboardData || {}).items || [])].find((i) => i.type.startsWith('image/')); if (it) { escolherPrint(it.getAsFile()); e.preventDefault(); } });
    el('ajEnviar').onclick = enviar;
    carregarLista(); el('ajTexto').focus();
  }
  function ponto(tem) {
    const b = el('btnAjuda'); if (!b) return;
    const p = b.querySelector('.aj-ponto');
    if (tem && !p) { const s = document.createElement('span'); s.className = 'aj-ponto'; b.appendChild(s); b.title = 'Tem resposta nova'; }
    if (!tem && p) { p.remove(); b.title = ''; }
  }
  // resposta nova: um ponto no botão, que some ao abrir "Meus pedidos"
  async function vigiar() {
    const b = el('btnAjuda'), s = sessaoAj();
    if (b) b.hidden = !s;
    if (!s || document.hidden) return;
    try {
      const r = await pedir(`${SUPABASE_URL}/rest/v1/painel_ajuda?select=respondido_em&email=eq.${encodeURIComponent(emailAj())}&respondido_em=not.is.null&order=respondido_em.desc&limit=1`, {});
      if (!r.ok) return;
      const [x] = await r.json();
      let visto = null; try { visto = localStorage.getItem('ajudaVisto:' + emailAj()); } catch (e) {}
      ponto(!!x && (!visto || new Date(x.respondido_em) > new Date(visto)));
    } catch (e) {}
  }
  function instalar() {
    if (el('btnAjuda')) return;
    estilo();
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'btnAjuda'; b.textContent = 'Ajuda'; b.onclick = abrirAjuda;
    const a = naBarra();
    if (a) { b.className = 'btn'; b.style.marginLeft = '8px'; b.style.flexShrink = '0'; a.parentElement.insertBefore(b, a.nextSibling); }
    else { b.className = 'aj-solto'; document.body.appendChild(b); }
    vigiar(); setInterval(vigiar, 5 * 60000);
  }
  if (document.body) instalar(); else document.addEventListener('DOMContentLoaded', instalar);
})();
