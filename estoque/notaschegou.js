// NOTAS QUE CHEGARAM (ter 17/11/2026, chat Telas; robô da NF passo 3, proposta do Estoque
// contexto/propostas-telas/2026-11-17-chegou-notas-de-compra.md). A nota de compra chega por e-mail; aqui se confere se a
// mercadoria chegou e a Rita ensina o item novo. Fontes: vw_compra_nf_a_conferir (lista) e vw_compra_nf_pre_entrada (itens).
// Grava só por função: compra_nf_marcar_chegou (DONO, FINANCEIRO, SEPARACAO), compra_item_ensinar e
// compra_item_fora_do_estoque (só DONO). O banco confere o papel de novo; os erros vêm em português.
let NFC = null;   // { L, papel, filtro, aberta, itens: {chave: [...]}, base, modo: {chave: 'dif'|'nao'}, mais }
const nfcE = (s) => trEscH(String(s == null ? '' : s));
const nfcQ = (s) => nfcE(JSON.stringify(String(s)));
const nfcD = (d) => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(2, 4) : '–';
const nfcN = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const nfcR = (v) => 'R$ ' + fmt(Number(v) || 0);
const nfcLoja = (u) => ({ 'AGUA VERDE': 'Água Verde', AHU: 'Ahú', 'SÃO BRAZ': 'São Braz', 'SAO BRAZ': 'São Braz', BOQUEIRAO: 'Boqueirão' }[u] || u || '');
const nfcCnpj = (chave) => String(chave || '').slice(6, 20);   // a chave da NF-e traz o CNPJ de quem emitiu nas posições 7 a 20
const NFC_COR = { verde: 'var(--farol-ok)', amarelo: 'var(--farol-perto)', vermelho: 'var(--farol-fora)', cinza: 'var(--tx-4)' };
function nfcTom(t) {
  const x = String(t || '').toUpperCase();
  if (x === 'APRENDIDO' || x === 'ENSINADO') return ['verde', 'reconhecido'];
  if (x === 'VISTO 1 VEZ' || x === 'DUAS OPCOES') return ['amarelo', 'confira'];
  if (x === 'ITEM NOVO') return ['vermelho', 'item novo'];
  if (x === 'NAO E DE ESTOQUE') return ['cinza', 'não é de estoque'];
  return ['cinza', x.toLowerCase()];
}
const NFC_SIT = { CHEGOU_OK: ['verde', 'chegou certo'], CHEGOU_DIFERENCA: ['amarelo', 'chegou com diferença'], NAO_CHEGOU: ['vermelho', 'não chegou'] };

async function entrarNotasChegou() {
  const alvo = document.getElementById('view-notaschegou');
  if (!alvo) return;
  if (!NFC) {
    NFC = { L: null, papel: null, filtro: 'falta', aberta: null, itens: {}, base: null, modo: {}, mais: false };
    if (typeof lojaCarregar === 'function' && await lojaCarregar()) aoMudarLoja(() => nfcDesenhar());
  }
  if (!NFC.L) alvo.innerHTML = '<h2>Notas que chegaram</h2><div class="contexto">Carregando…</div>';
  try {
    // 18/11/2026 (Estoque; dono 00:51 "com o motivo à vista"): as notas que saíram da fila por não serem de estoque (ML no cartão)
    const desde = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const [L, rp, fora] = await Promise.all([
      consultarTudo('vw_compra_nf_a_conferir?select=*&order=data_emissao.desc,numero.desc'),
      NFC.papel === null ? trRpcSeguro('tr_meu_papel') : null,
      consultarTudo(`vw_compra_nf_fora_da_fila?select=chave,unidade,numero,data_emissao,fornecedor,total,motivo&data_emissao=gte.${desde}&order=data_emissao.desc`).catch(() => null)]);
    NFC.L = L; NFC.fora = fora;
    if (rp) NFC.papel = rp.ok ? (await rp.json().catch(() => '')) || '' : '';
  } catch (e) {
    alvo.innerHTML = `<h2>Notas que chegaram</h2><div class="contexto" style="border-color:var(--farol-fora);">✗ Não carregou: ${nfcE(e.message)} <button type="button" class="preset-btn" onclick="entrarNotasChegou()">Tentar de novo</button></div>`;
    return;
  }
  nfcDesenhar();
}
const nfcPodeMarcar = () => ['DONO', 'FINANCEIRO', 'SEPARACAO'].includes(String(NFC.papel || '').toUpperCase());
const nfcPodeEnsinar = () => String(NFC.papel || '').toUpperCase() === 'DONO';
function nfcFiltrar(f) { NFC.filtro = NFC.filtro === f ? 'todas' : f; NFC.mais = false; nfcDesenhar(); }

