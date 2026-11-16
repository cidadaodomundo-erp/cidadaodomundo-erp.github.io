// Código que falhou no Saipos (16/11/2026, chat Telas; pedido do dono 12/11 11:15 "monitoramento de itens que entram com
// erro de código no Saipos pra irmos corrigindo"; livro chat-frente-cardapio/respostas/monitor-codigo-saipos).
// Fonte única: vw_saipos_codigo_falhou (14 dias, por pedido; filtro de filial no banco). A tela só lê.
// Farol: vermelho >= 50% dos pedidos, âmbar 10–49%. Cartões filtram; a loja vem do seletor da casca.
let SCF = null, SCF_FILTRO = 'todos', SCF_OUVE = false;

async function entrarSaiposcod() {
  const alvo = document.getElementById('view-saiposcod');
  if (!alvo) return;
  if (typeof lojaCarregar === 'function' && await lojaCarregar() && !SCF_OUVE) {
    SCF_OUVE = true; aoMudarLoja(() => renderSaiposcod());
  }
  alvo.innerHTML = '<div class="contexto">Carregando os códigos que falharam…</div>';
  try {
    SCF = await consultarTudo('vw_saipos_codigo_falhou?select=id_loja,nome_loja,unidade,item_ifood,codigo_pdv,pedidos_falhou,pedidos_vendidos,pct_falhou,ultima_falha&order=pedidos_falhou.desc,id_loja,item_ifood,codigo_pdv');
  } catch (e) {
    alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">✗ Não carregou: ${trEscH(e.message)}. <button class="preset-btn" onclick="entrarSaiposcod()">Tentar de novo</button></div>`;
    return;
  }
  renderSaiposcod();
}
function scfFiltrar(f) { SCF_FILTRO = SCF_FILTRO === f ? 'todos' : f; renderSaiposcod(); }
function scfNivel(p) { p = Number(p) || 0; return p >= 50 ? 'fora' : p >= 10 ? 'perto' : 'ok'; }

function renderSaiposcod() {
  const alvo = document.getElementById('view-saiposcod');
  if (!alvo || SCF === null) return;
  const loja = typeof lojaAtual === 'function' ? lojaAtual() : null;
  const daLoja = SCF.filter((r) => !loja || loja === 'REDE' || r.unidade === loja);
  const quase = daLoja.filter((r) => scfNivel(r.pct_falhou) === 'fora');
  const asVezes = daLoja.filter((r) => scfNivel(r.pct_falhou) === 'perto');
  const caiu = daLoja.reduce((s, r) => s + (Number(r.pedidos_falhou) || 0), 0);
  const linhas = SCF_FILTRO === 'fora' ? quase : SCF_FILTRO === 'perto' ? asVezes : daLoja;
  const n = (v) => Number(v || 0).toLocaleString('pt-BR');
  const dt = (d) => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '—';
  const cor = { fora: 'var(--farol-fora)', perto: 'var(--farol-perto)', ok: 'var(--farol-ok)' };
  const palavra = { fora: 'cai quase sempre', perto: 'cai às vezes', ok: 'cai pouco' };
  const cartao = (chave, rot, val, borda, sub) => `<div class="card ${borda}" style="cursor:pointer;${SCF_FILTRO === chave ? 'outline:2px solid var(--brand);' : ''}" onclick="scfFiltrar('${chave}')">
      <div class="card-lbl">${rot}</div><div class="card-val">${val}</div><div class="card-pct">${sub}</div></div>`;
  const turbinar = daLoja.some((r) => /dentro do lanche/i.test(r.item_ifood || '') && scfNivel(r.pct_falhou) !== 'ok');
  alvo.innerHTML = `
    <h2>Código que falhou no Saipos</h2>
    <div class="contexto" style="text-align:left;">Item que cai no Diversos fica sem custo certo e sem baixa de estoque. Últimos 14 dias.</div>
    ${turbinar ? '<div class="contexto" style="text-align:left;border-color:var(--farol-perto);">Turbinar "(dentro do lanche)" em combo 2x cai no Diversos; no combo de 1 lanche entra inteiro.</div>' : ''}
    <div class="cards cards-3">
      ${cartao('fora', 'Caem quase sempre (50% ou mais)', n(quase.length), quase.length ? 'neg' : 'pos', 'itens · clique para ver')}
      ${cartao('perto', 'Caem às vezes (10% a 49%)', n(asVezes.length), asVezes.length ? 'highlight' : 'pos', 'itens · clique para ver')}
      ${cartao('todos', 'Pedidos que caíram no Diversos', n(caiu), 'neutral', `${n(daLoja.length)} itens no total`)}
    </div>
    ${SCF_FILTRO !== 'todos' ? `<div style="margin:6px 0;"><button class="preset-btn" onclick="scfFiltrar('${SCF_FILTRO}')">${palavra[SCF_FILTRO]} ✕</button></div>` : ''}
    ${linhas.length ? `<div id="tabelaSaiposCodigo"><table>
      <tr><th>Loja</th><th>Item do iFood</th><th>Código</th><th>Pedidos que caíram</th><th>% dos pedidos</th><th>Última vez</th></tr>
      ${linhas.map((r) => { const nv = scfNivel(r.pct_falhou); return `<tr>
        <td>${trEscH(r.nome_loja)}</td><td>${trEscH(r.item_ifood)}</td><td>${trEscH(r.codigo_pdv || '—')}</td>
        <td>caiu ${n(r.pedidos_falhou)} de ${n(r.pedidos_vendidos)}</td>
        <td><span style="color:${cor[nv]};font-weight:700;">${n(r.pct_falhou)}%</span> <span style="color:${cor[nv]};">${palavra[nv]}</span></td>
        <td>${dt(r.ultima_falha)}</td></tr>`; }).join('')}
      <tr class="liq"><td>Total</td><td>${n(linhas.length)} itens</td><td></td><td>caiu ${n(linhas.reduce((s, r) => s + (Number(r.pedidos_falhou) || 0), 0))}</td><td></td><td></td></tr>
    </table></div>` : '<div class="contexto">Nenhum item caiu no Diversos nesta loja nos últimos 14 dias. ✓</div>'}`;
}