function nfcDesenhar() {
  const alvo = document.getElementById('view-notaschegou');
  if (!alvo || !NFC || !NFC.L) return;
  const loja = typeof lojaAtual === 'function' ? lojaAtual() : null;
  const daLoja = NFC.L.filter((n) => !loja || loja === 'REDE' || n.unidade === loja);
  const falta = daLoja.filter((n) => !n.situacao), novo = falta.filter((n) => Number(n.itens_novos) > 0), feitas = daLoja.filter((n) => n.situacao);
  const vis = NFC.filtro === 'falta' ? falta : NFC.filtro === 'novo' ? novo : NFC.filtro === 'feitas' ? feitas : daLoja;
  const mostra = NFC.mais ? vis : vis.slice(0, 60);
  const card = (k, cls, rot, n, sub) => `<div class="card ${cls}" style="cursor:pointer;${NFC.filtro === k ? ' outline:2px solid var(--marca-amarelo);' : ''}" onclick="nfcFiltrar('${k}')">
      <div class="card-lbl">${rot}</div><div class="card-val">${n}</div><div class="card-pct">${sub}</div></div>`;
  let h = `<h2>Notas que chegaram</h2>
    <div class="contexto" style="text-align:left;">Nota de compra que chegou por e-mail: confira se a mercadoria chegou. Item novo, a Rita ensina uma vez e o robô aprende.</div>
    <div class="cards cards-3">
      ${card('falta', falta.length ? 'highlight' : 'pos', 'Faltam conferir', falta.length, 'clique na nota para abrir')}
      ${card('novo', novo.length ? 'neg' : 'pos', 'Com item novo', novo.length, 'a Rita ensina o item')}
      ${card('feitas', 'neutral', 'Já conferidas', feitas.length, 'chegou, diferença ou não chegou')}
    </div>
    ${NFC.filtro !== 'todas' ? `<div style="margin:6px 0;"><button type="button" class="preset-btn" onclick="nfcFiltrar(NFC.filtro)">${{ falta: 'faltam conferir', novo: 'com item novo', feitas: 'já conferidas' }[NFC.filtro]} ✕</button></div>` : ''}
    <div id="tabelaNotasChegou"><table><thead><tr><th>Data</th><th>Loja</th><th>Fornecedor</th><th>Nota</th><th>Total</th><th>Itens</th><th>Situação</th></tr></thead><tbody>
    ${mostra.length ? mostra.map(nfcLinha).join('') : '<tr><td colspan="7">Nenhuma nota neste filtro. ✓</td></tr>'}</tbody></table></div>
    ${vis.length > mostra.length ? `<div style="margin:8px 0;"><button type="button" class="preset-btn" onclick="NFC.mais=true;nfcDesenhar()">Mostrar as outras ${vis.length - mostra.length}</button></div>` : ''}`;
  const fora = (NFC.fora || []).filter((n) => !loja || loja === 'REDE' || n.unidade === loja);
  if (fora.length) h += `<details style="margin-top:14px;"><summary style="cursor:pointer;color:var(--tx-3);">Saíram da fila: ${fora.length} ${fora.length === 1 ? 'nota' : 'notas'} — não são de estoque (últimos 30 dias)</summary>
    <div id="tabelaNotasFora"><table><thead><tr><th>Data</th><th>Loja</th><th>Fornecedor</th><th>Nota</th><th>Total</th><th>Por que saiu</th></tr></thead><tbody>
    ${fora.map((n) => `<tr><td>${nfcE(String(n.data_emissao || '').slice(8, 10) + '/' + String(n.data_emissao || '').slice(5, 7))}</td><td>${nfcE(n.unidade || '')}</td><td style="white-space:normal;">${nfcE(n.fornecedor || '')}</td><td>${nfcE(n.numero || '')}</td><td>R$ ${Number(n.total || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td style="white-space:normal;">${nfcE(n.motivo || '')}</td></tr>`).join('')}
    </tbody></table></div></details>`;
  alvo.innerHTML = h;
}
function nfcSelo(n) {
  const tot = Number(n.itens) || 0, ok = Number(n.itens_traduzidos) || 0, nv = Number(n.itens_novos) || 0, cf = Number(n.itens_a_confirmar) || 0;
  const p = [`<span style="color:${ok === tot ? NFC_COR.verde : 'var(--tx-2)'};">${ok} de ${tot} reconhecidos</span>`];
  if (cf) p.push(`<span style="color:${NFC_COR.amarelo};">${cf} a conferir</span>`);
  if (nv) p.push(`<span style="color:${NFC_COR.vermelho};font-weight:700;">${nv} ${nv === 1 ? 'novo' : 'novos'}</span>`);
  return p.join(' · ');
}
function nfcLinha(n) {
  const ab = NFC.aberta === n.chave, s = NFC_SIT[n.situacao];
  const sit = s ? `<span style="color:${NFC_COR[s[0]]};font-weight:700;">✓ ${s[1]}</span>${n.conferido_por ? `<div style="font-size:11px;color:var(--tx-4);">${nfcE(String(n.conferido_por).split('@')[0])}${n.conferido_em ? ' · ' + nfcD(String(n.conferido_em).slice(0, 10)) : ''}</div>` : ''}`
    : '<span style="color:var(--tx-3);">falta conferir</span>';
  let h = `<tr${ab ? ' class="sub"' : ''} style="cursor:pointer;" onclick="nfcAbrir(${nfcQ(n.chave)})">
    <td style="white-space:nowrap;">${ab ? '▾' : '▸'} ${nfcD(n.data_emissao)}</td><td>${nfcE(nfcLoja(n.unidade))}</td>
    <td style="white-space:normal;">${nfcE(n.fornecedor)}</td><td>${nfcE(n.numero)}</td><td style="white-space:nowrap;">${nfcR(n.total)}</td>
    <td style="white-space:normal;font-size:12.5px;">${nfcSelo(n)}${n.ja_lancada_no_saipos ? '<div style="font-size:11px;color:var(--tx-4);">já lançada no Saipos</div>' : ''}</td>
    <td>${sit}</td></tr>`;
  if (ab) h += `<tr><td colspan="7" style="white-space:normal;">${nfcNotaHtml(n)}</td></tr>`;
  return h;
}
async function nfcAbrir(chave) {
  NFC.aberta = NFC.aberta === chave ? null : chave;
  nfcDesenhar();
  if (!NFC.aberta || NFC.itens[chave]) return;
  try {
    NFC.itens[chave] = await consultarTudo(`vw_compra_nf_pre_entrada?select=n_item,cnpj_emit,c_prod,x_prod,u_com,q_com,v_prod,nome_base,nome_saipos,fator,qtd_estoque,un_estoque,traducao&chave=eq.${encodeURIComponent(chave)}&order=n_item`);
  } catch (e) { NFC.itens[chave] = { erro: e.message }; }
  if (nfcPodeEnsinar() && NFC.itens[chave] && !NFC.itens[chave].erro && NFC.itens[chave].some((i) => nfcTom(i.traducao)[0] === 'vermelho') && !NFC.base) {
    try { NFC.base = await consultarTudo('ft_item_base?select=nome_saipos,nome_base,nao_usa&order=nome_saipos'); } catch (e) { NFC.base = []; }
  }
  nfcDesenhar();
}
function nfcNotaHtml(n) {
  const I = NFC.itens[n.chave];
  if (!I) return '<div class="contexto">Abrindo a nota…</div>';
  if (I.erro) return `<div class="contexto" style="border-color:var(--farol-fora);">✗ Não abriu: ${nfcE(I.erro)} <button type="button" class="preset-btn" onclick="delete NFC.itens[${nfcQ(n.chave)}];NFC.aberta=null;nfcAbrir(${nfcQ(n.chave)})">Tentar de novo</button></div>`;
  const dif = NFC.modo[n.chave] === 'dif', nao = NFC.modo[n.chave] === 'nao', ens = nfcPodeEnsinar();
  let h = `<table style="margin:4px 0 8px;"><thead><tr><th>Item da nota</th><th>Na nota</th><th>Item do estoque</th><th>No estoque</th><th></th>${dif ? '<th>Chegou</th>' : ''}</tr></thead><tbody>
    ${I.map((i) => {
      const [tom, txt] = nfcTom(i.traducao), novo = tom === 'vermelho';
      const id = `${n.chave}_${i.n_item}`;
      let lin = `<tr><td style="white-space:normal;">${nfcE(i.x_prod)}</td><td style="white-space:nowrap;">${nfcN(i.q_com)} ${nfcE(String(i.u_com || '').toLowerCase())}</td>
        <td style="white-space:normal;">${i.nome_base ? nfcE(i.nome_base) : '<span style="color:var(--tx-4);">–</span>'}</td>
        <td style="white-space:nowrap;">${i.qtd_estoque != null ? nfcN(i.qtd_estoque) + ' ' + nfcE(String(i.un_estoque || '').toLowerCase()) : '–'}</td>
        <td style="white-space:nowrap;color:${NFC_COR[tom]};font-weight:700;">${txt}</td>
        ${dif ? `<td><input id="nfcQ_${nfcE(id)}" type="number" step="0.001" min="0" inputmode="decimal" value="${Number(i.q_com)}" style="width:90px;"></td>` : ''}</tr>`;
      if (novo && ens && !n.situacao) lin += `<tr><td colspan="${dif ? 6 : 5}" style="white-space:normal;background:var(--surface-2);">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;font-size:12px;">
          <label style="display:flex;flex-direction:column;gap:2px;color:var(--tx-4);flex:1 1 220px;">É qual item do estoque?
            <input id="nfcI_${nfcE(id)}" list="nfcBase" placeholder="digite e escolha da lista" style="width:100%;"></label>
          <label style="display:flex;flex-direction:column;gap:2px;color:var(--tx-4);">1 ${nfcE(String(i.u_com || 'un').toLowerCase())} da nota vale quanto no estoque?
            <input id="nfcF_${nfcE(id)}" type="number" step="0.0001" min="0" inputmode="decimal" placeholder="ex.: 1" style="width:120px;"></label>
          <button type="button" class="preset-btn active" onclick="nfcEnsinar(${nfcQ(n.chave)}, ${Number(i.n_item)})">Ensinar</button>
          <span style="width:10px;"></span>
          <label style="display:flex;flex-direction:column;gap:2px;color:var(--tx-4);flex:1 1 160px;">Não é de estoque? Por quê
            <input id="nfcM_${nfcE(id)}" placeholder="ex.: material de manutenção" style="width:100%;"></label>
          <label style="display:inline-flex;gap:4px;align-items:center;color:var(--tx-3);"><input id="nfcT_${nfcE(id)}" type="checkbox">o fornecedor todo</label>
          <button type="button" class="preset-btn" onclick="nfcForaEstoque(${nfcQ(n.chave)}, ${Number(i.n_item)})">Não é de estoque</button>
        </div></td></tr>`;
      return lin;
    }).join('')}</tbody></table>`;
  if (ens && NFC.base) h += `<datalist id="nfcBase">${NFC.base.filter((b) => !b.nao_usa).map((b) => `<option value="${nfcE(b.nome_saipos)}">${nfcE(b.nome_base || '')}</option>`).join('')}</datalist>`;
  if (n.situacao) return h;
  if (!nfcPodeMarcar()) return h + '<div class="caption-label" style="text-align:left;">Quem marca a chegada: Rita, Hellen e a separação.</div>';
  if (dif) return h + `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
      <input id="nfcObs_${nfcE(n.chave)}" placeholder="o que aconteceu (opcional)" style="flex:1 1 220px;">
      <button type="button" class="preset-btn active" onclick="nfcMarcar(${nfcQ(n.chave)}, 'CHEGOU_DIFERENCA')">Gravar o que chegou</button>
      <button type="button" class="preset-btn" onclick="delete NFC.modo[${nfcQ(n.chave)}];nfcDesenhar()">Voltar</button></div>`;
  if (nao) return h + `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
      <input id="nfcObs_${nfcE(n.chave)}" placeholder="por que não chegou? (ex.: fornecedor vai entregar amanhã)" style="flex:1 1 260px;">
      <button type="button" class="preset-btn" style="color:var(--farol-fora);" onclick="nfcMarcar(${nfcQ(n.chave)}, 'NAO_CHEGOU')">Gravar: não chegou</button>
      <button type="button" class="preset-btn" onclick="delete NFC.modo[${nfcQ(n.chave)}];nfcDesenhar()">Voltar</button></div>`;
  return h + `<div style="display:flex;flex-wrap:wrap;gap:8px;">
      <button type="button" class="preset-btn active" onclick="nfcMarcar(${nfcQ(n.chave)}, 'CHEGOU_OK')">✓ Chegou tudo certo</button>
      <button type="button" class="preset-btn" onclick="NFC.modo[${nfcQ(n.chave)}]='dif';nfcDesenhar()">Chegou com diferença</button>
      <button type="button" class="preset-btn" onclick="NFC.modo[${nfcQ(n.chave)}]='nao';nfcDesenhar()">Não chegou</button></div>`;
}
async function nfcMarcar(chave, sit) {
  const I = NFC.itens[chave] || [], val = (id) => ((document.getElementById(id) || {}).value || '').trim();
  const obs = val('nfcObs_' + chave);
  let itens = [];
  if (sit === 'CHEGOU_DIFERENCA') {
    itens = I.map((i) => ({ n_item: i.n_item, qtd_chegou: Number(val(`nfcQ_${chave}_${i.n_item}`).replace(',', '.')), q: Number(i.q_com) }))
      .filter((x) => isFinite(x.qtd_chegou) && Math.abs(x.qtd_chegou - x.q) > 0.0005).map(({ n_item, qtd_chegou }) => ({ n_item, qtd_chegou, obs: obs || null }));
    if (!itens.length) return avisoAcao('atencao', '! Nenhum item com quantidade diferente da nota. Mude a quantidade que chegou ou use "Chegou tudo certo".');
  }
  if (sit === 'NAO_CHEGOU' && !obs) return avisoAcao('atencao', '! Diga por que não chegou.');
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('compra_nf_marcar_chegou', { p_chave: chave, p_situacao: sit, p_itens: itens, p_obs: obs || null });
  if (!r.ok) return avisoAcao('erro', '✗ Não gravou: ' + await trErroDe(r) + ' — tente de novo.', () => nfcMarcar(chave, sit));
  delete NFC.modo[chave]; NFC.aberta = null;
  avisoAcao('ok', `✓ Nota conferida (${NFC_SIT[sit][1]}) — às ${avisoHora()}.`);
  await entrarNotasChegou();
}
async function nfcEnsinar(chave, nItem) {
  const i = (NFC.itens[chave] || []).find((x) => x.n_item === nItem); if (!i) return;
  const id = `${chave}_${nItem}`, nome = ((document.getElementById('nfcI_' + id) || {}).value || '').trim();
  const fator = Number(String((document.getElementById('nfcF_' + id) || {}).value || '').replace(',', '.'));
  if (!nome) return avisoAcao('atencao', '! Escolha o item do estoque na lista.');
  if (NFC.base && !NFC.base.some((b) => b.nome_saipos === nome)) return avisoAcao('atencao', '! Esse nome não está na base: escolha um da lista (item novo de verdade vai ao Neto antes).');
  if (!(fator > 0)) return avisoAcao('atencao', '! Diga quanto 1 unidade da nota vale no estoque (maior que zero).');
  avisoAcao('enviando', 'Ensinando…');
  const r = await trRpcSeguro('compra_item_ensinar', { p_cnpj_emit: i.cnpj_emit || nfcCnpj(chave), p_c_prod: i.c_prod, p_nome_saipos: nome, p_fator: fator });
  if (!r.ok) return avisoAcao('erro', '✗ Não ensinou: ' + await trErroDe(r) + ' — tente de novo.', () => nfcEnsinar(chave, nItem));
  avisoAcao('ok', `✓ Aprendido: ${i.x_prod} = ${nome} — às ${avisoHora()}. Vale para as próximas notas deste fornecedor.`);
  NFC.itens = {}; NFC.aberta = null;
  await entrarNotasChegou(); nfcAbrir(chave);
}
async function nfcForaEstoque(chave, nItem) {
  const i = (NFC.itens[chave] || []).find((x) => x.n_item === nItem); if (!i) return;
  const id = `${chave}_${nItem}`, motivo = ((document.getElementById('nfcM_' + id) || {}).value || '').trim();
  const todos = !!(document.getElementById('nfcT_' + id) || {}).checked;
  if (!motivo) return avisoAcao('atencao', '! Diga por que não é de estoque.');
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('compra_item_fora_do_estoque', { p_cnpj_emit: i.cnpj_emit || nfcCnpj(chave), p_c_prod: i.c_prod, p_todos_do_fornecedor: todos, p_motivo: motivo });
  if (!r.ok) return avisoAcao('erro', '✗ Não gravou: ' + await trErroDe(r) + ' — tente de novo.', () => nfcForaEstoque(chave, nItem));
  avisoAcao('ok', `✓ ${todos ? 'O fornecedor todo' : i.x_prod} fica fora do estoque — às ${avisoHora()}.`);
  NFC.itens = {}; NFC.aberta = null;
  await entrarNotasChegou(); nfcAbrir(chave);
}
