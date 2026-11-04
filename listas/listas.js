// Modulo Listas (Pedidos e Financeiro) do painel Cidadao do Mundo.
// Saiu de docs/dashboard.html em 24/10/2026 (bloco 1 do painel em modulos): MOVIDO, nao copiado.
// Carregado pelo dashboard.html ANTES do script principal. Aqui so se declaram funcoes e constantes literais;
// o que o bloco usa do painel (consultarTudo, fmt, pct, selo, rmbSessao, rmbHeaders, rmbRenovarSeExpirado,
// SUPABASE_URL, SUPABASE_ANON_KEY, MESES_ABREV) e o que o painel usa daqui (entrarListas, entrarListasFin,
// renderModuloListasFin) so rodam depois, na chamada. trFetch, trRpc, trHoje, trErroDe e trEscH moram no nucleo.js
// desde 24/10/2026 (bloco 2).
// Quem mexe aqui: o chat "Telas do painel", como no dashboard.html.

let LISTAS = null;

// 01/09/2026, decisao do dono: DOIS modulos. "Listas · Pedidos" e o ciclo que
// os envolvidos operam (pedido, separacao, conferencia, tabela de precos);
// "Listas · Financeiro" e o dinheiro (fechamento, contas a pagar, conta mes a
// mes, CMV). As telas continuam fechadas por papel — mudou o endereco, nao a
// permissao. So um dos modulos mantem o container da operacao no DOM por vez
// (o outro e esvaziado), para os ids trOperacao/trTelaConteudo nao duplicarem.
let TR_MODULO = 'pedidos';
const TR_TELAS_MODULO = {
  pedidos:    ['pedido', 'separacao', 'conferencia', 'precos'],
  financeiro: ['fechamento', 'contas', 'cmv'],
};

// 28/10/2026 (seletor de loja único): a filial que se está vendo. Filial logada: a dela (o banco já trava). Quem é da casa:
// Ahú ou São Braz no topo = só aquela filial; Água Verde (quem manda as listas) e Rede = todas — sem filtro por cima do banco.
let TR_OUVE_LOJA = false;
function trFilialVista() {
  if (TR_OP && TR_OP.unidade) return TR_OP.unidade;
  const l = typeof lojaAtual === 'function' && typeof LOJA_INFO !== 'undefined' && LOJA_INFO ? lojaAtual() : null;
  return l && l !== 'REDE' && l !== 'AGUA VERDE' ? l : null;
}
function trFiltroVista(prefixo) { const f = trFilialVista(); return f ? `${prefixo}unidade=eq.${encodeURIComponent(f)}` : ''; }
async function trLojaPreparar() {
  if (typeof lojaCarregar !== 'function') return;
  await lojaCarregar();
  if (TR_OUVE_LOJA) return;
  TR_OUVE_LOJA = true;
  aoMudarLoja(() => {
    trListaAberta = null; trPedidoOrigem = null; window._trPrecosUnidade = null;
    if (TR_MODULO === 'financeiro') { if (LISTAS) renderModuloListasFin(); if (TR_OP && trTela) trRenderOperacao(); }
    else if (TR_OP) trRenderOperacao();
  });
}
async function entrarListas() {   // Listas · Pedidos
  const alvo = document.getElementById('view-listas');
  if (!alvo) return;
  await trLojaPreparar();
  alvo.classList.remove('tr-ilha');   // o render religa quando a tela de pedido abrir
  const outro = document.getElementById('view-listasfin');
  if (outro) outro.innerHTML = '';
  if (TR_MODULO !== 'pedidos') trTela = null;
  TR_MODULO = 'pedidos';
  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Listas · Pedidos</div>
    <div class="caption-label" style="text-align:center;" title="Tudo por peso (kg), menos embalagens. Fechamento e contas ficam em Listas · Financeiro.">
      A filial pede, a Água Verde separa, quem recebe confere.
    </div>
    <div id="trOperacao"><div class="contexto">Carregando a operação...</div></div>`;
  entrarOperacaoListas();
}

async function entrarListasFin() {   // Listas · Financeiro
  const alvo = document.getElementById('view-listasfin');
  if (!alvo) return;
  await trLojaPreparar();
  const outro = document.getElementById('view-listas');
  if (outro) { outro.innerHTML = ''; outro.classList.remove('tr-ilha'); }
  if (TR_MODULO !== 'financeiro') trTela = null;
  TR_MODULO = 'financeiro';
  if (LISTAS === null) {
    alvo.innerHTML = '<div class="contexto">Carregando as transferências...</div>';
    // historico da era planilha vive nas planilhas; aqui e do corte em diante.
    // listasMes alimenta o drill do quadro do mes (filial -> listas -> itens)
    const mesIni = trHoje().slice(0, 7) + '-01';
    const [mensal, listasMes] = await Promise.all([
      consultarTudo('vw_tr_conta_listas_mensal?select=*&mes=gte.2026-08-01&order=mes.desc'),
      consultarTudo(`vw_tr_listas?select=id,unidade,data_pedido,data_entrega,status,itens,total_lista,itens_divergentes&fonte=eq.PAINEL&data_pedido=gte.${mesIni}&order=id.desc`),
    ]);
    LISTAS = { mensal, listasMes };
  }
  renderModuloListasFin();
}

// Reorganizado em 09/09/2026 (dono): em cima o MES EM ANDAMENTO — o
// fechamento parcial por filial, que e o numero vivo; embaixo o historico
// fechado RECOLHIDO, so para consulta. Os cartoes-farol e a listagem de
// listas sairam: duplicavam a tabela mensal e a aba "finalizadas".
function renderModuloListasFin() {
  const alvo = document.getElementById('view-listasfin');
  if (!alvo || LISTAS === null) return;
  const fv = trFilialVista();   // 28/10/2026: só a filial escolhida no topo (Ahú, São Braz); AV e Rede = todas
  const mensal = fv ? LISTAS.mensal.filter((r) => r.unidade === fv) : LISTAS.mensal;
  const listasMes = fv ? (LISTAS.listasMes || []).filter((r) => r.unidade === fv) : LISTAS.listasMes;
  const nu = (v) => Number(v) || 0;
  const mesTxt = (m) => { const [a, mm] = m.split('-'); return MESES_ABREV[Number(mm) - 1] + '/' + a.slice(2); };
  window._trFinListas = listasMes || [];

  if (!mensal.length) {
    alvo.innerHTML = '<div class="contexto">Sem listas importadas — rode <b>script/import_listas.py</b>.</div>';
    return;
  }

  const mesAtual = trHoje().slice(0, 7);
  const parciais = mensal.filter(r => (r.mes || '').slice(0, 7) === mesAtual);
  const historico = mensal.filter(r => (r.mes || '').slice(0, 7) !== mesAtual);
  const atrasados = historico.filter(r => r.sem_fechar).length;
  // 5 centavos de folga (01/10/2026): diferenca de centavos e arredondamento, nao custo
  // reescrito. Agosto do Boqueirao vale o que foi pago (8.620,03, decisao do dono) e as
  // linhas somam 8.620,01 — a planilha guarda mais casas nas caixas de growler.
  const derivas = historico.filter(r => Math.abs(nu(r.deriva_custo)) > 0.05);
  const derivaTotal = derivas.reduce((s, r) => s + nu(r.deriva_custo), 0);

  window._trHist = historico;

  alvo.innerHTML = `
    <div class="section-label" style="border-top:none; margin-top:0; padding-top:0;">Listas · Financeiro</div>
    <div class="caption-label" style="text-align:center;">
      O dinheiro das transferências: fechamento do mês (a Rita valida), contas a pagar
      (Água Verde e Michiro) e a conta mês a mês. O ciclo do pedido vive em <b>Listas · Pedidos</b>.
    </div>

    <div class="section-label">${parciais.length ? mesTxt(parciais[0].mes).toUpperCase() : 'MÊS'} EM ANDAMENTO — fechamento parcial por filial</div>
    <div class="caption-label" style="text-align:center;">
      Clique na filial para abrir as listas do mês; clique na lista para ver os itens.
      "Frete Michiro" de Ahú/S.Braz é pago direto por elas (não entra no devido); o do Boqueirão a Água Verde recobra.
    </div>
    ${parciais.length ? `<div id="tabelaTrParcial"><table>
      <tr><th>Filial</th><th>Listas</th><th>Itens (R$)</th><th>Frete Michiro</th><th>Royalty</th><th>Parcial devido</th></tr>
      ${parciais.map((r, ix) => {
        const doMes = (listasMes || []).filter(l => l.unidade === r.unidade);
        // Sem conferir = a filial ainda nao registrou o recebimento (12/09/2026).
        // Enquanto houver, a conta do mes e provisoria: o valor ainda pode mudar.
        const semConferir = doMes.filter(l => !['RECEBIDA', 'FECHADA'].includes(l.status)).length;
        const freteDir = nu(r.frete_pago_direto);
        return `<tr onclick="trFinToggle(${ix})" style="cursor:pointer;" title="clique para abrir as listas">
        <td>▸ ${r.unidade}</td><td>${r.listas}${semConferir ? ` <span class="tr-tag" title="Listas deste mês que a filial ainda não conferiu — o valor delas ainda pode mudar.">${semConferir} sem conferir</span>` : ''}</td>
        <td>R$ ${fmt(nu(r.valor_lista))}</td>
        <td>${nu(r.frete) ? 'R$ ' + fmt(nu(r.frete)) : (freteDir ? `<span style="color:#8a897e;">R$ ${fmt(freteDir)} (pago direto)</span>` : '—')}</td>
        <td>${nu(r.royalty) ? 'R$ ' + fmt(nu(r.royalty)) + ' <span style="color:#8a897e; font-size:11px;">(regra)</span>' : '—'}</td>
        <td><b>R$ ${fmt(nu(r.total_devido))}</b></td></tr>
        <tr id="trFinFil_${ix}" hidden><td colspan="6" style="text-align:left; white-space:normal; padding:8px 14px;">
          ${doMes.length ? doMes.map(l => `
            <div onclick="trFinVerLista(${l.id}); event.stopPropagation();" style="cursor:pointer; padding:5px 0; border-bottom:1px solid #34332f;" title="clique para ver os itens">
              ▸ Lista <b>#${l.id}</b> · ${l.data_pedido ? l.data_pedido.slice(8,10)+'/'+l.data_pedido.slice(5,7) : '—'}
              · ${l.status} · ${l.itens} itens · <b>R$ ${fmt(nu(l.total_lista))}</b>
              ${nu(l.itens_divergentes) ? `<span class="tr-tag">· ${l.itens_divergentes} diferença(s)</span>` : ''}
              <div id="trFinLista_${l.id}" hidden style="margin:6px 0 4px 14px; font-size:12.5px;"></div>
            </div>`).join('') : '<span style="color:#8a897e;">nenhuma lista neste mês</span>'}
        </td></tr>`;
      }).join('')}
    </table></div>` : '<div class="contexto">Nenhuma lista fechada ainda neste mês — a primeira conferência acende esta tabela.</div>'}

    <div id="trOperacao"><div class="contexto">Carregando a operação...</div></div>

    <details style="margin-top:26px;">
      <summary style="cursor:pointer; color:#a5a49a;" class="section-label">Histórico fechado — abrir para consulta${
        atrasados ? ` <span style="color:#ff6b6b;">(${atrasados} mês(es) sem fechar)</span>` : ''}</summary>
      <div class="caption-label" style="text-align:center; margin-top:10px;">
        Do corte de ago/26 em diante; o anterior vive nas planilhas aposentadas (e no banco, para consulta).
        <b>Devido, Pago e Falta</b> são os mesmos de <b>Contas a pagar</b>: o pagamento é lido do lançamento do Saipos.
      </div>
      <div id="tabelaTrMensal">${trHistTabelaHtml()}</div>
      ${trHistNotas(historico, mesTxt)}
      ${derivas.length ? `<div class="caption-label" style="color:#ff6b6b;" title="A conta é o custo recalculado hoje menos o valor congelado no fechamento do mês. Diferença positiva quer dizer que a filial foi cobrada a menos do que o custo de hoje; negativa, a mais.">⚠ A planilha reescreveu depois o custo de ${derivas.length} mês(es) já fechado(s): R$ ${fmt(Math.abs(derivaTotal))} ${derivaTotal >= 0 ? 'cobrado a menos' : 'cobrado a mais'} — vale o valor congelado no fechamento.</div>` : ''}
    </details>`;
  entrarOperacaoListas();
}

// HISTORICO FECHADO (dono, 01/10/2026: "por que agosto, pago em setembro, nao esta
// zerado?"). Devido, Pago e Falta saem da COBRANCA do mes — a mesma linha de Contas a
// pagar (vw_tr_contas_pagar), com o pagamento lido do Saipos. Antes o "Pago" vinha das
// planilhas aposentadas pelo mes do DEPOSITO: mostrava em agosto a lista de julho.
// Quem faz a conta e o banco (vw_tr_conta_listas_mensal: cobranca_total, total_pago,
// falta, cobranca_status); a tela so escreve. Mes sem cobranca (era planilha) usa o que
// a planilha registrou. Banco ainda sem as colunas novas: a tela fica como era.
function trHistDevido(r) { return r.cobranca_total != null ? Number(r.cobranca_total) : (Number(r.total_devido) || 0); }
// a cobranca foi fechada num valor e a conta refeita hoje da outro: vale o cobrado, e avisa
function trHistDevidoAviso(r) {
  if (r.cobranca_total == null || Math.abs(Number(r.cobranca_total) - (Number(r.total_devido) || 0)) <= 0.005) return '';
  return ` <span class="tr-tag" title="A cobrança deste mês foi fechada em R$ ${fmt(Number(r.cobranca_total))}; a conta refeita hoje (itens + frete + royalty) dá R$ ${fmt(Number(r.total_devido) || 0)}. Vale o cobrado.">≠ conta de hoje</span>`;
}
// Ordem e ordenadores (dono, 04/11/2026 18:35: "organiza por mês e filial, ahu, sb e boqueirao, e coloca os
// ordenadores no cabeçalho da tabela"). Padrão: mês do mais novo ao mais antigo e, dentro do mês, sempre
// AHU → SÃO BRAZ → BOQUEIRÃO (outra filial, se vier, depois). Clique no cabeçalho ordena; de novo, inverte;
// o empate cai na ordem padrão. Redesenha só a tabela (o <details> do histórico continua aberto).
const TR_HIST_FILIAIS = ['AHU', 'SAO BRAZ', 'BOQUEIRAO'];
let TR_HIST_ORD = { col: null, dir: 1 };
function trHistFilialPos(u) {
  const k = String(u || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const i = TR_HIST_FILIAIS.indexOf(k);
  return i < 0 ? 90 : i;
}
function trHistMesTxt(m) { const [a, mm] = String(m).split('-'); return MESES_ABREV[Number(mm) - 1] + '/' + a.slice(2); }
const TR_HIST_COLS = [
  ['mes', 'Mês', r => String(r.mes || '')],
  ['filial', 'Filial', r => trHistFilialPos(r.unidade)],
  ['listas', 'Listas', r => Number(r.listas) || 0],
  ['itens', 'Itens (R$)', r => Number(r.valor_lista) || 0],
  ['frete', 'Frete', r => Number(r.frete) || 0],
  ['royalty', 'Royalty', r => Number(r.royalty) || 0],
  ['devido', 'Devido', r => trHistDevido(r)],
  ['pago', 'Pago', r => r.total_pago == null ? -1 : Number(r.total_pago)],
  ['falta', 'Falta', r => r.falta == null ? -Infinity : Number(r.falta)],
  ['situacao', 'Situação', r => trHistSituacao(r)[0]],
];
function trHistPadrao(a, b) {
  return String(b.mes || '').localeCompare(String(a.mes || '')) || trHistFilialPos(a.unidade) - trHistFilialPos(b.unidade)
    || String(a.unidade || '').localeCompare(String(b.unidade || ''));
}
function trHistTabelaHtml() {
  const nu = v => Number(v) || 0;
  const o = TR_HIST_ORD;
  const col = TR_HIST_COLS.find(c => c[0] === o.col);
  const linhas = (window._trHist || []).slice().sort((a, b) => {
    if (col) {
      const va = col[2](a), vb = col[2](b);
      const d = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb;
      if (d) return d * o.dir;
    }
    return trHistPadrao(a, b);
  });
  const th = c => `<th onclick="trHistOrdenar('${c[0]}')" style="cursor:pointer; user-select:none;${o.col === c[0] ? ' color:var(--tx-1);' : ''}" title="Clique para ordenar; de novo, inverte.">${c[1]}${o.col === c[0] ? (o.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  return `<table>
        <tr>${TR_HIST_COLS.map(th).join('')}</tr>
        ${linhas.map(r => `<tr>
    <td>${trHistMesTxt(r.mes)}</td><td>${r.unidade}</td><td>${r.listas}</td>
    <td>R$ ${fmt(nu(r.valor_lista))}</td>
    <td>${nu(r.frete) ? 'R$ ' + fmt(nu(r.frete)) : '—'}</td>
    <td>${nu(r.royalty) ? 'R$ ' + fmt(nu(r.royalty)) + ' <span style="color:#8a897e; font-size:11px;">(regra)</span>' : '—'}</td>
    <td><b>R$ ${fmt(trHistDevido(r))}</b>${trHistDevidoAviso(r)}</td>
    ${trHistCelulas(r)}
  </tr>`).join('')}
      </table>`;
}
function trHistOrdenar(c) {
  // mês e valores começam do maior; filial e situação, do primeiro da ordem
  if (TR_HIST_ORD.col === c) TR_HIST_ORD.dir = -TR_HIST_ORD.dir;
  else TR_HIST_ORD = { col: c, dir: ['filial', 'situacao'].includes(c) ? 1 : -1 };
  const el = document.getElementById('tabelaTrMensal');
  if (el) el.innerHTML = trHistTabelaHtml();
}
function trHistSituacao(r) {
  const dm = d => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '';
  const pago = r.total_pago == null ? null : Number(r.total_pago);
  const falta = r.falta == null ? null : Number(r.falta);
  const temCob = r.cobranca_total != null;
  const aberto = temCob && falta > 0.005;
  let sit, cls = '';
  if (r.cobranca_status === 'EM VALIDACAO') { sit = 'fechado · esperando validação'; cls = 'tr-tag'; }
  else if (r.sem_fechar) { sit = 'SEM FECHAR'; cls = 'negativo'; }
  else if (!temCob) sit = 'fechado';
  else if (!aberto) sit = 'fechado · pago' + (r.data_pagamento ? ' em ' + dm(r.data_pagamento) : '');
  else if (pago > 0) sit = 'fechado · pago em parte';
  else sit = 'fechado · em aberto';
  return [sit, cls];
}
function trHistCelulas(r) {
  const dm = d => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '';
  const pago = r.total_pago == null ? null : Number(r.total_pago);
  const falta = r.falta == null ? null : Number(r.falta);
  const aberto = r.cobranca_total != null && falta > 0.005;
  const [sit, cls] = trHistSituacao(r);
  const venc = aberto && r.cobranca_vencimento
    ? ` <span class="dre-av">${r.cobranca_vencimento < trHoje() ? 'venceu' : 'vence'} ${dm(r.cobranca_vencimento)}</span>` : '';
  const faltaTxt = falta == null || Math.abs(falta) <= 0.005 ? '—'
    : (falta > 0 ? `<b>R$ ${fmt(falta)}</b>` : `R$ ${fmt(-falta)} a mais`);
  return `<td>${pago == null ? '—' : 'R$ ' + fmt(pago)}</td>
          <td${falta > 0.005 ? ' class="negativo"' : ''}>${faltaTxt}</td>
          <td${cls ? ` class="${cls}"` : ''}>${sit}${venc}</td>`;
}
// embaixo da tabela: por que ainda falta (o texto mora na cobranca; so o primeiro trecho)
function trHistNotas(historico, mesTxt) {
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return historico.filter(r => r.cobranca_total != null && Number(r.falta) > 0.005 && r.cobranca_nota)
    .map(r => `<div class="caption-label" style="text-align:left; white-space:normal;"><b>${r.unidade} · ${mesTxt(r.mes)} — falta R$ ${fmt(Number(r.falta))}.</b> ${esc(String(r.cobranca_nota).split(' | ')[0])}</div>`).join('');
}

// drill do quadro do mes (09/09/2026): filial -> listas -> itens da lista
function trFinToggle(ix) {
  const el = document.getElementById('trFinFil_' + ix);
  if (el) el.hidden = !el.hidden;
}
async function trFinVerLista(id) {
  const el = document.getElementById('trFinLista_' + id);
  if (!el) return;
  if (!el.hidden) { el.hidden = true; return; }
  if (!el.dataset.pronto) {
    el.innerHTML = 'carregando...';
    el.hidden = false;
    const alvoLista = (window._trFinListas || []).find(l => l.id === id);
    // cat: o nome da embalagem, para escrever "10 pacotes · 4,2 kg" quando a
    // separacao contou (01/10/2026)
    const [itens, mapa, precos, cat] = await Promise.all([
      consultarTudo(`tr_lista_itens?id_lista=eq.${id}&order=item&select=id,item,un_medida,qtd_solicitada,qtd_separada,qtd_recebida,emb_separada,emb_recebida,observacao,avulso,editado`),
      trEmbMapa(alvoLista ? alvoLista.unidade : ''),
      trPrecosDaLista(id, consultarTudo),
      trCatMapa(alvoLista ? alvoLista.unidade : ''),
    ]);
    const comValor = Object.keys(precos).length > 0;
    const somaItens = itens.reduce((s, i) => s + (precos[i.id] != null ? trQtdCobrada(i) * precos[i.id] : 0), 0);
    el.innerHTML = `<table style="border-collapse:collapse;">
      <tr><th style="text-align:left; padding:2px 10px 2px 0;">Item</th><th style="padding:2px 8px;">Pedido</th><th style="padding:2px 8px;">Separado</th><th style="padding:2px 8px;">Recebido</th>${comValor ? '<th style="padding:2px 8px;">Valor unit.</th><th style="padding:2px 8px;">Total cobrado</th>' : ''}</tr>
      ${itens.map(i => { const dif = Number(i.qtd_recebida ?? 0) !== Number(i.qtd_separada ?? 0); return `<tr>
        <td style="text-align:left; padding:2px 10px 2px 0;">${i.item} <span class="dre-av">${i.un_medida || ''}</span>${trEmbRotulo(mapa, i.item)}${i.avulso ? ' <span class="tr-tag">🆕</span>' : ''}${i.editado ? ' <span class="tr-tag">✏️</span>' : ''}${i.observacao ? ` <span class="tr-tag">${i.observacao}</span>` : ''}</td>
        <td style="padding:2px 8px;">${Number(i.qtd_solicitada || 0)}</td>
        <td style="padding:2px 8px;">${trSepTxt(i, cat[i.item], Number(i.qtd_separada ?? 0))}</td>
        <td style="padding:2px 8px;${dif ? ' color:#ff6b6b; font-weight:700;' : ''}">${trRecTxt(i, cat[i.item], Number(i.qtd_recebida ?? 0))}</td>
        ${comValor ? trColunasValor(i, precos) : ''}
      </tr>`; }).join('')}
      ${comValor ? `<tr><td colspan="5" style="text-align:right; padding:2px 8px;"><b>Total dos itens</b></td>
        <td style="text-align:right; padding:2px 8px; white-space:nowrap;"><b>R$ ${fmt(somaItens)}</b></td></tr>` : ''}
    </table>`;
    el.dataset.pronto = '1';
    return;
  }
  el.hidden = false;
}

// ------------------------------------------------------------------
// OPERACAO DAS LISTAS pela tela (aplicado da fila em 17/08/2026).
// Backend 100% no Supabase (schema tr_*, RLS por papel, RPCs — 19 casos
// de teste do chat das listas). A UI so respeita: custo congelado por
// trigger, transicoes de status por papel, fechar exige 100% conferido.
// Login = MESMA sessao Supabase Auth do modulo Reembolsos (rmbSessao):
// uma senha so para os dois modulos. O papel vem do proprio banco via
// rpc tr_meu_papel()/tr_minha_unidade() — a UI nunca decide papel.
// 24/08/2026: o ciclo ganhou o FECHAMENTO DO MES (a lista nao vira mais
// cobranca sozinha) e o papel FINANCEIRO (Hellen), que so ve contas a pagar.
// ------------------------------------------------------------------
let TR_OP = null;        // { papel, unidade } do usuario logado
let trTela = null;       // tela ativa da operacao
let trListaAberta = null;



async function trFazerLogin() {
  const email = emailDoLogin(document.getElementById('trEmail').value);   // 29/10/2026: só o nome basta
  const senha = document.getElementById('trSenha').value;
  const erroEl = document.getElementById('trLoginErro');
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
  const s = await r.json();
  if (!r.ok || !s.access_token) {
    erroEl.textContent = 'Não deu: ' + (s.error_description || s.msg || 'e-mail ou senha errados, ou a conta ainda não foi criada no Supabase.');
    erroEl.style.display = 'block';
    return;
  }
  localStorage.setItem('rmbSessao', JSON.stringify({
    access_token: s.access_token, refresh_token: s.refresh_token,
    email: (s.user && s.user.email) || email,
    expira_em: Date.now() + ((s.expires_in || 3600) * 1000),
  }));
  TR_OP = null;
  entrarOperacaoListas();
}
function trSair() {
  localStorage.removeItem('rmbSessao'); TR_OP = null; trTela = null;
  (TR_MODULO === 'financeiro' ? entrarListasFin : entrarListas)();
}

async function entrarOperacaoListas() {
  const alvo = document.getElementById('trOperacao');
  if (!alvo) return;
  const sessao = rmbSessao();
  if (!sessao) {
    alvo.innerHTML = `
      <div class="contexto" style="max-width:460px;">
        As filiais pedem, a Água Verde separa, quem recebe confere — tudo por aqui, com login individual
        (o mesmo do módulo Reembolsos).
        <div style="margin-top:10px;">
          <input id="trEmail" type="text" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="seu nome (ex.: rita)" style="width:100%; margin-bottom:6px; background:#232321; border:1px solid #34332f; border-radius:8px; color:#fff; padding:8px 10px;">
          <input id="trSenha" type="password" placeholder="senha" style="width:100%; margin-bottom:8px; background:#232321; border:1px solid #34332f; border-radius:8px; color:#fff; padding:8px 10px;">
          <button class="preset-btn" onclick="trFazerLogin()">Entrar</button>
          <div id="trLoginErro" style="display:none; color:#ff6b6b; font-size:12px; margin-top:6px;"></div>
        </div>
      </div>`;
    return;
  }
  if (!TR_OP) {
    const [rp, ru, rv] = await Promise.all([trRpc('tr_meu_papel'), trRpc('tr_minha_unidade'), trRpc('tr_vejo_valores')]);
    if (!rp.ok) {
      alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">Logado como ${sessao.email}, mas o banco não reconheceu o papel (${await trErroDe(rp)}).
        Confira o cadastro em tr_usuarios. <button class="preset-btn" onclick="trSair()">sair</button></div>`;
      return;
    }
    TR_OP = { papel: await rp.json(), unidade: ru.ok ? await ru.json() : null,
              veValores: rv.ok ? await rv.json() : true };
    // Papel nulo = login existe no painel mas nao esta em tr_usuarios (hoje e o
    // caso do Fabio). Sem isto a tela caia na fila de separacao, que ele nao
    // pode operar — melhor dizer o que falta do que abrir uma tela quebrada.
    if (!TR_OP.papel) {
      alvo.innerHTML = `<div class="contexto">Você está logado como <b>${sessao.email}</b>, mas este login
        ainda não tem papel na operação das listas — por isso não dá para pedir, separar nem conferir.
        As tabelas acima continuam valendo. Para ganhar acesso, é o Neto cadastrar o e-mail em
        <b>tr_usuarios</b>. <button class="preset-btn" onclick="trSair()">sair</button></div>`;
      TR_OP = null;
      return;
    }
  }
  trRenderOperacao();
}

function trRenderOperacao() {
  const alvo = document.getElementById('trOperacao');
  if (!alvo) return;
  const { papel, unidade } = TR_OP;
  let telas = [];
  if (papel === 'FILIAL' || papel === 'DONO') telas.push(['pedido', '📝 Novo pedido']);
  if (papel === 'SEPARACAO' || papel === 'DONO') telas.push(['separacao', '📦 Fila de separação']);
  // o "balcao" (04/09/2026): quem separa tambem digita pedido que chegou por
  // WhatsApp/papel, escolhendo a filial — a fila continua sendo a tela inicial
  if (papel === 'SEPARACAO') telas.push(['pedido', '📝 Novo pedido']);
  // SEPARACAO ve a Conferencia desde 10/09 (dono: "acesso do compras igual ao
  // meu") — em consulta: o botao de FECHAR continua so da filial/dono
  if (papel === 'FILIAL' || papel === 'DONO' || papel === 'SEPARACAO') telas.push(['conferencia', '✅ Conferência']);
  telas.push(['precos', '💰 Tabela de preços']);
  if (papel === 'SEPARACAO' || papel === 'DONO') telas.push(['fechamento', '🧾 Fechamento do mês']);
  telas.push(['contas', '💳 Contas a pagar']);
  telas.push(['cmv', '📈 CMV semanal']);
  // login operacional sem valores (05/09/2026): as abas de dinheiro somem —
  // e o banco ja devolve NULL nos precos mesmo que alguem chame a API na mao
  if (TR_OP.veValores === false) {
    telas = telas.filter(([id]) => !['precos', 'contas', 'cmv', 'fechamento'].includes(id));
  }
  // cada modulo mostra so as suas telas (a permissao continua a mesma)
  telas = telas.filter(([id]) => TR_TELAS_MODULO[TR_MODULO].includes(id));
  if (!telas.length) {
    alvo.innerHTML = `<div class="contexto">Logado como <b>${rmbSessao().email}</b> (papel ${papel}).
      As telas do seu papel ficam no módulo <b>Listas · ${TR_MODULO === 'pedidos' ? 'Financeiro' : 'Pedidos'}</b>.
      <button class="preset-btn" onclick="trSair()">sair</button></div>`;
    return;
  }
  if (!trTela || !telas.some(([id]) => id === trTela)) trTela = telas[0][0];
  alvo.innerHTML = `
    <div class="caption-label">Logado: <b>${rmbSessao().email}</b> · papel <b>${papel}</b>${unidade ? ' · ' + unidade : ''}
      <button class="preset-btn" style="margin-left:8px;" onclick="trSair()">sair</button></div>
    <div class="periodo-presets" style="margin:8px 0;">
      ${telas.map(([id, rotulo]) => `<button class="preset-btn ${trTela === id ? 'active' : ''}" onclick="trTelaSet('${id}')">${rotulo}</button>`).join('')}
    </div>
    <div id="trTelaConteudo"><div class="contexto">Carregando...</div></div>`;
  // ilha clara cobre o MODULO Listas · Pedidos inteiro (titulo, abas e todas
  // as telas — aprovado tela a tela pelo dono em 05/09); o Financeiro segue escuro
  const mod = document.getElementById('view-listas');
  if (mod) mod.classList.toggle('tr-ilha', TR_MODULO === 'pedidos');
  ({ pedido: trTelaPedido, separacao: trTelaSeparacao, conferencia: trTelaConferencia,
     fechamento: trTelaFechamento, contas: trTelaContas, precos: trTelaPrecos,
     cmv: trTelaCmv }[trTela])();
}
function trTelaSet(t) { trTela = t; trListaAberta = null; trPedidoOrigem = null; trRenderOperacao(); }
// escolha Cidadao x Fornecedor do pedido em curso (so AHU e SAO BRAZ)
let trPedidoOrigem = null;

// ---- tela: novo pedido (FILIAL; DONO escolhe a filial) ----
async function trTelaPedido(unidadeEscolhida) {
  const alvo = document.getElementById('trTelaConteudo');
  let unidade = TR_OP.unidade || unidadeEscolhida || trFilialVista();
  if (!unidade) {
    const r = await trFetch('vw_tr_itens_pedido?select=unidade');
    const us = [...new Set((await r.json()).map(x => x.unidade))].filter(Boolean).sort();
    alvo.innerHTML = `<div class="contexto">Pedido em nome de qual filial? ${us.map(u =>
      `<button class="preset-btn" onclick="trTelaPedido('${u}')">${u}</button>`).join(' ')}</div>`;
    return;
  }
  // 11/09/2026, dono: AHU e SAO BRAZ escolhem na ENTRADA que pedido e este —
  // CIDADAO (producao da AV, cobrado) ou FORNECEDOR (a Rita compra e entrega,
  // sem cobranca na lista). Boqueirao segue com a grade unica.
  const temEscolha = ['AHU', 'SÃO BRAZ'].includes(unidade);
  if (temEscolha && !trPedidoOrigem) {
    // quem volta aqui na duvida ve, ANTES de escolher, o que ja foi enviado. A tela espera
    // essa leitura para abrir (o aviso entrando depois empurraria os botoes para baixo bem na
    // hora do toque); se a leitura falhar, a escolha abre do mesmo jeito, sem o aviso.
    const ab = await trPedidoAbertas(unidade).catch(() => null);
    alvo.innerHTML = `<div style="max-width:560px;">${trPedidoJaEnviadoHtml(ab, 'Escolher abaixo começa um pedido <b>novo</b>.')}</div><div class="contexto" style="max-width:560px;">
      <b>O que você vai pedir para ${unidade}?</b><br>
      <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
        <button class="preset-btn tr-btn-cheio" style="padding:14px 18px;" onclick="trPedidoOrigem='CIDADAO'; trTelaPedido('${unidade}')">🏭 Produção Cidadão<br><span style="font-weight:400; font-size:12px;">o que a Água Verde produz — cobrado na lista</span></button>
        <button class="preset-btn" style="padding:14px 18px; border-color:#4a90d9;" onclick="trPedidoOrigem='FORNECEDOR'; trTelaPedido('${unidade}')">🛒 Fornecedor<br><span style="font-weight:400; font-size:12px;">a Rita compra e entrega — sem cobrança na lista</span></button>
      </div></div>`;
    return;
  }
  const origemPedido = temEscolha ? trPedidoOrigem : null;
  // ab: os pedidos desta filial ja enviados e ainda nao separados — para o aviso do alto
  const [r, ab, regras, sit] = await Promise.all([
    trFetch(`vw_tr_itens_pedido?unidade=eq.${encodeURIComponent(unidade)}&order=item`),
    trPedidoAbertas(unidade),
    trAcompanhaRegras(),
    trTabelaSituacao(unidade),
  ]);
  if (!r.ok) { alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">${await trErroDe(r)}</div>`; return; }
  let itens = await r.json();
  const grade = itens;
  if (origemPedido) itens = itens.filter(i => (i.origem || 'CIDADAO') === origemPedido);
  const dataCusto = itens.find(i => i.custo_atualizado_em)?.custo_atualizado_em;
  // item com 2a embalagem (ex.: pernil desfiado) vira DUAS linhas na tela,
  // uma por pacote — o envio soma tudo numa linha so da lista
  const linhas = [];
  itens.forEach(i => {
    linhas.push({ ...i, _acomp: trAcompanhaDe(regras, i.item, 1) });
    if (i.emb2_fator) linhas.push({ ...i, emb_nome: i.emb2_nome, emb_fator: i.emb2_fator, _acomp: trAcompanhaDe(regras, i.item, 2) });
  });
  // o pote e procurado na grade INTEIRA da filial (preco e unidade), mesmo
  // quando a tela esta filtrada por origem
  window._trGradePedido = grade;
  window._trItensPedido = linhas; window._trPedidoUnidade = unidade;
  // tema papel: as cores vem das classes .tr-ilha/.trc-in, nunca inline — a
  // ilha em si e ligada no MODULO inteiro por trRenderOperacao (titulo, abas e
  // tela juntos, como no modelo aprovado), so enquanto a tela de pedido esta ativa
  alvo.innerHTML = `
    <div class="caption-label">Pedido para <b>${unidade}</b>${origemPedido ? (origemPedido === 'FORNECEDOR'
        ? ' · <b style="color:#4a90d9;">🛒 FORNECEDOR</b> (a Rita compra e entrega — sem cobrança)'
        : ' · <b style="color:#c8102e;">🏭 PRODUÇÃO CIDADÃO</b>')
        + ` <button class="preset-btn" onclick="trPedidoOrigem=null; trTelaPedido('${unidade}')">trocar</button>` : ''}
      — preencha só o que precisa; itens em branco ficam fora.
      ${trTabelaFrasePedido(sit, dataCusto)}</div>
    ${trPedidoJaEnviadoHtml(ab, 'O que você preencher abaixo vira um pedido <b>novo</b>.')}
    <input id="trPedidoBusca" type="search" class="trc-in" placeholder="buscar item... (o que você digitou continua guardado)" oninput="trPedidoFiltra()"
      style="width:100%; max-width:360px; margin:8px 0; border-radius:8px; padding:8px 10px;">
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:0 18px;">
      ${linhas.map((i, idx) => `
        <label data-busca="${i.item.toLowerCase()}" class="tr-linha" style="display:grid; grid-template-columns:1fr 76px; gap:2px 10px; align-items:center; font-size:12.5px; padding:5px 2px;">
          <span>${i.nome_base || i.item} <span class="tr-det">(${trLinhaComoPede(i)}${i._acomp && i.emb_fator ? ' · leva ' + i._acomp.acomp_nome_base.toLowerCase() : ''})${i.sem_custo ? ' ⚠️ sem custo' : ''}</span><br><span id="trqe_${idx}" class="tr-conv" style="font-size:11px;"></span></span>
          <span style="justify-self:end; text-align:right; line-height:1.15;">
            <input type="number" min="0" step="${i.emb_fator ? '0.5' : 'any'}" inputmode="decimal" id="trq_${idx}" class="trc-in"
              oninput="trqTem(this); trEmbHint(${idx})"
              style="width:72px; text-align:right;"><br>
            <span class="tr-det" style="font-size:10.5px;">${trLinhaUnidade(i)}</span>
          </span>
        </label>`).join('')}
    </div>
    <div class="section-label tr-secao" style="margin-top:16px;">PRECISA DE ALGO FORA DA GRADE?</div>
    <div class="caption-label">Escreva o nome do item, a quantidade e a unidade. Ele entra no pedido <b>sem preço</b> —
      o preço é definido quando o item for vinculado à base (antes do fechamento do mês), e daí ele passa a aparecer na grade.</div>
    <div id="trAvulsos"></div>
    <button class="preset-btn" onclick="trAddAvulso()">+ item fora da grade</button>
    <div style="margin-top:14px;">
      <button class="preset-btn tr-btn-cheio" onclick="trRevisarPedido()">Conferir e enviar</button>
      <span id="trPedidoParcial" style="font-size:13px; font-weight:700; margin-left:10px;"></span>
      <span id="trPedidoMsg" style="font-size:12px; margin-left:8px;"></span>
    </div>
    <div id="trPedidoResumo" class="contexto" style="margin-top:10px;" hidden></div>`;
  trAvulsoN = 0;
  window._trPedidoPendente = null;   // tela nova: o que esta aberto no banco aparece no aviso do alto
  trPedidoSoma();
}

// Como o item e pedido, escrito na linha: "vem em balde de 4,5 kg · R$ 52,02 o
// balde". O preco aparece na MESMA unidade do campo (antes era R$/kg ao lado de
// um campo em baldes). Login sem valores recebe preco nulo e ve so a embalagem.
function trLinhaComoPede(i) {
  const un = (i.un_medida || 'un').toLowerCase();
  // nome que ja traz a medida ("pacote 300 g") nao repete "de 300 g"
  const medida = i.emb_fator ? trEmbDesc(i) : '';
  const base = i.emb_fator
    ? (i.emb_nome === 'unidade' ? 'por unidade de ' + medida : 'vem em ' + i.emb_nome + (String(i.emb_nome).includes(medida) ? '' : ' de ' + medida))
    : (un === 'un' ? 'por unidade' : 'pede em ' + trUnNome(un, 1));
  if (i.nao_cobrado) return base + ' · não cobrado';
  if (!i.preco_tabela) return base;
  return base + (i.emb_fator
    ? ` · R$ ${fmt(Number(i.preco_tabela) * Number(i.emb_fator))} ${/(a|ade|ção)$/.test(i.emb_nome.split(' ')[0]) ? 'a' : 'o'} ${i.emb_nome}`
    : (un === 'un' ? ` · R$ ${fmt(Number(i.preco_tabela))} a unidade` : ` · R$ ${fmt(Number(i.preco_tabela))}/${un}`));
}
// sigla da unidade de controle por extenso: quem pede le "caixas", nao "cx"
function trUnNome(un, n) {
  const m = { un: ['unidade', 'unidades'], cx: ['caixa', 'caixas'], rl: ['rolo', 'rolos'], lt: ['litro', 'litros'], kg: ['kg', 'kg'] }[String(un || '').toLowerCase()];
  return m ? m[Number(n) < 2 ? 0 : 1] : String(un || '').toLowerCase();
}
// a palavra que fica embaixo do campo: em que unidade se digita
function trLinhaUnidade(i) {
  if (i.emb_fator) return trEmbPlural(String(i.emb_nome).split(' (')[0], 2);   // "caixas", sem o "(10x300 g)"
  return trUnNome(i.un_medida || 'un', 2);
}
// le a grade de um jeito so: o que foi preenchido e o que esta fora da regra
// (embalagem so sai inteira ou pela metade). Usado pelo resumo e pelo envio.
// O campo fora da regra fica com a borda vermelha ate ser corrigido.
function trLerGrade(itens, prefixo) {
  const escolhidos = [], erros = [];
  (itens || []).forEach((i, idx) => {
    const el = document.getElementById(prefixo + idx);
    const q = Number(el?.value || 0);
    if (el) el.style.borderColor = '';
    if (q <= 0) return;
    if (i.emb_fator && !trEmbInteira(q)) {
      erros.push(`${i.item}: ${trNum(q)} ${trEmbPlural(i.emb_nome, q)} — peça inteiro ou meio (ex.: ${Math.max(0.5, Math.round(q * 2) / 2).toLocaleString('pt-BR')})`);
      if (el) el.style.borderColor = 'var(--farol-fora)';
    }
    escolhidos.push({ i, q });
  });
  return { escolhidos, erros };
}
// ---- O RETORNO DO BOTAO (dono, 08/10/2026) ----
// A Loana: "quando fazem o pedido e apertamos botao enviar, nao acontece nada no app e eles
// ficam na duvida se o pedido foi feito ou nao". A mensagem existia — 12px ao lado do botao
// de CIMA — enquanto o resumo que a pessoa estava lendo sumia e a grade continuava
// preenchida; na duvida, o pedido ia de novo. Agora, nas tres acoes da filial (enviar o
// pedido, salvar a correcao, registrar o recebimento):
//  - enquanto grava, o botao fica apagado e diz o que esta fazendo, e o segundo toque nao
//    grava de novo;
//  - deu certo: a tela MUDA — um quadro no lugar do que a pessoa estava olhando;
//  - deu errado: o erro aparece onde a pessoa esta, e o que ela digitou continua la.
// So a tela mudou: o que vai para o banco e exatamente o que ia.
// Envio em andamento: uma lista por toque.
let trPedidoEnviando = false;
// os itens fora da grade, lidos de um jeito so (resumo e envio): nome em MAIUSCULA, como na base
function trPedidoAvulsos() {
  const avulsos = [];
  for (let k = 1; k <= trAvulsoN; k++) {
    const n = document.getElementById('trav_n_' + k);
    if (!n) continue;
    const nome = n.value.trim().toUpperCase();
    const q = Number(document.getElementById('trav_q_' + k)?.value || 0);
    if (nome && q > 0) avulsos.push({ item: nome, un_medida: document.getElementById('trav_u_' + k).value, qtd_solicitada: q });
  }
  return avulsos;
}
// Os pedidos da filial que ja foram ENVIADOS e ainda nao foram separados (SOLICITADA), com dia
// e hora e quantos itens cada um tem. A contagem vem da fila (vw_tr_fila_separacao); se essa
// leitura falhar, o aviso sai do mesmo jeito, sem ela.
async function trPedidoAbertas(unidade) {
  const u = encodeURIComponent(unidade);
  const [ra, rf] = await Promise.all([
    trFetch(`tr_listas?fonte=eq.PAINEL&status=eq.SOLICITADA&unidade=eq.${u}&select=id,data_pedido,importado_em&order=id.desc`),
    trFetch(`vw_tr_fila_separacao?unidade=eq.${u}&status=eq.SOLICITADA&select=id,itens`).catch(() => null),
  ]);
  const abertas = ra.ok ? await ra.json() : [];
  const nItens = {};
  if (rf && rf.ok) (await rf.json()).forEach(x => { nItens[x.id] = Number(x.itens); });
  return { abertas, nItens };
}
// O aviso do alto do Novo pedido: o que ja foi enviado e esta aguardando a separacao. E o que
// responde ao "sera que o pedido foi?" de quem volta a tela na duvida (o botao de corrigir
// continua). rodape = a frase do fim, que muda entre a grade e a tela de escolha.
function trPedidoJaEnviadoHtml(ab, rodape) {
  const abertas = (ab && ab.abertas) || [], nItens = (ab && ab.nItens) || {};
  if (!abertas.length) return '';
  return `<div id="trPedidoJaEnviado" class="contexto" style="margin:8px 0; text-align:left;">
      <span class="tr-conv" style="font-weight:800;">✅ ${abertas.length === 1 ? 'Pedido já enviado' : abertas.length + ' pedidos já enviados'}</span>
      — a Água Verde já recebeu e ${abertas.length === 1 ? 'ele está' : 'eles estão'} aguardando a separação. <b>Não precisa enviar de novo.</b>
      ${abertas.map(a => `<div style="margin-top:8px; display:flex; gap:6px 10px; align-items:center; flex-wrap:wrap;">
        <span>Lista <b>#${a.id}</b> · enviada em ${(a.importado_em && trDiaHoraTxt(a.importado_em)) || trDiaMes(a.data_pedido)}${a.id in nItens ? (nItens[a.id] > 0 ? ` · ${nItens[a.id]} ${nItens[a.id] === 1 ? 'item' : 'itens'}` : ' · <span class="tr-tag">sem nenhum item</span>') : ''}</span>
        <button class="preset-btn" onclick="trEditarPedido(${a.id})">✏️ esqueci um item — corrigir</button></div>`).join('')}
      <div class="tr-det" style="margin-top:8px; font-size:12.5px;">${rodape}</div>
    </div>`;
}
// As linhas do pedido como a pessoa le — na embalagem e na medida, sem valor em reais (serve
// igual para login sem valores). O MESMO texto no resumo e no quadro "Pedido enviado".
function trPedidoLinhasTxt(escolhidos, avulsos, comPreco) {
  return escolhidos.map(({ i, q }) => {
    const un = (i.un_medida || 'un').toLowerCase();
    return i.emb_fator
      ? `${i.nome_base || i.item} — <b>${trNum(q)} ${trEmbPlural(i.emb_nome, q)}</b> <span class="tr-det">= ${trNum(q * i.emb_fator, 3)} ${un}</span>`
      : `${i.nome_base || i.item} — <b>${trNum(q, 3)} ${un}</b>`;
  }).concat(avulsos.map(a => `${trEscH(a.item)} — ${trNum(a.qtd_solicitada, 3)} ${a.un_medida.toLowerCase()} (fora da grade${comPreco ? ', sem preço' : ''})`));
}
// Resumo antes de enviar (dono, 01/10/2026): a pessoa le o que esta pedindo, na
// embalagem e na medida, antes de a lista nascer. Serve para login sem valores.
function trRevisarPedido() {
  // envio em andamento: o resumo aberto e o que esta indo — nao se refaz por cima
  if (trPedidoEnviando) return;
  const msg = document.getElementById('trPedidoMsg');
  const box = document.getElementById('trPedidoResumo');
  if (!msg || !box) return;
  const { escolhidos, erros } = trLerGrade(window._trItensPedido, 'trq_');
  const avulsos = trPedidoAvulsos();
  if (!escolhidos.length && !avulsos.length) {
    // dito na caixa, embaixo do botao (antes: 12px em amarelo claro, ao lado dele)
    msg.textContent = '';
    box.hidden = false;
    box.innerHTML = '<b>Nenhuma quantidade preenchida.</b> Escreva quanto precisa ao lado de cada item e toque de novo em “Conferir e enviar”.';
    box.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (erros.length) {
    box.hidden = false;
    box.innerHTML = `<b>Corrija antes de enviar</b> — embalagem sai inteira ou pela metade:<br>${erros.join('<br>')}`;
    msg.textContent = `${erros.length} ${erros.length === 1 ? 'item' : 'itens'} para corrigir — veja abaixo (campo em vermelho)`; msg.style.color = '#ff6b6b';
    box.scrollIntoView({ block: 'nearest' });
    return;
  }
  msg.textContent = '';
  box.hidden = false;
  box.innerHTML = `<b>Você está pedindo para ${window._trPedidoUnidade}:</b>
    <div style="margin:6px 0; font-size:12.5px; line-height:1.6;">${trPedidoLinhasTxt(escolhidos, avulsos, true).join('<br>')}</div>
    <button id="trPedidoBtnEnviar" class="preset-btn tr-btn-cheio" onclick="trCriarPedido()">Está certo — enviar pedido</button>
    <button id="trPedidoBtnVoltar" class="preset-btn" onclick="trResumoFecha()">voltar e corrigir</button>
    <div id="trPedidoErro" style="margin-top:12px; padding-top:10px; border-top:2px solid var(--brand); color:var(--brand);" hidden></div>`;
  box.scrollIntoView({ block: 'nearest' });
}

// campo preenchido ganha borda verde na ilha clara (ver de relance o que ja foi pedido)
function trqTem(el) { el.classList.toggle('tem', el.value !== ''); el.style.borderColor = ''; trResumoFecha(); trPedidoSoma(); }
// O resumo e uma foto dos campos: mexeu em qualquer campo, ele fecha — o botao
// "Esta certo — enviar" so existe ao lado de um resumo que bate com a grade.
function trResumoFecha() {
  if (trPedidoEnviando) return;   // no meio do envio o resumo fica de pe, com o botao dizendo "Enviando…"
  const box = document.getElementById('trPedidoResumo');
  if (box && !box.hidden) { box.hidden = true; const m = document.getElementById('trPedidoMsg'); if (m) m.textContent = ''; }
}

// Parcial ao vivo do pedido em montagem (dono, 11/09/2026): soma quantidade x
// preco de tabela conforme a pessoa digita (embalagem convertida). Login sem
// valores nao ve nada — os precos ja chegam nulos da view.
function trPedidoSoma() {
  const el = document.getElementById('trPedidoParcial');
  if (!el) return;
  let total = 0, semPreco = 0, tem = false;
  const escolhidos = [];
  (window._trItensPedido || []).forEach((i, idx) => {
    const q = Number(document.getElementById('trq_' + idx)?.value || 0);
    if (q <= 0) return;
    tem = true;
    escolhidos.push({ i, q });
    if (i.preco_tabela == null) { semPreco++; return; }
    const qtd = i.emb_fator ? q * i.emb_fator : q;
    total += qtd * Number(i.preco_tabela);
  });
  // o pote que acompanha entra no parcial pelo preco de tabela dele
  Object.entries(trPotesDe(escolhidos)).forEach(([pi, pt]) => {
    const pc = (window._trGradePedido || []).find(x => x.item === pi)?.preco_tabela;
    if (pc != null) total += pt.n * Number(pc);
  });
  el.textContent = !tem || (total === 0 && semPreco === 0) ? ''
    : (total > 0 ? `Parcial: R$ ${fmt(total)}` : '')
      + (semPreco ? ` (${semPreco} item(ns) sem preço fora da soma)` : '');
}

// Busca da grade do pedido: esconde o que nao casa, sem perder o que ja foi
// digitado (display:none mantem o valor do campo; o envio le por id).
function trPedidoFiltra() {
  const q = (document.getElementById('trPedidoBusca')?.value || '').toLowerCase();
  document.querySelectorAll('label[data-busca]').forEach(el => {
    // 'grid', nunca '': limpar o display apagava o grid inline da linha e
    // o campo desalinhava ao voltar do filtro (visto pelo dono em 04/09)
    el.style.display = !q || el.dataset.busca.includes(q) ? 'grid' : 'none';
  });
}

// Pedido por embalagem (04/09/2026): quem pede fala em potes/baldes/pacotes;
// o painel converte ao vivo para a unidade de CONTROLE (kg ou un), grava a
// quantidade convertida e anota o pedido original na observacao da linha.
// "pote de 700 g", "bandeja de 30 un", "balde de 4,5 kg"...
function trEmbDesc(i) {
  const f = Number(i.emb_fator);
  if ((i.un_medida || '') === 'KG') return f >= 1 ? String(f).replace('.', ',') + ' kg' : Math.round(f * 1000) + ' g';
  return f + ' ' + (i.un_medida || 'un').toLowerCase();
}
// ---- UMA LINGUA SO (dono, 01/10/2026) ----
// A confusao da "forma de pedir" vinha de cada tela pedir o numero numa unidade
// (pedido e conferencia em embalagem; corrigir pedido e separacao em kg) e de o
// campo nao dizer qual. Agora: a palavra da unidade fica ESCRITA junto do campo,
// o pedido e a correcao falam em embalagem, e a embalagem sai inteira ou pela
// metade (dono: "as embalagens podem sair pela metade em alguns casos").
// Plural do nome da embalagem: "pacote (20x130 g)" -> "pacotes (20x130 g)",
// "meia peça" -> "meias peças", "galão" -> "galões".
function trEmbPlural(nome, n) {
  if (!nome || Number(n) < 2) return nome || '';   // 0,5 caixa, 1 caixa, 1,5 caixa, 2 caixas
  let parou = false;
  return String(nome).split(' ').map(p => {
    if (parou || /^[(\d]/.test(p)) { parou = true; return p; }
    return /ão$/.test(p) ? p.replace(/ão$/, 'ões') : (/[aeiou]$/i.test(p) ? p + 's' : p + 'es');
  }).join(' ');
}
// numero em pt-BR sem zeros a direita: 4.5 -> "4,5"; 12 -> "12"
function trNum(v, casas = 2) { return Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: casas }); }
// embalagem sai inteira ou pela metade: 1, 1,5, 2 — nunca 11,11
function trEmbInteira(q) { return Math.abs(q * 2 - Math.round(q * 2)) < 1e-6; }
// quantas embalagens ha em `qtd` (unidade de controle). Arredonda ANTES de
// comparar: 7 pacotes de 1,2 kg = 8,4 kg voltam como 7,000000000000001.
function trEmbConta(qtd, fator) { return Math.round(Number(qtd || 0) / Number(fator) * 100) / 100; }
// "1 balde · 4,5 kg": o pedido na lingua de quem pediu, com a medida ao lado.
// So converte quando a linha esta na MESMA unidade da grade e a conta fecha em
// embalagem inteira ou meia — lista antiga, item de duas embalagens e numero
// quebrado mostram so a medida, sem inventar contagem.
function trQtdEmbTxt(qtd, un, cat) {
  const medida = `${trNum(qtd, 3)} ${(un || '').toLowerCase()}`;
  const n = trEmbQtdDe(qtd, un, cat);
  if (n == null) return medida;
  return `<b>${trNum(n)} ${trEmbPlural(cat.emb_nome, n)}</b> <span class="tr-det">· ${medida}</span>`;
}
// A REGRA do "fecha em embalagem", num lugar so (01/10/2026: o pedido e o documento de
// fechamento usam a mesma): quantas embalagens ha em `qtd`, ou null quando nao da para
// dizer — item sem embalagem na grade, de duas embalagens, linha em outra unidade, ou
// numero que nao fecha em embalagem inteira ou meia.
function trEmbQtdDe(qtd, un, cat) {
  if (!cat || !cat.emb_fator || cat.emb2_fator || (cat.un_medida || '') !== (un || '') || !Number(qtd)) return null;
  // testa a razao CRUA: arredondar antes fazia 1 un de um rolo de 250 virar
  // "0 rolos" e 5 kg de uma caixa de 10,1 kg virar "0,5 caixa". A folga e so
  // para o erro de ponto flutuante e as 3 casas do banco; menos de meia
  // embalagem nunca vira contagem.
  const r = Number(qtd) / Number(cat.emb_fator);
  if (r < 0.5 || Math.abs(r * 2 - Math.round(r * 2)) > 0.002) return null;
  return Math.round(r * 2) / 2;
}
// catalogo da filial por item (embalagem e unidade), para as telas depois do pedido
async function trCatMapa(unidade) {
  const r = await trFetch(`vw_tr_itens_pedido?unidade=eq.${encodeURIComponent(unidade || 'AHU')}&select=item,un_medida,emb_nome,emb_fator,emb2_nome,emb2_fator,peso_variavel`);
  const m = {};
  if (r.ok) (await r.json()).forEach(x => { m[x.item] = x; });
  return m;
}
// ---- SEPARACAO PESA E CONTA, CONFERENCIA CONTA (dono, 01/10/2026) ----
// "A separacao possa pesar e a conferencia conta por pacotes." A linha da lista
// guarda, alem do peso (qtd_separada / qtd_recebida), QUANTAS embalagens sairam
// e quantas chegaram (emb_separada / emb_recebida). Bateu a contagem, vale o
// peso da separacao; chegou diferente, o recebido e proporcional (9 de 10
// pacotes = 90% do peso). Linha SEM contagem (lista antiga, item sem embalagem,
// item de duas embalagens, pote automatico) segue exatamente como antes.
// A tolerancia do aviso de peso e a MESMA das views vw_tr_peso_por_envio e
// vw_tr_peso_fora_do_combinado (script/separacao_peso_e_contagem.sql) — mudou
// uma, mude a outra.
const TR_PESO_TOL = 0.10;
// a medida fugiu mais de 10% do combinado para essa contagem? (arredonda antes
// de comparar: 4,95 / 4,5 - 1 da 0,10000000000000009 e acenderia no limite)
function trPesoFora(n, medida, fator) {
  const combinado = Number(n) * Number(fator);
  if (!(combinado > 0) || !(Number(medida) > 0)) return false;
  return Math.abs(Math.round((Number(medida) / combinado - 1) * 10000) / 10000) > TR_PESO_TOL;
}
// a separacao contou as embalagens desta linha?
function trTemContagem(i) { return i.emb_separada != null && Number(i.emb_separada) > 0 && Number(i.qtd_separada) > 0; }
// "10 pacotes · 4,2 kg": a contagem em destaque, o peso/medida ao lado
function trContTxt(n, qtd, un, nome) {
  return `<b>${trNum(n)} ${trEmbPlural(nome || 'volume', Number(n) === 0 ? 2 : n)}</b> <span class="tr-det">· ${trNum(qtd, 3)} ${(un || '').toLowerCase()}</span>`;
}
// Separado e Recebido nas telas de consulta (lista finalizada e Financeiro): com
// contagem, "10 pacotes · 4,2 kg"; sem contagem, o texto de sempre (`senao`).
function trSepTxt(i, c, senao) {
  return i.emb_separada != null && Number(i.emb_separada) > 0
    ? trContTxt(i.emb_separada, i.qtd_separada, i.un_medida, c && c.emb_nome) : senao;
}
function trRecTxt(i, c, senao) {
  return i.emb_recebida != null && i.emb_separada != null && Number(i.emb_separada) > 0
    ? trContTxt(i.emb_recebida, i.qtd_recebida, i.un_medida, c && c.emb_nome) : senao;
}
// "450 g", "1,2 kg", "26 un": a medida de UMA embalagem, como no rotulo da grade
function trMedidaEmb(v, un) { return trEmbDesc({ un_medida: un, emb_fator: Math.round(Number(v) * 1000) / 1000 }); }
// Bloco "Peso diferente do combinado" da fila de separacao: os itens que, nos
// ultimos 60 dias, sairam em media mais de 10% fora do peso combinado da
// embalagem (vw_tr_peso_fora_do_combinado — so dono e separacao recebem linhas).
// Sem itens, o bloco nao existe.
function trPesoAlertaHtml(alerta) {
  if (!Array.isArray(alerta) || !alerta.length) return '';
  // 04/11/2026 18:20 (dono: "separar ele da grade dos pedidos, aparecer logo abaixo"): um quadro só, com
  // borda e título próprios — a tabela fica DENTRO do quadro, para não parecer continuação da fila
  return `<div class="contexto" style="border-color:var(--farol-perto); margin-top:22px; text-align:left;">
    <div><b>⚖️ Peso diferente do combinado</b> — nos últimos 60 dias estes itens saíram com um peso diferente do
    que está combinado para a embalagem. Vale rever com o Neto o peso combinado (ou a porção na produção).</div>
    <div id="tabelaTrPesoFora" style="margin-top:10px;"><table>
      <tr><th>Item</th><th>Combinado</th><th>Vem dando</th><th>Em quantos envios</th></tr>
      ${alerta.map(a => { const d = Number(a.desvio_pct); const emb = String(a.emb_nome || 'volume').split(' (')[0]; return `<tr>
        <td>${a.item}</td>
        <td>${emb} de ${trMedidaEmb(a.peso_combinado, a.un_medida)}</td>
        <td><b>${trMedidaEmb(a.peso_medio, a.un_medida)}</b> <span class="tr-tag">${trNum(Math.abs(d), 1)}% ${d < 0 ? 'a menos' : 'a mais'}</span></td>
        <td>${a.envios} ${Number(a.envios) === 1 ? 'envio' : 'envios'} <span class="tr-det">· ${trNum(a.embalagens)} ${trEmbPlural(emb, a.embalagens)}</span></td></tr>`; }).join('')}
    </table></div></div>`;
}
// Letreiro da linha (24/09/2026, dono): conversao da embalagem E o valor do
// item conforme digita — "2 × 700 g ≈ 1,4 kg = R$ 26,51". Login sem valores
// ve so a conversao (preco chega nulo); item nao cobrado nao mostra R$ 0.
function trEmbHint(idx) {
  const i = (window._trItensPedido || [])[idx];
  const el = document.getElementById('trqe_' + idx);
  if (!i || !el) return;
  const n = Number(document.getElementById('trq_' + idx)?.value || 0);
  if (n <= 0) { el.textContent = ''; return; }
  const partes = [];
  if (i.emb_fator) partes.push(`${trNum(n)} × ${trEmbDesc(i)} ≈ ${(n * i.emb_fator).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${(i.un_medida || 'un').toLowerCase()}`);
  if (i.preco_tabela != null && Number(i.preco_tabela) > 0) {
    const qtd = i.emb_fator ? n * i.emb_fator : n;
    partes.push(`R$ ${fmt(qtd * Number(i.preco_tabela))}`);
  }
  const pote = trPotesDe([{ i, q: n }])[i._acomp?.acomp_item];
  el.textContent = partes.join(' = ') + (pote ? ` · + ${pote.n} ${pote.nome.toLowerCase()}` : '');
}

// Pote que acompanha (dono, 28/09/2026): feijoada e canja levam o pote na
// lista. A regra NAO mora aqui: vem da ft_embalagem_familia (canal
// TRANSFERENCIA, a fonte unica de embalagem) por vw_tr_embalagem_acompanha,
// ja resolvida para o item da grade. slot 1 = emb_nome, 2 = emb2_nome.
async function trAcompanhaRegras() {
  const r = await trFetch('vw_tr_embalagem_acompanha?select=item,slot,acomp_item,acomp_qtd,acomp_nome_base');
  return r.ok ? await r.json() : [];
}
function trAcompanhaDe(regras, item, slot) {
  return regras.find(a => a.item === item && (a.slot === slot || a.slot == null)) || null;
}
// So conta embalagem inteira (q = numero de porcoes/potes pedidos): item sem
// embalagem na grade e pedido em kg, e kg nao diz quantos potes sao.
function trPotesDe(escolhidos) {
  const potes = {};
  escolhidos.forEach(({ i, q }) => {
    if (!i._acomp || !i.emb_fator || q <= 0) return;
    const n = Math.round(q * Number(i._acomp.acomp_qtd) * 1000) / 1000;
    const p = potes[i._acomp.acomp_item] = potes[i._acomp.acomp_item] || { n: 0, nome: i._acomp.acomp_nome_base, partes: [] };
    p.n = Math.round((p.n + n) * 1000) / 1000;
    p.partes.push(`${n} de ${i.item.replace(/ RECEITA$/, '').toLowerCase()} (${i.emb_nome})`);
  });
  return potes;
}

// itens fora da grade: linhas dinamicas no fim do pedido (03/09/2026)
let trAvulsoN = 0;
function trAddAvulso() {
  trAvulsoN++;
  const d = document.createElement('div');
  d.style.cssText = 'display:flex; gap:6px; margin:4px 0; align-items:center; flex-wrap:wrap;';
  d.innerHTML = `
    <input type="text" id="trav_n_${trAvulsoN}" class="trc-in" placeholder="nome do item" maxlength="80" oninput="trResumoFecha()"
      style="flex:1; min-width:170px; padding:6px 8px;">
    <input type="number" min="0" step="any" inputmode="decimal" id="trav_q_${trAvulsoN}" class="trc-in" placeholder="quanto" oninput="trResumoFecha()"
      style="width:72px; padding:6px 8px; text-align:right;">
    <select id="trav_u_${trAvulsoN}" class="trc-in" style="padding:6px 8px;" onchange="trResumoFecha()">
      <option>KG</option><option>UN</option><option>LT</option>
    </select>`;
  document.getElementById('trAvulsos').appendChild(d);
}

// "08/10 às 18:01": dia e hora de Sao Paulo de um carimbo do banco (sem carimbo, agora).
// Carimbo que o navegador nao consegue ler devolve '' e quem chama decide o que mostrar:
// a hora de AGORA nunca entra no lugar da hora em que um pedido antigo foi enviado.
function trDiaHoraTxt(carimbo) {
  // o banco manda os segundos com ate 6 casas (as vezes 5, as vezes 1) e ha navegador que
  // so le 3: como a tela mostra ate o minuto, a fracao sai inteira antes de ler
  const d = carimbo ? new Date(String(carimbo).replace(/\.\d+/, '')) : new Date();
  if (isNaN(d.getTime())) return '';
  const p = {};
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}
// Sobe a tela ate o quadro. No celular o menu do painel fica PRESO no alto da tela (a
// barra dos modulos) e cobriria o titulo do quadro: a rolagem desconta a altura dele.
function trSobeAte(el) {
  if (!el) return;
  const menu = document.querySelector('.sidebar');
  const r = menu ? menu.getBoundingClientRect() : null;
  const preso = r && getComputedStyle(menu).position === 'sticky' && r.width >= window.innerWidth - 1 ? r.height : 0;
  el.style.scrollMarginTop = (preso + 12) + 'px';
  el.scrollIntoView({ block: 'start' });
}
// os dois botoes do resumo enquanto o pedido esta indo: apagados, e o de enviar diz "Enviando…"
// (ou "Conferindo…", quando a tela esta perguntando ao banco se o pedido entrou)
function trPedidoBotoes(enviando, fazendo) {
  const b = document.getElementById('trPedidoBtnEnviar'), v = document.getElementById('trPedidoBtnVoltar');
  if (b) { b.disabled = enviando; b.textContent = enviando ? (fazendo || 'Enviando…') : 'Está certo — enviar pedido'; b.style.opacity = enviando ? '.6' : ''; b.style.cursor = enviando ? 'wait' : ''; }
  if (v) { v.disabled = enviando; v.style.opacity = enviando ? '.5' : ''; v.style.cursor = enviando ? 'not-allowed' : ''; }
}
// O envio nao deu certo: o erro aparece DENTRO do resumo, onde a pessoa esta. O resumo e
// refeito com o que esta na grade AGORA (ele e sempre a foto dos campos), o botao de enviar
// volta a ficar de pe e a grade continua preenchida.
// titulo = o que aconteceu, em letra grande; detalhe = o que fazer; motivo = o que o sistema
// respondeu, em cinza (para quem for ajudar).
function trPedidoFalhou(titulo, detalhe, motivo) {
  trPedidoEnviando = false;
  trRevisarPedido();
  const box = document.getElementById('trPedidoResumo');
  if (!box) return;
  box.hidden = false;
  let e = document.getElementById('trPedidoErro');
  if (!e) {
    box.insertAdjacentHTML('beforeend', '<div id="trPedidoErro" style="margin-top:12px; padding-top:10px; border-top:2px solid var(--brand); color:var(--brand);"></div>');
    e = document.getElementById('trPedidoErro');
  }
  e.innerHTML = `<div style="font-size:16px; font-weight:800; line-height:1.3;">⚠️ ${titulo}</div>
    <div style="margin-top:4px; font-weight:600;">${detalhe}</div>
    ${motivo ? `<div class="tr-det" style="margin-top:6px; font-size:12px;">O que o sistema respondeu: ${trEscH(motivo)}</div>` : ''}`;
  e.hidden = false;
  e.scrollIntoView({ block: 'nearest' });
}
// A internet caiu DEPOIS de a lista ser aberta e nao se sabe se os itens entraram: a tela
// pergunta ao banco. Entraram -> quadro "Pedido enviado". Nao entraram -> apaga a lista vazia
// (a mesma limpeza de quando o banco recusa os itens) e libera para enviar de novo. Sem
// resposta -> diz que nao sabe, pede para NAO reenviar e deixa o botao de conferir.
async function trPedidoConfere() {
  const p = window._trPedidoPendente;
  if (!p || !p.lista || trPedidoEnviando) return;
  trPedidoEnviando = true;
  trPedidoBotoes(true, 'Conferindo…');
  try {
    const r = await trFetch(`tr_lista_itens?id_lista=eq.${p.lista.id}&select=id`);
    if (!r.ok) throw new Error(await trErroDe(r));
    const n = (await r.json()).length;
    if (n > 0) { window._trPedidoPendente = null; p.n = n; trPedidoEnviadoTela(p); return; }
    await trFetch(`tr_listas?id=eq.${p.lista.id}`, { method: 'DELETE' });
    window._trPedidoPendente = null;
    trPedidoFalhou('O pedido NÃO entrou', 'A internet caiu no meio e nada foi criado. O que você digitou continua aqui: pode enviar de novo.');
  } catch (e) {
    trPedidoFalhou('A internet caiu no meio do envio', `Não deu para confirmar se a lista #${p.lista.id} ficou com os itens. NÃO envie de novo ainda: quando a internet voltar, toque no botão abaixo.<br>
      <button class="preset-btn" style="margin-top:8px;" onclick="trPedidoConfere()">conferir se o pedido entrou</button>`);
  } finally {
    trPedidoEnviando = false;
    trPedidoBotoes(false);
  }
}
// O QUADRO "PEDIDO ENVIADO": entra no lugar da grade — e a tela sobe ate ele. Diz o numero da
// lista, a filial, dia e hora (o carimbo do banco), quantos itens, os dois caminhos (antes da
// lista: no celular, 20 linhas empurrariam os botoes para fora da tela) e as MESMAS linhas do
// resumo. Sem preco e sem total, de proposito, para qualquer login: valor quem mostra e a
// aba Conferencia (em preparo na central), que le do banco.
function trPedidoEnviadoTela(p) {
  const alvo = document.getElementById('trTelaConteudo');
  if (!alvo) return;
  const id = p.lista.id, n = Number(p.n || 0);
  const origem = p.origem === 'FORNECEDOR' ? ' · 🛒 Fornecedor' : p.origem === 'CIDADAO' ? ' · 🏭 Produção Cidadão' : '';
  alvo.innerHTML = `
    <div id="trPedidoEnviado" class="contexto" style="text-align:left; margin:8px 0; padding:16px;">
      <div class="tr-conv" style="font-size:22px; font-weight:800; line-height:1.2;">✅ Pedido enviado</div>
      <div style="margin-top:6px; font-size:15px;">Lista <b>#${id}</b> · <b>${p.unidade}</b>${origem}</div>
      <div>${trDiaHoraTxt(p.lista.importado_em) || trDiaHoraTxt()} · <b>${n} ${n === 1 ? 'item' : 'itens'}</b>${p.nAvulsos ? ` <span class="tr-det">(${p.nAvulsos} fora da grade)</span>` : ''}</div>
      <div style="margin-top:10px;">A Água Verde <b>já recebeu</b> este pedido: ele está na fila de separação. <b>Não precisa enviar de novo.</b></div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
        <button class="preset-btn" style="padding:12px 16px;" onclick="trPedidoOrigem=null; trTelaPedido()">📝 Fazer outro pedido</button>
        <button class="preset-btn" style="padding:12px 16px;" onclick="trEditarPedido(${id})">✏️ Esqueci um item — corrigir este pedido</button>
      </div>
      <div class="tr-det" style="margin-top:10px; font-size:12.5px;">Dá para corrigir até a separação começar. Para acompanhar o pedido: aba ✅ Conferência.</div>
      <div class="tr-secao">O que foi pedido</div>
      <div style="font-size:13px; line-height:1.7;">${p.linhas.join('<br>')}</div>
    </div>`;
  trSobeAte(document.getElementById('trPedidoEnviado'));
}
// O quadro no alto da tela de corrigir, logo depois de salvar (trSalvarEdicao)
function trEditSalvoHtml(id, unidade, aviso) {
  if (!aviso || !aviso.salvo) return '';
  return `<div id="trEditSalvo" class="contexto" style="text-align:left; margin:8px 0; padding:14px 16px;">
      ${aviso.mudou ? `<div class="tr-conv" style="font-size:20px; font-weight:800; line-height:1.2;">✅ Alterações salvas</div>
      <div style="margin-top:4px;">Lista <b>#${id}</b> · ${unidade} · ${aviso.salvo}. A Água Verde já vê o pedido corrigido — abaixo, como ele ficou.</div>`
      : `<div style="font-size:16px; font-weight:800;">Nada foi alterado</div>
      <div style="margin-top:4px;">Nenhuma quantidade mudou: a lista <b>#${id}</b> continua como estava.</div>`}
      ${trTela === 'pedido' ? `<div style="margin-top:10px;"><button class="preset-btn" onclick="trTelaSet('pedido')">pronto — voltar para Novo pedido</button></div>` : ''}
    </div>`;
}
// O quadro que entra no lugar da conferencia depois de registrar o recebimento
// (trFecharConferencia). As diferencas vem de vw_tr_divergencias, como antes; divs = null
// quer dizer que essa leitura falhou — ai o quadro nao afirma nada e manda ver a lista.
function trConfFechadaTela(id, divs) {
  const alvo = document.getElementById('trTelaConteudo');
  if (!alvo) return;
  alvo.innerHTML = `
    <div id="trConfFechada" class="contexto" style="text-align:left; margin:8px 0; padding:16px;">
      <div class="tr-conv" style="font-size:22px; font-weight:800; line-height:1.2;">✅ Recebimento registrado</div>
      <div style="margin-top:6px; font-size:15px;">Lista <b>#${id}</b> conferida e fechada · ${trDiaHoraTxt()}</div>
      <div style="margin-top:10px;">${!Array.isArray(divs) ? 'Para ver se algum item veio diferente do separado, toque em “ver esta lista”.'
        : divs.length
        ? `<b>${divs.length} ${divs.length === 1 ? 'item veio diferente' : 'itens vieram diferentes'} do separado:</b><br>`
          + divs.map(d => `${d.item} — ${d.diferenca > 0 ? 'sobrou' : 'faltou'} ${trNum(Math.abs(d.diferenca), 3)} ${(d.un_medida || '').toLowerCase()}`).join('<br>')
        : 'O recebimento <b>bateu 100%</b> com a separação.'}</div>
      <div class="tr-det" style="margin-top:8px; font-size:12.5px;">A cobrança não sai agora: entra no fechamento do mês.</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:16px;">
        <button class="preset-btn" style="padding:12px 16px;" onclick="trConfAba='ABERTAS'; trListaAberta=null; trTelaConferencia();">← voltar para as listas</button>
        <button class="preset-btn" style="padding:12px 16px;" onclick="trConfAba='FINALIZADAS'; trListaAberta=${id}; trTelaConferencia();">ver esta lista</button>
      </div>
    </div>`;
  trSobeAte(document.getElementById('trConfFechada'));
}

async function trCriarPedido() {
  // uma lista por toque: enquanto o primeiro envio nao voltou do banco, o segundo toque nao
  // faz nada (o botao tambem fica apagado, dizendo "Enviando…")
  if (trPedidoEnviando) return;
  // a internet caiu no envio anterior e nao se sabe se aquela lista ficou com os itens:
  // antes de abrir OUTRA lista, a tela confere aquela
  if (window._trPedidoPendente) return trPedidoConfere();
  // a trava fica AQUI, no envio (o atributo step do campo nao impede nada: a
  // tela nao e um <form>) — embalagem so sai inteira ou pela metade
  const { escolhidos, erros } = trLerGrade(window._trItensPedido, 'trq_');
  // itens fora da grade: nome digitado vira MAIUSCULA (padrao da base); se o
  // nome bater com um item da grade, o banco precifica normal em vez de avulso
  const avulsos = trPedidoAvulsos();
  // campo fora da regra ou nada preenchido: quem diz e o resumo, na caixa
  if (erros.length || (!escolhidos.length && !avulsos.length)) { trRevisarPedido(); return; }
  const unidade = window._trPedidoUnidade;
  // a foto do que esta indo AGORA — e o que o quadro "Pedido enviado" mostra
  const pedido = { unidade, origem: trPedidoOrigem, nAvulsos: avulsos.length,
    linhas: trPedidoLinhasTxt(escolhidos, avulsos, TR_OP.veValores !== false) };
  trPedidoEnviando = true;
  trPedidoBotoes(true);
  let lista = null;
  try {
    const rl = await trFetch('tr_listas', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ unidade, fonte: 'PAINEL', data_pedido: trHoje() }),
    });
    if (!rl.ok) {
      return trPedidoFalhou('O pedido NÃO foi enviado', 'Nada foi criado e o que você digitou continua aqui. Toque em enviar de novo.', await trErroDe(rl));
    }
    lista = (await rl.json())[0];
    if (!lista || lista.id == null) {
      lista = null;
      return trPedidoFalhou('O envio NÃO foi confirmado', 'O sistema não devolveu o número da lista. Avise o Neto antes de enviar de novo.');
    }
    pedido.lista = lista;
    // Uma linha por ITEM na lista: as duas embalagens do mesmo item (pernil)
    // somam na mesma linha, com a observacao guardando o pedido original.
    // E TODAS as linhas com as MESMAS chaves (observacao: null quando nao ha) —
    // o PostgREST recusa lote com objetos de campos diferentes ("All object
    // keys must match"; mordeu no 1o pedido real do Ahu em 04/09/2026).
    const porItem = {};
    escolhidos.forEach(x => {
      const qtd = x.i.emb_fator ? Math.round(x.q * x.i.emb_fator * 1000) / 1000 : x.q;
      const p = porItem[x.i.item] = porItem[x.i.item] ||
        { id_lista: lista.id, item: x.i.item, un_medida: x.i.un_medida, qtd_solicitada: 0, obs: [] };
      p.qtd_solicitada = Math.round((p.qtd_solicitada + qtd) * 1000) / 1000;
      if (x.i.emb_fator) p.obs.push(`${x.q} ${x.i.emb_nome}(s)`);
    });
    // pote automatico: soma na MESMA linha do pote (uma linha por item — se a
    // filial tambem pediu caixa, fica tudo junto), com a parte automatica em qtd_auto
    Object.entries(trPotesDe(escolhidos)).forEach(([pi, pt]) => {
      const cat = (window._trGradePedido || []).find(x => x.item === pi);
      const p = porItem[pi] = porItem[pi] ||
        { id_lista: lista.id, item: pi, un_medida: cat?.un_medida || 'UN', qtd_solicitada: 0, obs: [] };
      p.qtd_solicitada = Math.round((p.qtd_solicitada + pt.n) * 1000) / 1000;
      p.auto = pt.n;
      p.autoObs = 'automático: ' + pt.partes.join(' + ');
    });
    pedido.n = Object.keys(porItem).length + avulsos.length;
    // o pote que entra sozinho tambem aparece no quadro (a contagem de itens ja o inclui)
    Object.values(porItem).filter(p => p.auto != null).forEach(p => pedido.linhas.push(
      `${p.item} — <b>${trNum(p.auto, 3)} ${(p.un_medida || 'un').toLowerCase()}</b> <span class="tr-det">vai junto, entra sozinho</span>`));
    const ri = await trFetch('tr_lista_itens', {
      method: 'POST',
      body: JSON.stringify(Object.values(porItem).map(p => ({
        id_lista: p.id_lista, item: p.item, un_medida: p.un_medida, qtd_solicitada: p.qtd_solicitada,
        observacao: [p.obs.length ? 'pedido: ' + p.obs.join(' + ') : null, p.autoObs].filter(Boolean).join(' · ') || null,
        qtd_auto: p.auto ?? null,
      })).concat(avulsos.map(a => ({ id_lista: lista.id, item: a.item, un_medida: a.un_medida,
        qtd_solicitada: a.qtd_solicitada, observacao: null, qtd_auto: null })))),
    });
    if (!ri.ok) {
      const erro = await trErroDe(ri);
      // desfaz a lista vazia para nao poluir a fila da separacao
      await trFetch(`tr_listas?id=eq.${lista.id}`, { method: 'DELETE' });
      lista = null;
      return trPedidoFalhou('O pedido NÃO entrou', 'Nada foi criado e o que você digitou continua aqui. Pode tentar de novo.', erro);
    }
    trPedidoEnviadoTela(pedido);
  } catch (e) {
    // o fetch nem voltou: a internet caiu no meio (antes a tela ficava em "Enviando..." para sempre)
    if (lista) {
      // a lista foi aberta e a resposta dos itens nao chegou — a tela pergunta ao banco
      window._trPedidoPendente = pedido;
      trPedidoEnviando = false;
      await trPedidoConfere();
    } else {
      trPedidoFalhou('O pedido NÃO foi enviado', 'A tela não conseguiu falar com o sistema (a internet caiu?). O que você digitou continua aqui: quando a internet voltar, toque em enviar de novo.');
    }
  } finally {
    trPedidoEnviando = false;
    trPedidoBotoes(false);
  }
}

// ---- edicao de pedido salvo (dono, 04/09/2026) ----
// So lista SOLICITADA (a separacao ainda nao comecou). Linha mexida ou
// incluida ganha editado=true e o selo ✏️ na separacao/conferencia/PDF.
// Desde 01/10/2026 a correcao e na MESMA unidade do pedido (embalagem), tanto
// nas linhas que ja estao na lista quanto na inclusao de item novo — ver
// "UMA LINGUA SO". So fica na medida (kg/un) o que nao tem embalagem unica.
async function trEditarPedido(id, aviso) {
  const alvo = document.getElementById('trTelaConteudo');
  const rl = await trFetch(`tr_listas?id=eq.${id}&select=id,unidade,status`);
  const lista = (await rl.json())[0];
  // filial edita so SOLICITADA; dono e compras corrigem tambem SEPARADA e
  // ENVIADA (11/09/2026 — consertar pedido errado sem excluir a lista)
  const podeCorrigir = ['DONO', 'SEPARACAO'].includes(TR_OP.papel) && lista && ['SEPARADA', 'ENVIADA'].includes(lista.status);
  if (!lista || (lista.status !== 'SOLICITADA' && !podeCorrigir)) {
    alvo.innerHTML = `${trEditSalvoHtml(id, lista ? lista.unidade : '', aviso)}<div class="contexto">A lista #${id} está <b>${lista ? lista.status : '?'}</b> — só dá para editar
      antes de a separação começar (dono e compras corrigem até ENVIADA). <button class="preset-btn" onclick="trTelaPedido(${lista ? `'${lista.unidade}'` : ''})">← voltar</button></div>`;
    return;
  }
  const [ri, rc, regras] = await Promise.all([
    trFetch(`tr_lista_itens?id_lista=eq.${id}&order=item&select=id,item,un_medida,qtd_solicitada,observacao,avulso,editado,qtd_auto`),
    trFetch(`vw_tr_itens_pedido?unidade=eq.${encodeURIComponent(lista.unidade)}&order=item`),
    trAcompanhaRegras(),
  ]);
  const itens = await ri.json();
  const catalogo = rc.ok ? await rc.json() : [];
  const nomes = new Set(itens.map(i => i.item));
  // grade dos que FALTAM: mesma cara do pedido (alfabetica, busca, embalagens
  // — item com 2a embalagem vira duas linhas)
  const novos = [];
  catalogo.filter(x => !nomes.has(x.item)).forEach(i => {
    novos.push({ ...i, _acomp: trAcompanhaDe(regras, i.item, 1) });
    if (i.emb2_fator) novos.push({ ...i, emb_nome: i.emb2_nome, emb_fator: i.emb2_fator, _acomp: trAcompanhaDe(regras, i.item, 2) });
  });
  window._trGradeEdit = catalogo;
  // fatores por item: usados para REESCREVER a anotacao "pedido: N ..." quando
  // a quantidade de um item com embalagem simples e editada (dono viu a #24422
  // com "3 pacotes" no nome e 5 no campo — a obs ficava velha)
  const fatores = {};
  catalogo.forEach(x => { if (x.emb_fator && !x.emb2_fator) fatores[x.item] = { n: x.emb_nome, f: Number(x.emb_fator), un: x.un_medida }; });
  // UMA LINGUA SO (01/10/2026): a correcao e na MESMA unidade do pedido. Item de
  // embalagem unica corrige em pacotes/baldes; o resto (sem embalagem, duas
  // embalagens, pote automatico, linha antiga noutra unidade) segue na medida.
  // Antes o campo era em kg e a anotacao saia de uma divisao — e dai que vinha
  // o "pedido: 11.11 pacote(s)" (alguem digitou 5 querendo 5 pacotes).
  itens.forEach(i => {
    const fx = fatores[i.item];
    // menos de meia embalagem (1 un de um rolo de 250) fica na medida: em
    // embalagem o campo abriria com "0 rolos"
    i._emb = fx && fx.un === i.un_medida && i.qtd_auto == null && Number(i.qtd_solicitada) / fx.f >= 0.5 ? fx : null;
  });
  window._trEdit = { id, unidade: lista.unidade, itens, fatores };
  window._trEditNovos = novos;
  // decoracao do nome com a embalagem, a partir do proprio catalogo ja buscado
  const catMapa = {};
  catalogo.forEach(x => {
    if (x.emb_fator) catMapa[x.item] = x.emb_nome + ' de ' + trEmbDesc(x)
      + (x.emb2_fator ? ' ou ' + x.emb2_nome + ' de ' + trEmbDesc({ un_medida: x.un_medida, emb_fator: x.emb2_fator }) : '');
  });
  alvo.innerHTML = `
    ${trEditSalvoHtml(id, lista.unidade, aviso)}
    <div class="caption-label"><button class="preset-btn" onclick="trListaAberta=${id}; trTelaSeparacao();">← lista</button>
      Editando a lista <b>#${id}</b> · ${lista.unidade} — corrija as quantidades (<b>0 tira o item</b>), preencha
      os que faltam na grade de baixo e <b>salve uma vez só</b>. Linha mexida ganha o selo ✏️.</div>
    <div id="tabelaTrEdit"><table>
      <tr><th>Item</th><th>Quanto</th></tr>
      ${itens.map((i, idx) => `<tr><td>${i.item}${i.qtd_auto != null ? ' <span class="tr-tag">🔁 automático — ajuste aqui se mudou o prato</span>' : (catMapa[i.item] ? ` <span class="tr-det">(${catMapa[i.item]})</span>` : '')}${i.avulso ? ' <span class="tr-tag">🆕</span>' : ''}${i.observacao ? ` <span class="tr-tag">${i.observacao}</span>` : ''}${i.editado ? ' <span class="tr-tag">✏️</span>' : ''}</td>
        <td style="white-space:normal; line-height:1.2;"><input type="number" min="0" step="${i._emb ? '0.5' : 'any'}" inputmode="decimal" id="tre_${idx}" class="trc-in"
          value="${i._emb ? trEmbConta(i.qtd_solicitada, i._emb.f) : Number(i.qtd_solicitada || 0)}" oninput="trEditConv(${idx})"
          style="width:80px; text-align:right;"><br>
          <b style="font-size:11.5px;">${i._emb ? trEmbPlural(String(i._emb.n).split(' (')[0], 2) : trUnNome(i.un_medida || '', 2)}</b>
          <span class="tr-conv" id="trec_${idx}" style="font-size:11px;">${i._emb ? '= ' + trNum(i.qtd_solicitada, 3) + ' ' + (i.un_medida || '').toLowerCase() : ''}</span></td></tr>`).join('')}
    </table></div>
    <div style="margin-top:12px;">
      <button class="preset-btn" onclick="trSalvarEdicao()">Salvar alterações</button>
      <span id="trEditMsg" class="tr-edit-msg" style="font-size:12px; margin-left:8px;"></span>
    </div>

    <div class="section-label tr-secao" style="margin-top:18px;">INCLUIR O QUE FALTOU</div>
    <input id="trEditBusca" type="search" class="trc-in" placeholder="buscar item... (o que você digitou continua guardado)" oninput="trEditFiltra()"
      style="width:100%; max-width:360px; margin:8px 0; border-radius:8px; padding:8px 10px;">
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:0 18px;">
      ${novos.map((i, idx) => `
        <label data-busca2="${i.item.toLowerCase()}" class="tr-linha" style="display:grid; grid-template-columns:1fr 76px; gap:2px 10px; align-items:center; font-size:12.5px; padding:5px 2px;">
          <span>${i.item} <span class="tr-det">(${trLinhaComoPede(i)})</span><br><span id="trne_${idx}" class="tr-conv" style="font-size:11px;"></span></span>
          <span style="justify-self:end; text-align:right; line-height:1.15;">
            <input type="number" min="0" step="${i.emb_fator ? '0.5' : 'any'}" inputmode="decimal" id="trn_${idx}" class="trc-in"
              oninput="trqTem(this); trEditHint(${idx})"
              style="width:72px; text-align:right;"><br>
            <span class="tr-det" style="font-size:10.5px;">${trLinhaUnidade(i)}</span>
          </span>
        </label>`).join('')}
    </div>
    <div class="section-label tr-secao" style="margin-top:16px;">FORA DA GRADE?</div>
    <div id="trAvulsos"></div>
    <button class="preset-btn" onclick="trAddAvulso()">+ item fora da grade</button>
    <div style="margin-top:14px;">
      <button class="preset-btn" onclick="trSalvarEdicao()">Salvar alterações</button>
      <span id="trEditMsg2" class="tr-edit-msg" style="font-size:12px; margin-left:8px;"></span>
    </div>`;
  trAvulsoN = 0;
  // acabou de salvar: a tela sobe ate o quadro "Alteracoes salvas"
  trSobeAte(document.getElementById('trEditSalvo'));
}
// A tela de corrigir tem DOIS botoes de salvar (em cima e no fim da grade): o
// aviso sai ao lado dos dois — quem toca no de baixo le a resposta ali mesmo.
function trEditAviso(html, cor) {
  document.querySelectorAll('.tr-edit-msg').forEach(el => { el.innerHTML = html; el.style.color = cor; });
}
// conversao ao vivo da linha corrigida: "= 4,5 kg" ao lado do campo em pacotes.
// Tambem marca a linha como MEXIDA: e o evento, e nao a comparacao de texto,
// que diz se a pessoa tocou no campo (campo que abre em "0" e recebe 0 para
// tirar o item tem o mesmo texto de antes).
function trEditConv(idx) {
  const i = (window._trEdit?.itens || [])[idx];
  const el = document.getElementById('trec_' + idx);
  const campo = document.getElementById('tre_' + idx);
  if (campo) { campo.dataset.mexido = '1'; campo.style.borderColor = ''; }
  if (!i || !el || !campo || !i._emb) return;
  const n = Number(campo.value || 0);
  el.textContent = n > 0 ? `= ${trNum(n * i._emb.f, 3)} ${(i.un_medida || '').toLowerCase()}` : (campo.value === '' ? '' : 'tira o item');
}
function trEditFiltra() {
  const q = (document.getElementById('trEditBusca')?.value || '').toLowerCase();
  document.querySelectorAll('label[data-busca2]').forEach(el => {
    el.style.display = !q || el.dataset.busca2.includes(q) ? 'grid' : 'none';
  });
}
function trEditHint(idx) {
  const i = (window._trEditNovos || [])[idx];
  const el = document.getElementById('trne_' + idx);
  if (!i || !el) return;
  const n = Number(document.getElementById('trn_' + idx)?.value || 0);
  if (n <= 0) { el.textContent = ''; return; }
  const partes = [];
  if (i.emb_fator) partes.push(`${trNum(n)} × ${trEmbDesc(i)} ≈ ${(n * i.emb_fator).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${(i.un_medida || 'un').toLowerCase()}`);
  if (i.preco_tabela != null && Number(i.preco_tabela) > 0) {
    const qtd = i.emb_fator ? n * i.emb_fator : n;
    partes.push(`R$ ${fmt(qtd * Number(i.preco_tabela))}`);
  }
  const pote = trPotesDe([{ i, q: n }])[i._acomp?.acomp_item];
  el.textContent = partes.join(' = ') + (pote ? ` · + ${pote.n} ${pote.nome.toLowerCase()}` : '');
}
// Anotacao da linha de pote: "pedido: N caixa(s)" (o que a filial pediu a mao)
// + "automático: ..." (o que veio da regra) + texto livre. pedido === undefined
// mantem o trecho atual; autoExtra soma ao trecho automatico.
function trObsPote(obs, pedido, autoExtra) {
  const partes = (obs || '').split(' · ').filter(Boolean);
  const ped = pedido === undefined ? partes.find(s => s.startsWith('pedido:')) : pedido;
  const autoAtual = partes.find(s => s.startsWith('automático:'));
  const auto = autoExtra ? (autoAtual ? autoAtual + ' + ' + autoExtra : 'automático: ' + autoExtra) : autoAtual;
  const outros = partes.filter(s => !s.startsWith('pedido:') && !s.startsWith('automático:'));
  return [ped, auto, ...outros].filter(Boolean).join(' · ') || null;
}
// Salvar a correcao, com o retorno do botao (08/10/2026): enquanto grava, os dois botoes
// ficam apagados dizendo "Salvando…" e o segundo toque nao grava de novo (o item incluido
// entraria duas vezes). Quem grava e trSalvarEdicaoGrava — a mesma de sempre.
let trEditSalvando = false;
async function trSalvarEdicao() {
  if (trEditSalvando) return;
  trEditSalvando = true;
  const botoes = (on) => document.querySelectorAll('button[onclick="trSalvarEdicao()"]').forEach(b => {
    b.disabled = on; b.textContent = on ? 'Salvando…' : 'Salvar alterações'; b.style.opacity = on ? '.6' : '';
  });
  botoes(true);
  try { await trSalvarEdicaoGrava(); }
  catch (e) {
    // o fetch nem voltou (antes a tela ficava em "Salvando..." para sempre)
    trEditAviso(`<b>A internet caiu no meio.</b> Parte das mudanças pode ter sido salva — veja como a lista ficou antes de salvar de novo:
      <button class="preset-btn" onclick="trEditarPedido(${window._trEdit ? Number(window._trEdit.id) : 0})">ver como ficou</button>`, 'var(--brand)');
  } finally {
    trEditSalvando = false;
    botoes(false);
  }
}
async function trSalvarEdicaoGrava() {
  // todo aviso desta funcao sai nos DOIS lugares (ao lado do botao de cima e do
  // de baixo): `msg` escreve em todos os .tr-edit-msg de uma vez
  const alvos = () => document.querySelectorAll('.tr-edit-msg');
  const msg = {
    set textContent(t) { alvos().forEach(e => { e.textContent = t; }); },
    set innerHTML(h) { alvos().forEach(e => { e.innerHTML = h; }); },
    style: { set color(c) { alvos().forEach(e => { e.style.color = c; }); } },
  };
  msg.textContent = 'Salvando...'; msg.style.color = '#8a897e';
  const { id, itens, fatores } = window._trEdit;
  // linha MEXIDA = a pessoa digitou no campo (marca posta pelo oninput, trEditConv)
  const mexido = (campo) => !!campo && campo.value !== '' && campo.dataset.mexido === '1';
  // 0. a trava, ANTES de gravar qualquer coisa: embalagem inteira ou pela metade,
  // tanto na linha corrigida (so se foi mexida — lista antiga com numero quebrado
  // nao trava quem nao tocou nela) quanto na grade dos que faltaram
  const erros = trLerGrade(window._trEditNovos, 'trn_').erros;
  let primeiroRuim = [...document.querySelectorAll('[id^="trn_"]')].find(el => el.style.borderColor);
  itens.forEach((i, idx) => {
    const campo = document.getElementById('tre_' + idx);
    if (!i._emb || !mexido(campo)) return;
    const n = Number(campo.value);
    if (n > 0 && !trEmbInteira(n)) {
      erros.push(`${i.item}: ${trNum(n)} ${trEmbPlural(i._emb.n, n)} — peça inteiro ou meio`);
      campo.style.borderColor = 'var(--farol-fora)';
      primeiroRuim = primeiroRuim && primeiroRuim.id.startsWith('tre_') ? primeiroRuim : campo;
    }
  });
  if (erros.length) {
    msg.innerHTML = '<b>Nada foi salvo.</b> Embalagem sai inteira ou pela metade (campo em vermelho):<br>' + erros.join('<br>');
    msg.style.color = '#ff6b6b';
    if (primeiroRuim) primeiroRuim.scrollIntoView({ block: 'center' });
    return;
  }
  // 1. o que mudou nos itens que ja estavam na lista. Item de embalagem unica:
  // o campo esta em embalagens — grava numero digitado x fator e anota o proprio
  // numero digitado (nada de dividir de volta).
  const gravado = {};  // id -> anotacao e parte automatica como ficaram no banco
  for (const [idx, i] of itens.entries()) {
    const campo = document.getElementById('tre_' + idx);
    if (!mexido(campo)) continue;   // linha nao mexida fica como esta
    const digitado = Number(campo.value);
    const v = i._emb ? Math.round(digitado * i._emb.f * 1000) / 1000 : digitado;
    if (Math.abs(v - Number(i.qtd_solicitada)) < 0.0005) continue;
    const corpo = { qtd_solicitada: v, editado: true };
    const fx = (fatores || {})[i.item];
    if (i._emb) corpo.observacao = `pedido: ${digitado} ${i._emb.n}(s)`;
    else if (i.qtd_auto != null) {
      // linha mista (caixa pedida a mao + pote automatico): so o trecho "pedido"
      // acompanha a quantidade nova; a parte automatica fica, limitada ao total
      const auto = Math.min(Number(i.qtd_auto), v);
      const manual = Math.round((v - auto) * 1000) / 1000;
      corpo.qtd_auto = auto;
      if (fx) corpo.observacao = trObsPote(i.observacao, manual > 0 ? `pedido: ${Math.round(manual / fx.f * 100) / 100} ${fx.n}(s)` : null);
    }
    const r = v <= 0
      ? await trFetch(`tr_lista_itens?id=eq.${i.id}`, { method: 'DELETE' })
      : await trFetch(`tr_lista_itens?id=eq.${i.id}`, { method: 'PATCH', body: JSON.stringify(corpo) });
    if (!r.ok) { msg.textContent = `Item ${i.item}: ` + await trErroDe(r); msg.style.color = '#ff6b6b'; return; }
    gravado[i.id] = { obs: 'observacao' in corpo ? corpo.observacao : i.observacao, auto: corpo.qtd_auto ?? i.qtd_auto };
  }
  // 2. os que faltaram, preenchidos na grade (duas embalagens somam na mesma linha)
  const porItem = {};
  const escolhidos = [];
  trLerGrade(window._trEditNovos, 'trn_').escolhidos.forEach(({ i: n, q }) => {
    escolhidos.push({ i: n, q });
    const qtd = n.emb_fator ? Math.round(q * n.emb_fator * 1000) / 1000 : q;
    const p = porItem[n.item] = porItem[n.item] || { item: n.item, un_medida: n.un_medida, qtd: 0, obs: [] };
    p.qtd = Math.round((p.qtd + qtd) * 1000) / 1000;
    if (n.emb_fator) p.obs.push(`${q} ${n.emb_nome}(s)`);
  });
  // pote automatico dos itens incluidos: soma na linha de pote que ja esta na
  // lista (quantidade como ficou depois do passo 1) ou nasce linha nova. O
  // ajuste da linha existente sai DEPOIS da inclusao dos itens (passo 3):
  // se a inclusao falhar, o pote nao fica somado sem o prato.
  const potesNaLista = [];
  for (const [pi, pt] of Object.entries(trPotesDe(escolhidos))) {
    const ja = itens.findIndex(x => x.item === pi);
    if (ja >= 0) {
      potesNaLista.push({ pi, pt, ja });
    } else {
      const cat = (window._trGradeEdit || []).find(x => x.item === pi);
      const p = porItem[pi] = porItem[pi] || { item: pi, un_medida: cat?.un_medida || 'UN', qtd: 0, obs: [] };
      p.qtd = Math.round((p.qtd + pt.n) * 1000) / 1000;
      p.auto = pt.n;
      p.autoObs = 'automático: ' + pt.partes.join(' + ');
    }
  }
  const avulsos = [];
  for (let k = 1; k <= trAvulsoN; k++) {
    const nEl = document.getElementById('trav_n_' + k);
    if (!nEl) continue;
    const nome = nEl.value.trim().toUpperCase();
    const q = Number(document.getElementById('trav_q_' + k)?.value || 0);
    if (nome && q > 0) avulsos.push({ item: nome, un_medida: document.getElementById('trav_u_' + k).value, qtd_solicitada: q });
  }
  const rows = Object.values(porItem).map(p => ({
    id_lista: id, item: p.item, un_medida: p.un_medida, qtd_solicitada: p.qtd,
    observacao: [p.obs.length ? 'pedido: ' + p.obs.join(' + ') : null, p.autoObs].filter(Boolean).join(' · ') || null,
    editado: true, qtd_auto: p.auto ?? null,
  })).concat(avulsos.map(a => ({ id_lista: id, item: a.item, un_medida: a.un_medida,
    qtd_solicitada: a.qtd_solicitada, observacao: null, editado: true, qtd_auto: null })));
  if (rows.length) {
    const r = await trFetch('tr_lista_itens', { method: 'POST', body: JSON.stringify(rows) });
    if (!r.ok) { msg.textContent = 'Itens novos falharam: ' + await trErroDe(r); msg.style.color = '#ff6b6b'; return; }
    // entrou: limpa o que foi incluido, para "salvar de novo" nunca duplicar o prato
    (window._trEditNovos || []).forEach((_, idx) => { const el = document.getElementById('trn_' + idx); if (el) el.value = ''; });
    for (let k = 1; k <= trAvulsoN; k++) { const el = document.getElementById('trav_n_' + k); if (el) el.value = ''; }
  }
  // 3. pote automatico somado na linha de pote que ja estava na lista
  for (const { pi, pt, ja } of potesNaLista) {
    const i = itens[ja];
    const g = gravado[i.id] || { obs: i.observacao, auto: i.qtd_auto };
    const campo = document.getElementById('tre_' + ja);
    // sempre na unidade de CONTROLE: o campo de uma linha de embalagem esta em
    // caixas (1 caixa de 26 potes + 10 potes automaticos = 36, nao 11)
    const base = campo && campo.value !== ''
      ? (i._emb ? Math.round(Number(campo.value) * i._emb.f * 1000) / 1000 : Number(campo.value))
      : Number(i.qtd_solicitada);
    const auto = pt.partes.join(' + ');
    // base 0 = a linha foi apagada no passo 1: o pote volta como linha nova
    const r = base <= 0
      ? await trFetch('tr_lista_itens', { method: 'POST', body: JSON.stringify([{ id_lista: id, item: pi,
          un_medida: i.un_medida, qtd_solicitada: pt.n, observacao: 'automático: ' + auto, editado: true, qtd_auto: pt.n }]) })
      : await trFetch(`tr_lista_itens?id=eq.${i.id}`, { method: 'PATCH', body: JSON.stringify({
          qtd_solicitada: Math.round((base + pt.n) * 1000) / 1000, qtd_auto: Number(g.auto || 0) + pt.n,
          observacao: trObsPote(g.obs, undefined, auto), editado: true }) });
    if (!r.ok) {
      msg.textContent = `Os itens novos entraram, mas o pote não somou (${await trErroDe(r)}). Some ${pt.n} na linha ${pi} acima e salve de novo.`;
      msg.style.color = '#ff6b6b'; return;
    }
  }
  msg.textContent = 'Alterações salvas — a separação já vê a lista corrigida.'; msg.style.color = '#3fb950';
  // a tela reabre na hora, com o quadro "Alteracoes salvas" no alto (antes: 12px ao lado do
  // botao, que sumia em 0,9 s quando a tela se redesenhava igual). mudou = quantas linhas
  // foram de fato gravadas; zero = a pessoa salvou sem mexer em nada, e o quadro diz isso.
  // Se so esta releitura falhar, fica o aviso de salvo ao lado dos botoes (tudo ja foi gravado).
  try { await trEditarPedido(id, { salvo: trDiaHoraTxt(), mudou: Object.keys(gravado).length + rows.length + potesNaLista.length }); } catch (e) { /* salvo; so nao deu para redesenhar */ }
}

// ---- tela: tabela de precos (so leitura) ----
// Dono, 01/10/2026: "cabe em uma pagina so, sem precisar rolar embaixo" e, para a
// filial, "uma tabela de preco que um cliente deve ver: o nome do item, como ele vem
// e o valor que esta pagando ... somente os itens dela".
// - A LISTA e a grade da filial (vw_tr_itens_pedido: o que esta ativo para ela em
//   tr_item_unidade) e o PRECO e o preco_tabela dessa view — a mesma coluna do Novo
//   pedido, o preco com que a linha do pedido nasce. Na cobranca vale o congelado
//   na lista; isto aqui e consulta.
// - Papel FILIAL (cliente da central): item, como vem e preco. Sem custo, sem
//   percentual, sem reajustes — a tela dela nem pede essas colunas ao banco. Login
//   sem valores: so item e como vem.
// - Quem e da casa (dono, compras, financeiro): o mesmo, mais a coluna Custo (lida de
//   vw_tr_tabela_precos), o seletor de filial e, no Boqueirao, o quadro da tabela do
//   mes e os reajustes.
// - Item sem cobranca sai da tabela e vai para um bloco curto no fim.
// Titulo das secoes = a classe do cadastro (tr_itens.classe) escrita por extenso. A
// ordem desta lista e a ordem na tela; classe nova entra no fim, com o nome do cadastro.
const TR_PRECOS_SECOES = [
  ['CARNE', 'Carnes'], ['CARNES DEFUMADAS', 'Carnes defumadas'], ['PREP PRODUCAO', 'Preparos da produção'],
  ['PREP PRATOS', 'Preparos de pratos'], ['PREP LANCHES', 'Preparos de lanches'], ['CONGELADOS', 'Congelados'],
  ['LATICINEOS', 'Laticínios'], ['SOBREMESAS', 'Sobremesas'], ['PAES', 'Pães'], ['HORTIFRUTI', 'Hortifrúti'],
  ['SECOS', 'Secos'], ['BEBIDAS', 'Bebidas'], ['EMBALAGENS', 'Embalagens'], ['DESCARTAVEIS', 'Descartáveis'],
  ['MATERIAL DE LIMPEZA', 'Material de limpeza'], ['UTENSILIOS', 'Utensílios'], ['ESCRITORIO', 'Escritório'],
  ['FUNCIONARIOS', 'Funcionários'],
];
// Como o item vem, em frase inteira, para quem le a tabela como cliente: "pacote de
// 450 g", "caixa com 26 unidades", "garrafa de 5 litros", "pacote com 20 de 130 g
// (2,6 kg)", "por unidade (150 g cada)". Sem sigla (un, rl, lt), sem repetir a medida
// ("pacote 300 g de 300 g") e, sem embalagem no cadastro, "por quilo" / "por unidade"
// — nunca um traco. Le so o que a grade diz (emb_nome/emb_fator): nao inventa embalagem.
function trComoVem(i) {
  const un = (i.un_medida || 'un').toLowerCase();
  const medida = (f) => un === 'kg' ? trEmbDesc({ un_medida: 'KG', emb_fator: f }) : `${trNum(f, 3)} ${trUnNome(un, f)}`;
  const uma = (nome, f) => {
    const m = /^(.*?)\s*\((\d+)x(\d+) g\)$/.exec(nome);                       // "pacote (20x130 g)"
    if (m) return `${m[1]} com ${m[2]} de ${m[3]} g (${medida(f)})`;
    if (nome === 'unidade') return `por unidade (${medida(f)} cada)`;
    if (/\d/.test(nome)) return String(nome).replace(/ (\d+ g)$/, ' de $1');     // "pacote 300 g" -> "pacote de 300 g"
    return `${nome} ${un === 'kg' || un === 'lt' ? 'de' : 'com'} ${medida(f)}`;
  };
  if (!i.emb_fator) return un === 'kg' ? 'por quilo' : 'por ' + trUnNome(un, 1);
  let t = uma(i.emb_nome, i.emb_fator) + (i.emb2_fator ? ' ou ' + uma(i.emb2_nome, i.emb2_fator) : '');
  // item pesado na separacao (hoje so o T-bone): o peso do pacote e aproximado
  if (i.peso_variavel) t = t.replace(' de ', ' de cerca de ') + ' · pesado na separação';
  return t;
}
// Preco em reais, sempre em pt-BR. Abaixo de R$ 1 mostra 4 casas: o centavo
// quebrado pesa (lacre a R$ 0,0589 — o rolo de 250 sai R$ 14,73, nao 250 x R$ 0,06).
function trPrecoRs(v) {
  const n = Number(v);
  // espaco que nao quebra: em celula estreita o "R$" nao se separa do numero
  return 'R$\u00a0' + (Math.abs(n) < 1 && Math.abs(n) >= 0.00005
    ? n.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : fmt(n));
}
// a unidade junto do preco: "R$ 12,51/kg", "R$ 4,04 a unidade", "R$ 4,84 o rolo"
function trPrecoPor(un) {
  const u = String(un || 'un').toLowerCase();
  return { kg: '/kg', un: ' a unidade', rl: ' o rolo', lt: ' o litro', cx: ' a caixa' }[u] || '/' + u;
}
// "R$ 5,63 o pacote": o preco da embalagem inteira — a mesma conta do Novo pedido
// (preco de tabela x o que vem na embalagem)
function trPrecoEmb(preco, nome, fator, aprox) {
  const curto = String(nome).split(' (')[0].replace(/\s+\d.*$/, '');
  return `${aprox ? 'cerca de ' : ''}${trPrecoRs(Number(preco) * Number(fator))} ${/(a|ade|ção)$/.test(curto.split(' ')[0]) ? 'a' : 'o'} ${curto}`;
}
// a frase do alto para a filial com tabela mensal: de que mes e, ate quando vale
function trTabelaFraseCliente(sit) {
  const mes = trMesNome(sit.mes), prox = trMesNome(sit.proximo_mes), fim = trTabelaValeAte(sit);
  const n = Number(sit.reajustados || 0);
  if (!sit.tem_tabela) return `<b>Tabela de ${mes}</b> · abre no primeiro pedido do mês e vale até <b>${fim}</b>. Até lá, os preços abaixo são os de hoje.`;
  return `<b>Tabela de ${mes}</b> · vale para todos os pedidos até <b>${fim}</b>.`
    + (n ? ` ${n === 1 ? '1 item mudou' : n + ' itens mudaram'} neste mês (marcado na lista).` : '')
    + (sit.proximo_tem_tabela ? ` A tabela de ${prox} já está fechada e entra no dia 1º.` : '');
}
async function trTelaPrecos(unidadeEscolhida) {
  const alvo = document.getElementById('trTelaConteudo');
  let unidade = TR_OP.unidade || unidadeEscolhida || trFilialVista() || window._trPrecosUnidade;
  if (!unidade) unidade = 'AHU';
  window._trPrecosUnidade = unidade;
  // quem e da casa pode abrir a tabela do jeito que a filial ve (botao "ver como a filial vê")
  const previa = TR_OP.papel !== 'FILIAL' && !TR_OP.unidade && !!window._trPrecosComoFilial;
  const cliente = TR_OP.papel === 'FILIAL' || previa;
  const comValor = TR_OP.veValores !== false;
  const daCasa = !cliente && comValor;   // pede o custo ao banco
  // 01/10/2026 (dono): o Boqueirao tem TABELA MENSAL — o preco congela por mes; Ahu e
  // Sao Braz seguem pelo custo do dia. Quem diz e o banco (vw_tr_tabela_mes_situacao).
  const sit = await trTabelaSituacao(unidade);
  const mensal = !!(sit && sit.tabela_mensal);
  window._trTabelaSit = sit;
  const filial = `unidade=eq.${encodeURIComponent(unidade)}`;
  // o que so vw_tr_tabela_precos tem: o custo (so para quem e da casa) e as marcas da
  // tabela do mes. Se essa leitura falhar, a tabela abre do mesmo jeito, sem elas.
  const extras = [daCasa ? 'cmv,pct_producao' : '', mensal ? 'tabela_mes,tabela_reajuste' : ''].filter(Boolean).join(',');
  const [r, rx, rp] = await Promise.all([
    trFetch(`vw_tr_itens_pedido?${filial}&order=item&select=item,classe,un_medida,emb_nome,emb_fator,emb2_nome,emb2_fator,nao_cobrado,origem,preco_tabela,peso_variavel`),
    extras ? trFetch(`vw_tr_tabela_precos?${filial}&select=item,${extras}`).catch(() => null) : null,
    cliente ? trFetch(`vw_tr_itens_filial_pega?${filial}&select=item`).catch(() => null) : null,
  ]);
  // a tela pode ter trocado de filial enquanto a resposta vinha
  if (window._trPrecosUnidade !== unidade || window._trTabelaSit !== sit) return;
  if (!r.ok) { alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">${await trErroDe(r)}</div>`; return; }
  const extra = {}, temExtra = !!(rx && rx.ok);
  if (temExtra) (await rx.json()).forEach(x => { extra[x.item] = x; });
  const comCusto = daCasa && temExtra;   // a coluna Custo so existe se o custo chegou
  // "somente os itens dela" (dono, 01/10/2026): a filial ve o que pediu nos ultimos 12
  // meses (vw_tr_itens_filial_pega, que casa tambem o nome antigo do item). Sem essa
  // resposta, ou com ela vazia (filial sem historico), a tabela mostra a grade inteira.
  let pega = null;
  if (rp && rp.ok) { const nomes = (await rp.json()).map(x => x.item); if (nomes.length) pega = new Set(nomes); }
  const grade = (await r.json()).map(i => ({ ...(extra[i.item] || {}), ...i }));
  const itens = pega ? grade.filter(i => pega.has(i.item)) : grade;
  const cobrados = itens.filter(i => !i.nao_cobrado), semCob = itens.filter(i => i.nao_cobrado);
  const un = (i) => (i.un_medida || 'un').toLowerCase();
  const titulo = Object.fromEntries(TR_PRECOS_SECOES), ordem = TR_PRECOS_SECOES.map(s => s[0]);
  const lugar = (c) => ordem.indexOf(c) < 0 ? 999 : ordem.indexOf(c);
  const classes = [...new Set(cobrados.map(i => i.classe || 'OUTROS'))].sort((a, b) => lugar(a) - lugar(b) || a.localeCompare(b));
  const custoTxt = (i) => Number(i.cmv) > 0 ? trPrecoRs(i.cmv) + trPrecoPor(un(i)) : '<span class="tr-tag">sem custo</span>';
  const precoTxt = (i) => !(Number(i.preco_tabela) > 0) ? '<span class="tr-tag">sem preço</span>'
    : `<b>${trPrecoRs(i.preco_tabela)}</b>${trPrecoPor(un(i))}`
      + (i.emb_fator ? `<div class="tr-det">${trPrecoEmb(i.preco_tabela, i.emb_nome, i.emb_fator, i.peso_variavel)}</div>` : '')
      + (i.emb2_fator ? `<div class="tr-det">${trPrecoEmb(i.preco_tabela, i.emb2_nome, i.emb2_fator, i.peso_variavel)}</div>` : '');
  const colunas = 2 + (comCusto ? 1 : 0) + (comValor ? 1 : 0);
  const linha = (i, c) => {
    const vem = trComoVem(i);
    return `<tr data-sec="${c}" data-busca="${(i.item + ' ' + (titulo[c] || c) + ' ' + c).toLowerCase()}">
        <td>${i.item}${i.origem === 'FORNECEDOR' ? ' <span class="tr-det">· fornecedor</span>' : ''}${temExtra ? trTabelaMarca(i, sit) : ''}
          <div class="trp-m tr-det">${vem}</div>${comCusto ? `<div class="trp-mc tr-det">custo ${custoTxt(i)}</div>` : ''}</td>
        <td class="trp-d">${vem}</td>${comCusto ? `<td class="trp-c">${custoTxt(i)}</td>` : ''}${comValor ? `<td>${precoTxt(i)}</td>` : ''}
      </tr>`;
  };
  const pct = comCusto ? itens.find(i => i.pct_producao != null)?.pct_producao : null;
  const seletor = trFilialVista() ? '' : ['AHU', 'BOQUEIRAO', 'SÃO BRAZ'].map(u =>
    `<button class="preset-btn ${u === unidade ? 'active' : ''}" onclick="trTelaPrecos('${u}')">${u}</button>`).join(' ');
  // A data que a tela antiga mostrava ("CMV da Formacao de precos de dd/mm") saiu: era a
  // data da carga da planilha (ft_insumos.importado_em), nao a do custo, que hoje vem da
  // ultima nota — em 01/10 dizia 24/08 para 115 dos 116 itens.
  // o alto da tela: quem e da casa le a conta do preco; a filial le so de quando e a tabela
  const frase = !comValor ? 'O que a sua loja pede da central e como cada item vem.'
    : !sit ? '' : mensal ? trTabelaFraseCliente(sit) : 'Vale o preço do dia em que o pedido é feito.';
  const alto = cliente
    ? (previa ? `<div class="caption-label">Assim <b>${unidade}</b> vê a tabela.
        <button class="preset-btn" onclick="window._trPrecosComoFilial = false; trTelaPrecos()">voltar para a minha</button> ${seletor}</div>` : '')
      + (frase ? `<div class="contexto" style="margin:8px 0; text-align:left;">${frase}</div>` : '')
    : `<div class="caption-label">Preço de <b>${unidade}</b>${pct != null ? ` = custo + <b>${Math.round(Number(pct) * 100)}%</b> de custo de produção` : ''}.
      ${mensal ? 'Na cobrança vale o preço desta tabela, pelo mês em que o pedido foi feito.' : 'Na cobrança vale o preço congelado no ato do pedido.'} ${seletor}
      ${daCasa ? `<button class="preset-btn" onclick="window._trPrecosComoFilial = true; trTelaPrecos()">ver como a filial vê</button>` : ''}</div>
    ${mensal ? trTabelaCabecalho(sit) : ''}
    ${mensal && TR_OP.papel === 'DONO' ? '<div id="trTabelaReajustes" class="trp-r"></div>' : ''}`;
  alvo.innerHTML = `
    ${alto}
    <input id="trPrecosBusca" type="search" class="trc-in" placeholder="buscar item..." oninput="trPrecosFiltra()"
      style="width:100%; max-width:340px; margin:8px 0; border-radius:8px; padding:8px 10px;">
    <span class="tr-det" style="font-size:12.5px; margin-left:6px;">${cobrados.length} ${cobrados.length === 1 ? 'item' : 'itens'}${comValor && semCob.length ? ` com preço · ${semCob.length} sem cobrança, no fim` : ''}</span>
    <div class="trp">
    <div id="trPrecosVazio" class="contexto" style="text-align:left;" hidden>Nenhum item com esse nome.</div>
    ${cobrados.length ? `<div id="tabelaTrPrecos"><table>
      <tr><th>Item</th><th class="trp-d">Como vem</th>${comCusto ? '<th class="trp-c">Custo</th>' : ''}${comValor ? '<th>Preço</th>' : ''}</tr>
      ${classes.map(c => { const grupo = cobrados.filter(i => (i.classe || 'OUTROS') === c); return `
      <tr data-titulo="${c}"><th colspan="${colunas}">${titulo[c] || c} <span style="font-weight:400;">· ${grupo.length}</span></th></tr>
      ${grupo.map(i => linha(i, c)).join('')}`; }).join('')}
    </table></div>` : `<div class="contexto">Nenhum item com preço na grade de ${unidade}.</div>`}
    ${semCob.length ? `<div id="trPrecosSemCob" class="contexto" style="margin:12px 0 0; text-align:left;">
      <b>Vão na lista sem cobrança</b> <span class="tr-det">· ${semCob.length}</span><br>
      ${semCob.map(i => `<span data-busca="${i.item.toLowerCase()}" style="display:inline-block; margin:2px 14px 2px 0; font-size:12.5px;">${i.item}${i.emb_fator ? ` <span class="tr-det">(${trComoVem(i)})</span>` : ''}</span>`).join('')}
    </div>` : ''}
    ${cliente && pega ? `<div class="tr-det" style="margin:12px 0 0; font-size:12.5px;">Aqui estão os itens que ${previa ? 'a loja' : 'a sua loja'} pediu nos últimos 12 meses. Qualquer outro item da central pode ser pedido em Novo pedido — e passa a aparecer aqui.</div>` : ''}
    </div>`;
  if (mensal && TR_OP.papel === 'DONO' && !previa) trTabelaReajustes(unidade);
}

// ---- TABELA MENSAL (dono, 01/10/2026) ----
// So o Boqueirao: o preco congela no dia 1 e vale o mes inteiro; no meio do mes um
// item so muda se o custo variar mais de 15% E o dono aplicar. Ahu e Sao Braz seguem
// pelo custo do dia. A regra mora no banco (tr_tabela_mensal_regra, tr_tabela_mes,
// gatilho tr_item_nascimento); a tela so conta o que ele responde. O que roda
// sozinho: a linha nasce pelo preco da tabela, e mes sem tabela abre no primeiro
// pedido. O que e botao: fechar a tabela do mes e aplicar o reajuste de um item —
// so para quem o banco diz que aprova (sit.pode_aprovar); os outros logins de dono
// veem a previa, sem botao.
const TR_MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function trMesNome(d) { return d ? TR_MESES[Number(String(d).slice(5, 7)) - 1] : ''; }
function trDiaMes(d) { return d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : ''; }
// Ate que dia a tabela do mes corrente vale (o ultimo dia do mes) — a data vem do banco,
// nada de calcular aqui. Dono, 01/10/2026: a tabela do mes seguinte fecha a partir do
// dia 25, entao fecha_proximo_a_partir_de deixou de ser o ultimo dia do mes e o banco
// ganhou a coluna ultimo_dia_mes. O "||" so cobre o banco ainda sem a coluna nova (la
// fecha_proximo_a_partir_de ainda e o ultimo dia).
function trTabelaValeAte(sit) { return trDiaMes(sit.ultimo_dia_mes || sit.fecha_proximo_a_partir_de); }
// uma linha por filial: tem tabela mensal? a do mes existe? quando fechou?
// Qualquer falha (view ainda nao criada, sem rede) devolve null = "como antes".
async function trTabelaSituacao(unidade) {
  try {
    const r = await trFetch(`vw_tr_tabela_mes_situacao?unidade=eq.${encodeURIComponent(unidade)}`);
    if (!r.ok) return null;
    return (await r.json())[0] || null;
  } catch (e) { return null; }
}
// a frase do topo do Novo pedido: de onde vem o preco deste pedido
function trTabelaFrasePedido(sit, dataCusto) {
  if (!sit || !sit.tabela_mensal) {
    // a planilha Formacao de precos deixou de ser fonte em 07/10/2026 (dono): o custo vem da
    // ultima nota e da ficha. A data que aparecia aqui era a da carga da planilha (24/08).
    return 'Vale o preço do dia em que o pedido é feito.';
  }
  const mes = trMesNome(sit.mes), fim = trTabelaValeAte(sit);
  if (!sit.tem_tabela) return `A tabela de ${mes} abre com o primeiro pedido do mês: o preço de hoje fica valendo até ${fim}.`;
  return `O preço é o da <b>tabela de ${mes}</b> (${sit.como === 'FECHADA' ? 'fechada' : 'aberta'} em ${trDiaMes(sit.fechada_em)}) — o mesmo em todos os pedidos até ${fim}.`;
}
// o aviso no alto da Tabela de precos: que tabela e esta, quando fechou, quando muda
function trTabelaCabecalho(sit) {
  const mes = trMesNome(sit.mes), prox = trMesNome(sit.proximo_mes), fim = trTabelaValeAte(sit);
  const pct = Math.round(Number(sit.gatilho_pct || 0.15) * 100);
  const n = Number(sit.reajustados || 0);
  let txt;
  if (!sit.tem_tabela) {
    txt = `<b>A tabela de ${mes} ainda não foi fechada.</b> Ela abre sozinha no primeiro pedido do mês, com o custo desse dia, e daí vale até ${fim}. Até lá, os preços abaixo são os de hoje.`;
  } else {
    txt = `<b>Tabela de ${mes}</b> — ${sit.como === 'FECHADA'
        ? `fechada em <b>${trDiaMes(sit.fechada_em)}</b>${sit.fechada_por ? ' por ' + sit.fechada_por : ''}`
        : `abriu sozinha em <b>${trDiaMes(sit.fechada_em)}</b>, no primeiro pedido do mês, com o custo daquele dia`}.
      Os preços abaixo valem para todos os pedidos até <b>${fim}</b> e só mudam em <b>1º de ${prox}</b>.
      No meio do mês, um item só muda se o custo dele variar mais de ${pct}% e o dono aprovar${n ? ` — neste mês ${n === 1 ? '1 item mudou' : n + ' itens mudaram'} (marcado na lista)` : ''}.`;
  }
  if (sit.proximo_tem_tabela) txt += ` A tabela de ${prox} já está fechada (em ${trDiaMes(sit.proximo_fechada_em)}) e entra no dia 1º.`;
  return `<div class="contexto" style="margin:8px 0; text-align:left;">${txt}</div>`;
}
// selo ao lado do nome: item que mudou no meio do mes, ou que ainda nao esta na tabela
function trTabelaMarca(i, sit) {
  if (!sit || !sit.tabela_mensal || i.nao_cobrado) return '';
  if (i.tabela_reajuste) return ` <span class="tr-tag">mudou em ${trDiaMes(i.tabela_reajuste)}</span>`;
  if (sit.tem_tabela && !i.tabela_mes) return ' <span class="tr-tag">entra na tabela no primeiro pedido</span>';
  return '';
}
// Bloco do DONO: o que mudou mais que o gatilho neste mes (com botao de aplicar) e a
// previa do mes que vem (com botao de fechar, que so abre na data de corte que o banco
// devolve em fecha_proximo_a_partir_de — dia 25 desde 01/10/2026; antes, o ultimo dia).
// Efeito em R$ = diferenca de preco x o que a filial recebeu nos ultimos 30 dias.
async function trTabelaReajustes(unidade) {
  const sit = window._trTabelaSit;
  if (!sit || !document.getElementById('trTabelaReajustes')) return;
  const r = await trFetch(`vw_tr_tabela_previa?unidade=eq.${encodeURIComponent(unidade)}&order=item`);
  // a tela pode ter trocado de filial enquanto a resposta vinha
  const alvo = document.getElementById('trTabelaReajustes');
  if (!alvo || window._trPrecosUnidade !== unidade || window._trTabelaSit !== sit) return;
  if (!r.ok) { alvo.innerHTML = `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui abrir os reajustes: ${await trErroDe(r)}</div>`; return; }
  const itens = await r.json();
  window._trReajItens = itens;
  // fim = ate quando a tabela deste mes vale; corte = desde quando da para fechar a do mes que vem
  const mes = trMesNome(sit.mes), prox = trMesNome(sit.proximo_mes), fim = trTabelaValeAte(sit), corte = trDiaMes(sit.fecha_proximo_a_partir_de);
  const pct = Math.round(Number(sit.gatilho_pct || 0.15) * 100);
  const pode = !!sit.pode_aprovar, quem = sit.quem_aprova || 'o dono';
  const un = (i) => (i.un || 'un').toLowerCase();
  const preco = (v, i) => v == null ? '—' : `R$ ${fmt(Number(v))}${un(i) === 'un' ? '' : '/' + un(i)}`;
  const mudou = (p) => p == null ? '—'
    : Number(p) > 0 ? `<span class="tr-tag" style="font-size:inherit; font-weight:600;">subiu ${trNum(p, 1)}%</span>`
    : Number(p) < 0 ? `<span class="tr-conv">caiu ${trNum(Math.abs(p), 1)}%</span>` : 'igual';
  const reais = (v) => `${Number(v) > 0.004 ? '+' : Number(v) < -0.004 ? '−' : ''}R$ ${fmt(Math.abs(Number(v)))}`;
  const efeito = (v, i) => !Number(i.qtd_30d) ? '<span class="tr-det">não recebeu em 30 dias</span>'
    : `${reais(v)} <span class="tr-det">(recebeu ${trNum(i.qtd_30d, 1)} ${un(i)})</span>`;

  // 1. excecoes do mes corrente
  const exc = itens.filter(i => i.passa_gatilho);
  const blocoExc = !sit.tem_tabela ? '' : `
    <div class="contexto" style="margin:8px 0; text-align:left;">
      <b>Itens que mudaram mais de ${pct}% contra a tabela de ${mes}</b>
      ${exc.length ? `<div class="tr-det" style="margin:2px 0 6px;">${pode ? 'Só entram na tabela se você aplicar.' : `Só entram na tabela se ${quem} aplicar.`} O que já foi pedido não muda — vale para os próximos pedidos.</div>
      <div id="tabelaTrReajExc"><table>
        <tr><th>Item</th><th>Na tabela</th><th>Pelo custo de hoje</th><th>Mudou</th><th title="Diferença de preço × o que a filial recebeu nos últimos 30 dias.">Em 30 dias</th>${pode ? '<th></th>' : ''}</tr>
        ${exc.map(i => `<tr><td>${i.item}</td><td>${preco(i.preco_tabela, i)}</td><td>${preco(i.preco_vivo, i)}</td><td>${mudou(i.variacao_pct)}</td><td>${efeito(i.efeito_30d, i)}</td>
          ${pode ? `<td><button class="preset-btn" onclick="trTabelaAplicarExcecao(${itens.indexOf(i)})">aplicar na tabela</button></td>` : ''}</tr>`).join('')}
      </table></div>` : `<div class="tr-det">Nenhum item — a tabela de ${mes} segue sem reajuste.</div>`}
      <div id="trReajMsgExc" style="font-size:12.5px; font-weight:700; margin-top:6px;"></div>
    </div>`;

  // 2. previa do mes que vem
  const comp = itens.filter(i => i.custo_tabela != null && !i.unidade_mudou);
  const mudam = comp.filter(i => Number(i.variacao_proximo_pct) !== 0)
    .sort((a, b) => Math.abs(Number(b.efeito_proximo_30d)) - Math.abs(Number(a.efeito_proximo_30d)) || Math.abs(Number(b.variacao_proximo_pct)) - Math.abs(Number(a.variacao_proximo_pct)));
  const sobem = mudam.filter(i => Number(i.variacao_proximo_pct) > 0).length, caem = mudam.length - sobem;
  const total = mudam.reduce((s, i) => s + Number(i.efeito_proximo_30d || 0), 0);
  const plural = (n, um, mais) => `${n} ${n === 1 ? um : mais}`;
  const sozinha = `Se ninguém fechar, ela abre sozinha no primeiro pedido de ${prox}, com o custo daquele dia.`;
  let botao;
  if (!sit.tem_tabela) {
    botao = pode ? `<button class="preset-btn tr-btn-cheio" onclick="trTabelaFechar('${sit.mes}')">Fechar a tabela de ${mes} agora</button>
      <span class="tr-det">Fecha com os custos de hoje e vale até ${fim}. Se ninguém fechar, ela abre sozinha no primeiro pedido.</span>`
      : `<span class="tr-det">Quem fecha é ${quem}. Se ninguém fechar, ela abre sozinha no primeiro pedido, com o custo desse dia.</span>`;
  } else if (sit.proximo_tem_tabela) {
    botao = `<span class="tr-det">A tabela de ${prox} já está fechada (em ${trDiaMes(sit.proximo_fechada_em)}) — entra no dia 1º.</span>`;
  } else if (!pode) {
    botao = `<span class="tr-det">Quem fecha a tabela de ${prox} é ${quem}, a partir de ${corte}. ${sozinha}</span>`;
  } else if (sit.pode_fechar_proximo) {
    botao = `<button class="preset-btn tr-btn-cheio" onclick="trTabelaFechar('${sit.proximo_mes}')">Fechar a tabela de ${prox}</button>
      <span class="tr-det">Fecha com os custos de hoje e vale ${prox} inteiro, a partir do dia 1º. Até ${fim} segue a tabela de ${mes}.</span>`;
  } else {
    botao = `<button class="preset-btn" disabled style="opacity:.5; cursor:not-allowed;">Fechar a tabela de ${prox}</button>
      <span class="tr-det">Dá para fechar a partir de ${corte}. ${sozinha}</span>`;
  }
  const blocoPrev = !sit.tem_tabela ? `
    <div class="contexto" style="margin:8px 0; text-align:left;"><b>A tabela de ${mes} ainda não existe</b> — não há preço fechado para comparar.
      <div style="margin-top:8px;">${botao}</div>
      <div id="trReajMsg" style="font-size:12.5px; font-weight:700; margin-top:6px;"></div></div>` : `
    <div class="contexto" style="margin:8px 0; text-align:left;">
      <b>Prévia da tabela de ${prox}</b> — ${sit.proximo_tem_tabela ? 'o que muda no dia 1º' : 'se ela fechasse hoje'}:
      ${mudam.length ? `${plural(sobem, 'item sobe', 'itens sobem')}, ${plural(caem, 'cai', 'caem')} e ${plural(comp.length - mudam.length, 'fica igual', 'ficam iguais')}.
        Pelo que a filial recebeu nos últimos 30 dias, a conta do mês ${total > 0.005 ? 'sobe' : total < -0.005 ? 'cai' : 'não muda'}${Math.abs(total) > 0.005 ? ' <b>R$ ' + fmt(Math.abs(total)) + '</b>' : ''}.
      <details style="margin-top:6px;"${mudam.length <= 8 ? ' open' : ''}><summary class="tr-det" style="cursor:pointer;">ver ${plural(mudam.length, 'item que muda', 'itens que mudam')}</summary>
      <div id="tabelaTrReajPrev" style="margin-top:6px;"><table>
        <tr><th>Item</th><th>Em ${mes}</th><th>Em ${prox}</th><th>Mudou</th><th title="Diferença de preço × o que a filial recebeu nos últimos 30 dias.">Em 30 dias</th></tr>
        ${mudam.map(i => `<tr><td>${i.item}</td><td>${preco(i.preco_tabela, i)}</td><td>${preco(i.preco_proximo, i)}</td><td>${mudou(i.variacao_proximo_pct)}</td><td>${efeito(i.efeito_proximo_30d, i)}</td></tr>`).join('')}
      </table></div></details>` : `nenhum preço muda (${plural(comp.length, 'item', 'itens')} na tabela).`}
      <div style="margin-top:8px;">${botao}</div>
      <div id="trReajMsg" style="font-size:12.5px; font-weight:700; margin-top:6px;"></div>
    </div>`;
  alvo.innerHTML = `
    <div class="section-label tr-secao" style="margin-top:14px;">REAJUSTES</div>
    ${blocoExc}${blocoPrev}`;
}
// aplica o reajuste de UM item no mes corrente (o banco confere de novo: so quem
// aprova, e so acima do gatilho)
async function trTabelaAplicarExcecao(idx) {
  const i = (window._trReajItens || [])[idx], sit = window._trTabelaSit;
  const msg = document.getElementById('trReajMsgExc');
  if (!i || !sit) return;
  const un = (i.un || 'un').toLowerCase();
  if (!confirm(`Mudar ${i.item} na tabela de ${trMesNome(sit.mes)} de ${i.unidade}?\n\n`
      + `De R$ ${fmt(Number(i.preco_tabela))} para R$ ${fmt(Number(i.preco_vivo))} por ${un === 'un' ? 'unidade' : un} `
      + `(${Number(i.variacao_pct) > 0 ? 'subiu' : 'caiu'} ${trNum(Math.abs(i.variacao_pct), 1)}%).\n\n`
      + 'Vale para os próximos pedidos. O que já foi pedido não muda.')) return;
  avisoAcao('enviando', `Mudando ${i.item} na tabela…`);
  const r = await trRpcSeguro('tr_reajustar_item_tabela', { p_unidade: i.unidade, p_item: i.item });
  if (!r.ok) return avisoAcao('erro', `✗ ${i.item} NÃO mudou na tabela: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `✓ ${i.item}: R$ ${fmt(Number(i.preco_vivo))} na tabela de ${trMesNome(sit.mes)} de ${i.unidade} — às ${avisoHora()}.`);
  trTelaPrecos(i.unidade);
}
// fecha a tabela de um mes com os custos de hoje (o banco confere: so quem aprova, e
// o mes seguinte so a partir da data de corte da regra — dia 25)
async function trTabelaFechar(mes) {
  const sit = window._trTabelaSit;
  const msg = document.getElementById('trReajMsg');
  if (!sit) return;
  // fechando a do mes que vem antes de o mes acabar: avisa que nota que chegar depois nao entra
  if (!confirm(`Fechar a tabela de ${trMesNome(mes)} de ${sit.unidade} com os custos de hoje?\n\n`
      + (mes === sit.proximo_mes
        ? 'Ela entra no dia 1º, vale o mês inteiro e não dá para refazer. Nota que chegar depois de hoje só muda o preço pelo reajuste de um item que mudar muito.'
        : 'Ela vale o mês inteiro e não dá para refazer — depois, só o reajuste de um item que mudar muito.'))) return;
  avisoAcao('enviando', `Fechando a tabela de ${trMesNome(mes)}…`);
  const r = await trRpcSeguro('tr_fechar_tabela_mes', { p_unidade: sit.unidade, p_mes: mes });
  if (!r.ok) return avisoAcao('erro', `✗ A tabela de ${trMesNome(mes)} NÃO fechou: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `✓ Tabela de ${trMesNome(mes)} de ${sit.unidade} fechada — às ${avisoHora()}.`);
  trTelaPrecos(sit.unidade);
}
function trPrecosFiltra() {
  // sem acento dos dois lados: os nomes da base nao tem acento ("PAO", "FEIJAO",
  // "MACARICO") e quem busca digita "pão", "feijão", "maçarico"
  const sem = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = sem(document.getElementById('trPrecosBusca')?.value).trim();
  const comLinha = {};
  let achou = 0;
  document.querySelectorAll('#tabelaTrPrecos tr[data-busca]').forEach(tr => {
    const ok = !q || sem(tr.dataset.busca).includes(q);
    tr.style.display = ok ? '' : 'none';
    if (ok) { comLinha[tr.dataset.sec] = true; achou++; }
  });
  // secao sem nenhuma linha a mostrar esconde o titulo junto
  document.querySelectorAll('#tabelaTrPrecos tr[data-titulo]').forEach(tr => {
    tr.style.display = comLinha[tr.dataset.titulo] ? '' : 'none';
  });
  // o bloco dos itens sem cobranca tambem responde a busca
  let sobra = 0;
  document.querySelectorAll('#trPrecosSemCob [data-busca]').forEach(el => {
    const ok = !q || sem(el.dataset.busca).includes(q);
    el.style.display = ok ? 'inline-block' : 'none';
    if (ok) sobra++;
  });
  const bloco = document.getElementById('trPrecosSemCob');
  if (bloco) bloco.style.display = sobra ? '' : 'none';
  // busca que nao acha nada diz isso, em vez de deixar a tela em branco
  const tabela = document.getElementById('tabelaTrPrecos'), vazio = document.getElementById('trPrecosVazio');
  if (tabela) tabela.style.display = achou || !q ? '' : 'none';
  if (vazio) vazio.hidden = !q || achou + sobra > 0;
}

// ---- tela: fila de separacao (SEPARACAO/DONO) ----
async function trTelaSeparacao() {
  const alvo = document.getElementById('trTelaConteudo');
  if (trListaAberta) return trAbrirSeparacao(trListaAberta);
  // junto com a fila, o alerta de peso (01/10/2026): se a view nao responder, a
  // fila abre do mesmo jeito, so sem o bloco
  const [r, ra] = await Promise.all([
    trFetch('vw_tr_fila_separacao?order=data_pedido' + trFiltroVista('&')),
    trFetch('vw_tr_peso_fora_do_combinado?order=item&select=item,emb_nome,un_medida,peso_combinado,envios,embalagens,peso_medio,desvio_pct'),
  ]);
  if (!r.ok) { alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">${await trErroDe(r)}</div>`; return; }
  const fila = await r.json();
  const alerta = ra.ok ? await ra.json() : [];
  // "Parada ha N dias" (12/09/2026): a fila ja vem da mais antiga para a mais nova,
  // mas a data sozinha nao diz o tamanho da espera. Dias corridos contra hoje em
  // Sao Paulo: 2 dias avisa, 3 ou mais aponta.
  const paradaHa = (d) => {
    const dia = String(d || '').slice(0, 10);
    if (!dia) return '—';
    const n = Math.round((new Date(trHoje() + 'T00:00:00') - new Date(dia + 'T00:00:00')) / 86400000);
    const txt = n <= 0 ? 'hoje' : n === 1 ? '1 dia' : `${n} dias`;
    // A ilha clara repinta .tr-tag (ambar -> #a05c00) mas NAO repinta .negativo:
    // o vermelho de tabela fica a 2,6:1 sobre o creme e some. De 3 dias em diante
    // o aponta vem de var(--brand), o mesmo vermelho que a ilha ja usa nos titulos.
    if (n >= 3) return `<span class="tr-tag" style="color:var(--brand); font-weight:700;">${txt}</span>`;
    if (n >= 2) return `<span class="tr-tag">${txt}</span>`;
    return txt;
  };
  // 04/11/2026: o alerta de peso foi ao topo às 18:00 e, às 18:20, o dono preferiu "separar ele da grade
  // dos pedidos, aparecer logo abaixo": vem logo depois da fila, num quadro próprio (trPesoAlertaHtml)
  alvo.innerHTML = (fila.length ? `
    <div id="tabelaTrOpFila"><table>
      <tr><th>Lista</th><th>Filial</th><th>Pedida em</th><th title="Dias corridos desde o pedido. A partir de 2 dias avisa; de 3 em diante aponta.">Parada há</th><th>Status</th><th>Itens</th><th>Separados</th><th>Valor estimado</th><th></th></tr>
      ${fila.map(l => `<tr>
        <td>#${l.id}</td><td>${l.unidade}</td><td>${l.data_pedido ? l.data_pedido.slice(8,10)+'/'+l.data_pedido.slice(5,7) : '—'}</td>
        <td>${paradaHa(l.data_pedido)}</td>
        <td>${l.status}</td><td>${l.itens}</td><td>${l.itens_separados}</td>
        <td>R$ ${fmt(Number(l.valor_estimado || 0))}</td>
        <td><button class="preset-btn" onclick="trListaAberta=${l.id}; trTelaSeparacao();">abrir</button>
          ${['SOLICITADA', 'SEPARADA'].includes(l.status) ? `<button class="preset-btn" onclick="trExcluirLista(${l.id}, '${l.unidade}')">🗑 excluir</button>` : ''}</td></tr>`).join('')}
    </table></div>
    <div class="caption-label">Excluir é para pedido lançado errado — some para todo mundo, sem volta.
      De ENVIADA em diante não dá mais (já tem frete e conferência no meio): fale com o Neto.</div>` :
    '<div class="contexto">Fila vazia — nenhum pedido aguardando separação. 🎉</div>') + trPesoAlertaHtml(alerta);
}

// exclusao de lista lancada errada (dono, 04/09/2026): so ate SEPARADA — a
// policy do banco e o segundo cadeado, a UI e so a porta. DELETE com RLS
// nega em silencio (0 linhas), por isso o return=representation confere.
async function trExcluirLista(id, unidade) {
  if (!confirm(`Excluir a lista #${id} (${unidade})? Ela some para todo mundo — só use para pedido lançado errado.`)) return;
  avisoAcao('enviando', `Excluindo a lista #${id}…`);
  const r = await trFetch(`tr_listas?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }).catch((e) => ({ ok: false, status: 0, json: async () => ({ message: 'sem conexão (' + e.message + ')' }) }));
  const linhas = r.ok ? await r.json() : [];
  if (!r.ok || !linhas.length) {
    return avisoAcao('erro', !r.ok ? `✗ A lista #${id} NÃO foi excluída: ${await trErroDe(r)}. Tente de novo.`
                                    : `✗ A lista #${id} NÃO foi excluída: ela já avançou de etapa.`);
  }
  avisoAcao('ok', `✓ Lista #${id} (${unidade}) excluída — às ${avisoHora()}.`);
  trListaAberta = null;
  trTelaSeparacao();
}

async function trAbrirSeparacao(id) {
  const alvo = document.getElementById('trTelaConteudo');
  const [rl, ri] = await Promise.all([
    trFetch(`tr_listas?id=eq.${id}&select=id,unidade,status,data_pedido`),
    trFetch(`tr_lista_itens?id_lista=eq.${id}&order=item&select=id,item,un_medida,qtd_solicitada,qtd_separada,emb_separada,avulso,observacao,editado,qtd_auto`),
  ]);
  const lista = (await rl.json())[0];
  const itens = await ri.json();
  const [mapa, cat] = await Promise.all([trEmbMapa(lista.unidade), trCatMapa(lista.unidade)]);
  // linha com pote automatico e contada em UNIDADES: o rotulo "caixa de 26"
  // do pote induzia a separar em caixas (a #24411 gravou 78 no lugar de 3)
  itens.forEach(i => { i._semEmb = i.qtd_auto != null; });
  // o pedido aparece na lingua de quem pediu ("1 balde · 4,5 kg"); o campo do
  // separado segue na medida, com a unidade ESCRITA ao lado (01/10/2026)
  itens.forEach(i => { i._pedidoTxt = trQtdEmbTxt(i.qtd_solicitada, i.un_medida, i._semEmb ? null : cat[i.item]); });
  // PESA E CONTA (dono, 01/10/2026): item de embalagem unica, na unidade da
  // grade, ganha DOIS campos — quantos foram e o peso/medida. Fica com um campo
  // so (como sempre): item sem embalagem, item de duas embalagens, pote
  // automatico e linha cujo pedido nao fecha em embalagem inteira ou meia.
  const fecha = (r) => r >= 0.5 && Math.abs(r * 2 - Math.round(r * 2)) <= 0.002;
  itens.forEach(i => {
    const c = i._semEmb ? null : cat[i.item];
    const unica = !!c && !!c.emb_fator && !c.emb2_fator && (c.un_medida || '') === (i.un_medida || '');
    const pedida = unica ? Number(i.qtd_solicitada || 0) / Number(c.emb_fator) : 0;
    i._cont = unica && (i.emb_separada != null || fecha(pedida));
    if (!i._cont) return;
    i._f = Number(c.emb_fator);
    i._embNome = c.emb_nome;
    i._pesoVar = !!c.peso_variavel;
    // quantos: a contagem ja gravada; senao o que o peso ja separado da em
    // embalagens (lista separada antes de a contagem existir); senao o pedido
    const jaSep = i.qtd_separada != null ? Number(i.qtd_separada) / i._f : null;
    i._n0 = i.emb_separada != null ? Number(i.emb_separada)
      : (jaSep != null && (jaSep === 0 || fecha(jaSep)) ? Math.round(jaSep * 2) / 2 : Math.round(pedida * 2) / 2);
    // peso: o gravado; senao contagem x peso combinado. No item de peso variavel
    // (T-bone) nasce VAZIO: e pesado de verdade, nao tem peso para sugerir
    const combinado = Math.round(i._n0 * i._f * 1000) / 1000;
    i._p0 = i.qtd_separada != null ? Number(i.qtd_separada) : (i._pesoVar ? '' : combinado);
    // o peso acompanha a contagem enquanto for o sugerido (ninguem digitou outro)
    i._auto = !i._pesoVar && i._p0 !== '' && Math.abs(i._p0 - combinado) < 0.0005 ? String(i._p0) : '';
  });
  window._trItensSep = itens; window._trListaSep = lista; window._trEmbMapaSep = mapa;
  alvo.innerHTML = `
    <div class="caption-label"><button class="preset-btn" onclick="trListaAberta=null; trTelaSeparacao();">← fila</button>
      Lista <b>#${id}</b> · ${lista.unidade} · status <b>${lista.status}</b>
      <button class="preset-btn" style="margin-left:8px;" onclick="trImprimirSeparacao(${id})">🖨️ Gerar PDF</button>
      ${lista.status === 'SOLICITADA' || (['SEPARADA', 'ENVIADA'].includes(lista.status) && ['DONO', 'SEPARACAO'].includes(TR_OP.papel)) ? `<button class="preset-btn" onclick="trListaAberta=null; trEditarPedido(${id})">✏️ corrigir pedido</button>` : ''}</div>
    <div id="tabelaTrOpSep"><table>
      <tr><th>Item</th><th>Solicitado</th><th>Separado</th></tr>
      ${itens.map((i, idx) => `<tr><td>${i.item} <span class="dre-av">${i.un_medida || ''}</span>${i._semEmb ? '' : trEmbRotulo(mapa, i.item)}${i.avulso ? ' <span class="tr-tag">🆕 fora da grade</span>' : ''}${i.observacao ? ` <span class="tr-tag">${i.observacao}</span>` : ''}${i.editado ? ' <span class="tr-tag">✏️ editado</span>' : ''}</td>
        <td>${i._pedidoTxt}</td>
        ${i._cont ? `<td style="white-space:normal; line-height:2;">
          <span style="white-space:nowrap; margin-right:10px;"><input type="number" min="0" step="0.5" inputmode="decimal" id="trse_${idx}" class="trc-in" value="${i._n0}"
            oninput="trSepConta(${idx})" style="width:56px; text-align:right;"> <b>${trEmbPlural(String(i._embNome).split(' (')[0], 2)}</b></span>
          <span style="white-space:nowrap;"><input type="number" min="0" step="any" inputmode="decimal" id="trs_${idx}" class="trc-in" value="${i._p0}" data-auto="${i._auto}"
            ${i._pesoVar ? 'placeholder="pese"' : ''} oninput="trSepAviso(${idx})" style="width:80px; text-align:right;"> <b>${(i.un_medida || '').toLowerCase()}</b></span>
          <div class="tr-tag" id="trsa_${idx}" style="white-space:normal; line-height:1.3; margin-bottom:4px;" hidden></div></td>`
        : `<td style="white-space:nowrap;"><input type="number" min="0" step="any" inputmode="decimal" id="trs_${idx}" class="trc-in" value="${i.qtd_separada ?? i.qtd_solicitada ?? ''}"
          style="width:80px; text-align:right;"> <b>${(i.un_medida || '').toLowerCase()}</b></td>`}</tr>`).join('')}
    </table></div>
    <div style="margin-top:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
      <button class="preset-btn" onclick="trSalvarSeparacao(${id})">Salvar e marcar como SEPARADA</button>
      <span>entrega: <input type="date" id="trDataEntrega" class="trc-in" value="${trHoje()}"></span>
      <label style="font-size:12.5px;"><input type="checkbox" id="trFreteMichiro"> 🛵 o Michiro levou (gera o frete de R$ 50)</label>
      <button class="preset-btn" onclick="trEnviarLista(${id})">Enviar para a filial</button>
      <span id="trSepMsg" style="font-size:12px;"></span>
    </div>
    <div class="caption-label">Item que vai em pacote, balde ou caixa tem dois campos: <b>quantos foram</b> e
      <b>o peso</b>. O peso já vem pelo combinado — troque pelo que a balança mostrar. A filial confere contando
      os pacotes e vale o peso anotado aqui.</div>
    <div class="caption-label">Salvar grava as quantidades e marca a lista como SEPARADA. Enviar fecha a etapa —
      a filial passa a ver a lista na Conferência. <b>Marque o 🛵 só quando for o Michiro</b>: é a marcação que
      gera a cobrança do frete (desmarcado = outro portador, sem frete).</div>`;
  // acende o que ja abre fora do combinado (separacao salva antes) e o lembrete do item pesado
  itens.forEach((i, idx) => { if (i._cont) trSepAviso(idx); });
}

// A contagem mudou: o peso acompanha (contagem x peso combinado) enquanto for o
// sugerido — depois que alguem digita o peso da balanca, ele nao e mais mexido.
// Item de peso variavel (T-bone) nunca recebe peso sugerido.
function trSepConta(idx) {
  const i = (window._trItensSep || [])[idx];
  const cont = document.getElementById('trse_' + idx);
  const peso = document.getElementById('trs_' + idx);
  if (!i || !cont || !peso) return;
  cont.style.borderColor = '';
  if (!i._pesoVar && (peso.value === '' || peso.value === peso.dataset.auto)) {
    peso.value = cont.value === '' ? '' : String(Math.round(Number(cont.value) * i._f * 1000) / 1000);
    peso.dataset.auto = peso.value;
  }
  trSepAviso(idx);
}
// Aviso na hora, SEM travar: o peso digitado fugiu mais de 10% do combinado
// para aquela contagem ("10 pacotes costumam dar 4,5 kg; você pesou 3,9 kg").
// Devolve true quando o aviso de peso esta aceso.
function trSepAviso(idx) {
  const i = (window._trItensSep || [])[idx];
  const cont = document.getElementById('trse_' + idx);
  const peso = document.getElementById('trs_' + idx);
  const tag = document.getElementById('trsa_' + idx);
  if (!i || !i._cont || !cont || !peso || !tag) return false;
  const n = Number(cont.value || 0), p = Number(peso.value || 0);
  const un = (i.un_medida || '').toLowerCase();
  const fora = !i._pesoVar && n > 0 && trPesoFora(n, p, i._f);
  let txt = '';
  if (fora) txt = `${trNum(n)} ${trEmbPlural(String(i._embNome).split(' (')[0], n)} ${n < 2 ? 'costuma' : 'costumam'} dar ${trNum(n * i._f, 3)} ${un}; você ${un === 'kg' ? 'pesou' : 'anotou'} ${trNum(p, 3)} ${un} — confere?`;
  else if (i._pesoVar && n > 0 && peso.value === '') txt = 'pese na balança e anote — cada pacote deste item tem um peso';
  tag.textContent = txt;
  tag.hidden = !txt;
  peso.style.borderColor = fora ? 'var(--farol-perto)' : '';
  return fora;
}

async function trSalvarSeparacao(id) {
  const msg = document.getElementById('trSepMsg');
  // 1. le e VALIDA tudo antes de gravar qualquer linha (01/10/2026)
  const gravar = [], erros = [];
  let primeiroRuim = null, foraDoCombinado = 0;
  const ruim = (el, texto) => { erros.push(texto); if (el) { el.style.borderColor = 'var(--farol-fora)'; primeiroRuim = primeiroRuim || el; } };
  (window._trItensSep || []).forEach((i, idx) => {
    const peso = document.getElementById('trs_' + idx);
    if (!peso) return;
    if (!i._cont) {
      // linha sem contagem: um campo so, na medida — exatamente como era
      if (peso.value === '') return;
      const corpo = { qtd_separada: Number(peso.value) };
      if (i.emb_separada != null) corpo.emb_separada = null;   // deixou de ser item de embalagem unica
      gravar.push({ i, corpo });
      return;
    }
    const cont = document.getElementById('trse_' + idx);
    const emb = String(i._embNome).split(' (')[0];
    const un = (i.un_medida || '').toLowerCase();
    if (cont.value === '' && peso.value === '') return;   // linha deixada em branco: fica como esta
    const n = Number(cont.value), p = Number(peso.value || 0);
    if (cont.value === '') return ruim(cont, `${i.item}: diga quantos ${trEmbPlural(emb, 2)} foram (0 se não foi nenhum)`);
    if (n < 0 || !trEmbInteira(n)) return ruim(cont, `${i.item}: ${trNum(n)} ${trEmbPlural(emb, n)} — embalagem sai inteira ou pela metade`);
    if (n > 0 && !(p > 0)) return ruim(peso, `${i.item}: faltou o peso ${n < 2 ? 'de' : 'dos'} ${trNum(n)} ${trEmbPlural(emb, n)}${i._pesoVar ? ' — este item é pesado na balança' : ''} (se não foi nenhum, escreva 0 em ${trEmbPlural(emb, 2)})`);
    if (n === 0 && p > 0) return ruim(cont, `${i.item}: tem ${trNum(p, 3)} ${un} anotado mas 0 ${trEmbPlural(emb, 2)} — diga quantos foram`);
    if (trSepAviso(idx)) foraDoCombinado++;
    gravar.push({ i, corpo: { qtd_separada: n > 0 ? p : 0, emb_separada: n } });
  });
  if (erros.length) {
    msg.innerHTML = '<b>Nada foi salvo.</b> Corrija o campo em vermelho:<br>' + erros.join('<br>');
    msg.style.color = 'var(--farol-fora)';
    if (primeiroRuim) primeiroRuim.scrollIntoView({ block: 'center' });
    return;
  }
  // 29/10/2026: um clique só (o botão não travava) e o resultado na barra do resultado
  if (window._trSepSalvando) return;
  window._trSepSalvando = true;
  msg.textContent = '';
  avisoAcao('enviando', `Salvando a separação da lista #${id}…`);
  const sem = (e) => ({ ok: false, status: 0, json: async () => ({ message: 'sem conexão (' + e.message + ')' }) });
  try {
    // 2. grava: o peso/medida em qtd_separada e, na linha contada, quantos em emb_separada
    let n = 0;
    for (const { i, corpo } of gravar) {
      const r = await trFetch(`tr_lista_itens?id=eq.${i.id}`, { method: 'PATCH', body: JSON.stringify(corpo) }).catch(sem);
      if (!r.ok) return avisoAcao('erro', `✗ ${i.item} NÃO salvou: ${await trErroDe(r)}.${n ? ` As ${n} linhas antes dela ficaram salvas.` : ''} Clique em Salvar de novo.`);
      n++;
    }
    const rs = await trFetch(`tr_listas?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'SEPARADA' }) }).catch(sem);
    if (!rs.ok) return avisoAcao('erro', `✗ Os itens salvaram, mas a lista NÃO virou SEPARADA: ${await trErroDe(rs)}. Clique em Salvar de novo.`);
    avisoAcao(foraDoCombinado ? 'atencao' : 'ok', `✓ Separação da lista #${id} salva (lista SEPARADA) — às ${avisoHora()}.`
      + (foraDoCombinado ? ` ${foraDoCombinado} ${foraDoCombinado === 1 ? 'item ficou' : 'itens ficaram'} com peso diferente do combinado — confira antes de enviar.` : ''));
  } finally { window._trSepSalvando = false; }
}

async function trEnviarLista(id) {
  const msg = document.getElementById('trSepMsg');
  const data = document.getElementById('trDataEntrega').value;
  const michiro = !!document.getElementById('trFreteMichiro')?.checked;
  avisoAcao('enviando', `Enviando a lista #${id} para a filial…`);
  const r = await trRpcSeguro('tr_enviar_lista', { p_id: id, p_data_entrega: data, p_frete_michiro: michiro });
  if (!r.ok) return avisoAcao('erro', `✗ A lista #${id} NÃO foi enviada: ${await trErroDe(r)}. Tente de novo.`);
  if (msg) msg.textContent = '';
  avisoAcao('ok', `✓ Lista #${id} enviada para a filial — às ${avisoHora()}. A filial confere no recebimento.`);
  trListaAberta = null;
  setTimeout(trTelaSeparacao, 900);
}

// Papel para a separacao (03/09/2026): abre a lista num formato de imprimir
// (ou salvar em PDF pelo dialogo do navegador), agrupada como o estoque anda.
async function trImprimirSeparacao(id) {
  const itens = window._trItensSep || [];
  const lista = window._trListaSep || {};
  let grupoDe = {};
  try {
    const filtro = itens.map(i => '"' + i.item.replace(/"/g, '') + '"').join(',');
    const r = await trFetch(`tr_itens?select=item,grupo_separacao&item=in.(${encodeURIComponent(filtro)})`);
    if (r.ok) (await r.json()).forEach(x => { grupoDe[x.item] = x.grupo_separacao; });
  } catch (e) { /* sem grupo tudo cai em OUTROS — o papel sai do mesmo jeito */ }
  const porGrupo = {};
  itens.forEach(i => {
    const g = i.avulso ? '🆕 FORA DA GRADE' : (grupoDe[i.item] || 'OUTROS');
    (porGrupo[g] = porGrupo[g] || []).push(i);
  });
  const ddmm = (d) => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '—';
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lista #${id} — ${lista.unidade || ''}</title><style>
    body { font-family:Arial, sans-serif; color:#000; margin:24px; }
    h1 { font-size:19px; margin:0 0 2px; }
    .sub { font-size:12px; color:#45443f; margin-bottom:14px; }
    h2 { font-size:12px; text-transform:uppercase; border-bottom:1.5px solid #000; padding-bottom:2px; margin:16px 0 4px; }
    table { width:100%; border-collapse:collapse; }
    td, th { border-bottom:1px solid #bbb; padding:6px; font-size:13px; text-align:left; }
    th { font-size:10.5px; text-transform:uppercase; color:#45443f; }
    .q { text-align:right; white-space:nowrap; }
    .risco { width:150px; white-space:nowrap; }
    .risco.dois { line-height:2; }
    .risco span { display:inline-block; width:58%; border-bottom:1px solid #000; height:14px; }
    .cx { width:24px; font-size:15px; }
    @media print { .naoimprime { display:none; } }
  </style></head><body>
    <button class="naoimprime" onclick="window.print()" style="float:right; padding:8px 14px;">Imprimir / salvar PDF</button>
    <h1>Lista #${id} — ${lista.unidade || ''}</h1>
    <div class="sub">pedida em ${ddmm(lista.data_pedido)} · ${itens.length} itens · impressa em ${ddmm(trHoje())} · marque ☑ ao separar e anote quanto foi — no item de pacote, balde ou caixa: quantos foram e o peso</div>
    ${Object.keys(porGrupo).sort().map(g => `<h2>${g}</h2><table>
      <tr><th class="cx"></th><th>Item</th><th>Un</th><th class="q">Solicitado</th><th class="risco">Separado</th></tr>
      ${porGrupo[g].map(i => `<tr><td class="cx">☐</td><td>${i.item}${i.editado ? ' ✏️' : ''}${!i._semEmb && (window._trEmbMapaSep || {})[i.item] ?` <span style="font-size:10.5px; color:#45443f;">(${window._trEmbMapaSep[i.item]})</span>` : ''}${i.observacao ? `<br><span style="font-size:10.5px; color:#45443f;">${i.observacao}</span>` : ''}</td><td>${i.un_medida || ''}</td>
        <td class="q">${i._pedidoTxt || '<b>' + Number(i.qtd_solicitada || 0) + '</b>'}</td><td class="risco${i._cont ? ' dois' : ''}">${i._cont ? `<span></span> ${trEmbPlural(String(i._embNome).split(' (')[0], 2)}<br>` : ''}<span></span> ${(i.un_medida || '').toLowerCase()}</td></tr>`).join('')}
    </table>`).join('')}
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}

// ---- tela: conferencia no recebimento (FILIAL/DONO) ----
// Desde 09/09/2026 (pedido do dono) a tela tem duas abas: AGUARDANDO (o
// trabalho) e FINALIZADAS (historico so-leitura das listas do painel ja
// conferidas — quem pediu ve o que recebeu, sem mexer em nada).
let trConfAba = 'ABERTAS';
async function trTelaConferencia() {
  const alvo = document.getElementById('trTelaConteudo');
  if (trListaAberta) return trConfAba === 'FINALIZADAS' ? trVerFinalizada(trListaAberta) : trAbrirConferencia(trListaAberta);
  const filtro = trFiltroVista('&');
  const chips = `<div style="margin:4px 0 10px;">
      <button class="preset-btn ${trConfAba === 'ABERTAS' ? 'active' : ''}" onclick="trConfAba='ABERTAS'; trListaAberta=null; trTelaConferencia();">aguardando conferência</button>
      <button class="preset-btn ${trConfAba === 'FINALIZADAS' ? 'active' : ''}" onclick="trConfAba='FINALIZADAS'; trListaAberta=null; trTelaConferencia();">✅ finalizadas</button>
    </div>`;
  // valores por lista (11/09/2026, dono: a filial ve o R$ das fechadas e o
  // parcial das que a central esta montando). Vem das views mascaradas:
  // login sem valores recebe NULL e a tela simplesmente nao mostra o R$.
  const dinheiro = (v, aprox) => v == null ? '' : ` · <b>${aprox ? '≈ ' : ''}R$ ${fmt(Number(v))}</b>`;
  if (trConfAba === 'FINALIZADAS') {
    const [r, rv] = await Promise.all([
      trFetch(`tr_listas?status=in.(RECEBIDA,FECHADA)&fonte=eq.PAINEL${filtro}&order=id.desc&limit=40&select=id,unidade,data_pedido,data_entrega,status,recebido_por`),
      trFetch(`vw_tr_listas?fonte=eq.PAINEL&status=in.(RECEBIDA,FECHADA)${filtro}&order=id.desc&limit=40&select=id,total_lista`),
    ]);
    if (!r.ok) { alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">${await trErroDe(r)}</div>`; return; }
    const listas = await r.json();
    const valores = {};
    if (rv.ok) (await rv.json()).forEach(v => { valores[v.id] = v.total_lista; });
    alvo.innerHTML = chips + (listas.length ? `
      <div class="caption-label">As últimas ${listas.length} listas já conferidas${TR_OP.unidade ? ' da sua loja' : trFilialVista() ? ' de ' + trFilialVista() : ''} — só leitura, o histórico de quem pediu.</div>
      ${listas.map(l => `<div class="contexto" style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <span>Lista <b>#${l.id}</b> · ${l.unidade} · entrega ${l.data_entrega ? l.data_entrega.slice(8,10)+'/'+l.data_entrega.slice(5,7) : '—'}${dinheiro(valores[l.id])}
          ${l.recebido_por ? `<span class="tr-det">· conferida por ${l.recebido_por}</span>` : ''}</span>
        <button class="preset-btn" onclick="trListaAberta=${l.id}; trTelaConferencia();">ver</button></div>`).join('')}` :
      '<div class="contexto">Nenhuma lista finalizada ainda — a primeira aparece aqui assim que uma conferência fechar.</div>');
    return;
  }
  // fonte=PAINEL: as 1.118 listas da era planilha estao ENVIADA no banco (historico
  // congelado) e poluiam a fila — aqui e so o modulo operante, mais nova primeiro.
  // "Em preparo": o que a central ainda esta montando, com o parcial ao vivo.
  const filtroFila = trFilialVista() ? `unidade=eq.${encodeURIComponent(trFilialVista())}&` : '';
  const [r, rv, rp] = await Promise.all([
    trFetch(`tr_listas?status=eq.ENVIADA&fonte=eq.PAINEL${filtro}&order=data_entrega.desc,id.desc&select=id,unidade,data_pedido,data_entrega`),
    trFetch(`vw_tr_listas?fonte=eq.PAINEL&status=eq.ENVIADA${filtro}&select=id,total_lista`),
    trFetch(`vw_tr_fila_separacao?${filtroFila}status=in.(SOLICITADA,SEPARADA)&order=id.desc&select=id,unidade,status,itens,valor_estimado`),
  ]);
  if (!r.ok) { alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">${await trErroDe(r)}</div>`; return; }
  const listas = await r.json();
  const valores = {};
  if (rv.ok) (await rv.json()).forEach(v => { valores[v.id] = v.total_lista; });
  const preparo = rp.ok ? await rp.json() : [];
  alvo.innerHTML = chips + (preparo.length ? `
    <div class="caption-label">🧺 Em preparo na central — o parcial cresce enquanto a lista é montada:</div>
    ${preparo.map(l => `<div class="contexto" style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
      <span>Lista <b>#${l.id}</b> · ${l.unidade} · ${l.status === 'SOLICITADA' ? 'pedida, aguardando separação' : 'em separação'}
        · ${l.itens} itens${dinheiro(l.valor_estimado, true)}</span></div>`).join('')}` : '') + (listas.length ? `
    <div class="caption-label">Listas enviadas aguardando a conferência do recebimento — confira ITEM A ITEM, é o zero que dói.</div>
    ${listas.map(l => `<div class="contexto" style="display:flex; justify-content:space-between; align-items:center;">
      <span>Lista <b>#${l.id}</b> · ${l.unidade} · entrega ${l.data_entrega ? l.data_entrega.slice(8,10)+'/'+l.data_entrega.slice(5,7) : '—'}${dinheiro(valores[l.id], true)}</span>
      <span>${['DONO', 'SEPARACAO'].includes(TR_OP.papel) ? `<button class="preset-btn" onclick="trEditarPedido(${l.id})">✏️ corrigir</button> ` : ''}<button class="preset-btn" onclick="trListaAberta=${l.id}; trTelaConferencia();">conferir</button></span></div>`).join('')}` :
    '<div class="contexto">Nenhuma lista aguardando conferência.</div>');
}

// lista finalizada, so leitura: o que foi separado x o que a loja confirmou
// Valor por item da lista (dono, 30/09/2026: "conferir por item" — a #24411
// tinha um item puxando o total). Preco CONGELADO da linha x (1 + producao) x
// fator, pela view mascarada: login sem valores recebe nulo e nao ve as colunas.
// Total = RECEBIDO (conferido) x unitario — a lista cobra o recebido desde
// 30/09/2026 (dono); enquanto nao ha conferencia, o separado estima.
function trQtdCobrada(i) { return Number(i.qtd_recebida ?? i.qtd_separada ?? 0); }
async function trPrecosDaLista(id, busca) {
  const r = await busca(`vw_tr_conferencia_valores?id_lista=eq.${id}&select=id,preco_efetivo`);
  const p = {};
  (Array.isArray(r) ? r : []).forEach(v => { if (v.preco_efetivo != null) p[v.id] = Number(v.preco_efetivo); });
  return p;
}
function trColunasValor(i, precos) {
  const u = precos[i.id];
  if (u == null) return '<td>—</td><td>—</td>';
  return `<td style="text-align:right; white-space:nowrap;">R$ ${fmt(u)}<span class="tr-det">/${(i.un_medida || 'un').toLowerCase()}</span></td>
    <td style="text-align:right; white-space:nowrap;"><b>R$ ${fmt(trQtdCobrada(i) * u)}</b></td>`;
}
async function trVerFinalizada(id) {
  const alvo = document.getElementById('trTelaConteudo');
  const [rl, ri, rv, precos] = await Promise.all([
    trFetch(`tr_listas?id=eq.${id}&select=id,unidade,status,data_pedido,data_entrega,recebido_por`),
    trFetch(`tr_lista_itens?id_lista=eq.${id}&order=item&select=id,item,un_medida,qtd_solicitada,qtd_separada,qtd_recebida,emb_separada,emb_recebida,avulso,observacao,editado`),
    trFetch(`vw_tr_listas?id=eq.${id}&select=total_lista,valor_cobrado,frete`),
    trPrecosDaLista(id, async (u) => { const r = await trFetch(u); return r.ok ? r.json() : []; }),
  ]);
  const lista = (await rl.json())[0] || {};
  const itens = await ri.json();
  const valor = rv.ok ? (await rv.json())[0] : null;
  const [mapa, cat] = await Promise.all([trEmbMapa(lista.unidade), trCatMapa(lista.unidade)]);
  const comValor = Object.keys(precos).length > 0;
  const somaItens = itens.reduce((s, i) => s + (precos[i.id] != null ? trQtdCobrada(i) * precos[i.id] : 0), 0);
  const difs = itens.filter(i => Number(i.qtd_recebida ?? 0) !== Number(i.qtd_separada ?? 0));
  alvo.innerHTML = `
    <div class="caption-label"><button class="preset-btn" onclick="trListaAberta=null; trTelaConferencia();">← finalizadas</button>
      Lista <b>#${id}</b> · ${lista.unidade || ''} · pedida ${lista.data_pedido ? lista.data_pedido.slice(8,10)+'/'+lista.data_pedido.slice(5,7) : '—'}
      · entrega ${lista.data_entrega ? lista.data_entrega.slice(8,10)+'/'+lista.data_entrega.slice(5,7) : '—'}
      ${lista.recebido_por ? '· conferida por <b>' + lista.recebido_por + '</b>' : ''}
      ${valor && valor.total_lista != null ? `· <b>R$ ${fmt(Number(valor.total_lista))}</b>${Number(valor.frete) ? ` <span class="tr-det">(itens R$ ${fmt(Number(valor.valor_cobrado || 0))} + frete R$ ${fmt(Number(valor.frete))})</span>` : ''}` : ''} —
      ${difs.length ? `<span class="tr-tag">${difs.length} item(ns) com diferença</span>` : '<span class="tr-conv">recebimento bateu 100% ✔</span>'}
      ${['DONO', 'SEPARACAO'].includes(TR_OP.papel) ? `<button class="preset-btn" onclick="trReabrirConferencia(${id})">🔓 reabrir conferência</button>` : ''}
      <span id="trReabrirMsg" style="font-size:12px;"></span></div>
    <div id="tabelaTrOpVer"><table>
      <tr><th>Item</th><th>Pedido</th><th>Separado</th><th>Recebido</th><th>Diferença</th>${comValor ? '<th>Valor unit.</th><th>Total cobrado</th>' : ''}</tr>
      ${itens.map(i => { const d = Number(i.qtd_recebida ?? 0) - Number(i.qtd_separada ?? 0); return `<tr>
        <td>${i.item} <span class="dre-av">${i.un_medida || ''}</span>${trEmbRotulo(mapa, i.item)}${i.avulso ? ' <span class="tr-tag">🆕</span>' : ''}${i.observacao ? ` <span class="tr-tag">${i.observacao}</span>` : ''}${i.editado ? ' <span class="tr-tag">✏️</span>' : ''}</td>
        <td>${trQtdEmbTxt(i.qtd_solicitada, i.un_medida, cat[i.item])}</td><td>${trSepTxt(i, cat[i.item], trNum(i.qtd_separada, 3))}</td><td>${trRecTxt(i, cat[i.item], trNum(i.qtd_recebida, 3))}</td>
        <td${d ? ' style="color:#b3261e; font-weight:700;"' : ''}>${d ? (d > 0 ? '+' : '') + trNum(d, 3) : '—'}</td>
        ${comValor ? trColunasValor(i, precos) : ''}
      </tr>`; }).join('')}
      ${comValor ? `<tr><td colspan="6" style="text-align:right;"><b>Total dos itens</b> <span class="tr-det">(recebido × unitário)</span></td>
        <td style="text-align:right; white-space:nowrap;"><b>R$ ${fmt(somaItens)}</b></td></tr>` : ''}
    </table></div>`;
}

// Mapa item -> "caixa de 10,1 kg" para decorar o NOME em toda tela do ciclo
// (pedido do dono, 10/09/2026: a embalagem aparece em todos os status).
async function trEmbMapa(unidade) {
  const r = await trFetch(`vw_tr_itens_pedido?unidade=eq.${encodeURIComponent(unidade || 'AHU')}&select=item,un_medida,emb_nome,emb_fator,emb2_nome,emb2_fator`);
  const m = {};
  if (r.ok) (await r.json()).forEach(x => {
    if (x.emb_fator) m[x.item] = x.emb_nome + ' de ' + trEmbDesc(x)
      + (x.emb2_fator ? ' ou ' + x.emb2_nome + ' de ' + trEmbDesc({ un_medida: x.un_medida, emb_fator: x.emb2_fator }) : '');
  });
  return m;
}
function trEmbRotulo(mapa, item) {
  return mapa && mapa[item] ? ` <span class="tr-det">(${mapa[item]})</span>` : '';
}

// Reabrir conferencia errada (dono, 10/09/2026): volta a lista para ENVIADA
// e ela reaparece em "aguardando" para refazer. O banco recusa reabrir lista
// que ja entrou num fechamento de mes.
async function trReabrirConferencia(id) {
  if (!confirm(`Reabrir a conferência da lista #${id}? Ela volta para "aguardando conferência" e precisa ser conferida e fechada de novo.`)) return;
  const msg = document.getElementById('trReabrirMsg');
  avisoAcao('enviando', `Reabrindo a conferência da lista #${id}…`);
  const r = await trRpcSeguro('tr_reabrir_conferencia', { p_id: id });
  if (!r.ok) return avisoAcao('erro', `✗ A conferência da lista #${id} NÃO reabriu: ${await trErroDe(r)}. Tente de novo.`);
  if (msg) msg.textContent = '';
  avisoAcao('ok', `✓ Conferência da lista #${id} reaberta — confira e feche de novo. Às ${avisoHora()}.`);
  trConfAba = 'ABERTAS';
  trListaAberta = id;
  trTelaConferencia();
}

// Diferenca na hora (12/09/2026): antes so se sabia o que divergiu DEPOIS de
// fechar a lista, na mensagem final — e ai a lista ja estava fechada. Agora a
// linha se marca enquanto se digita e o contador fica ao lado do botao.
// O que a linha GRAVA, na unidade de controle — a mesma conta para a tela e
// para o banco. Na ordem: (1) o numero que esta na coluna Separado (digitado
// ou nao) grava o separado EXATO; (2) campo intocado grava o que ja estava;
// (3) o resto converte pela embalagem. Sem a (1), conferencia reaberta dizia
// "igual ao separado" e regravava a diferenca-fantasma (4,892 contra 4,89).
function trConfQtd(i, el) {
  // PESA E CONTA (01/10/2026): na linha que a separacao contou, o campo e a
  // CONTAGEM. Bateu = o peso da separacao, exato. Diferente = proporcional
  // (9 de 10 pacotes = 90% do peso), em 3 casas. Campo intocado numa
  // reconferencia regrava o recebido que ja estava — nada de diferenca-fantasma.
  if (i._cont) {
    const n = Number(el.value || 0), sep = Number(i.emb_separada);
    if (Math.abs(n - sep) < 0.0005) return Number(i.qtd_separada);
    if (el.value === el.defaultValue && i.qtd_recebida != null) return Number(i.qtd_recebida);
    return Math.round(Number(i.qtd_separada) * n / sep * 1000) / 1000;
  }
  if (el.value === el.dataset.sep) return Number(i.qtd_separada ?? 0);
  if (el.value === el.defaultValue) return Number(i.qtd_recebida ?? i.qtd_separada ?? 0);
  const bruto = Number(el.value || 0);
  return i._fator ? Math.round(bruto * i._fator * 1000) / 1000 : bruto;
}
function trConfRecontar() {
  let difs = 0, total = 0, temValor = false;
  (window._trItensConf || []).forEach((i, idx) => {
    const el = document.getElementById('trc_' + idx);
    if (!el) return;
    const dif = Math.abs(Number(el.value || 0) - Number(el.dataset.sep || 0)) > 0.0005;
    if (dif) difs++;
    el.style.borderColor = dif ? 'var(--farol-perto)' : '';
    const tag = document.getElementById('trdif_' + idx);
    if (tag) tag.hidden = !dif;
    const tr = el.closest('tr');
    if (tr) tr.style.fontWeight = dif ? '700' : '';
    // valor da linha ao vivo (24/09/2026, dono): recebido x preco congelado
    const bruto = Number(el.value || 0);
    const qtd = trConfQtd(i, el);
    const vcel = document.getElementById('trcv_' + idx);
    if (vcel) {
      const partes = [];
      if ((i._fator || i._cont) && bruto > 0) partes.push(`= ${trNum(qtd, i._cont ? 3 : 2)} ${(i.un_medida || '').toLowerCase()}`);
      if (i._pe != null && i._pe > 0 && bruto > 0) { partes.push(`R$ ${fmt(qtd * i._pe)}`); }
      vcel.textContent = partes.join(' · ');
    }
    if (i._pe != null && i._pe > 0) { total += qtd * i._pe; temValor = true; }
  });
  const tot = document.getElementById('trConfTotal');
  if (tot) tot.textContent = temValor ? ` · Total recebido: R$ ${fmt(total)}` : '';
  const cont = document.getElementById('trConfDifs');
  if (cont) {
    cont.textContent = difs ? `${difs} ${difs === 1 ? 'item diferente' : 'itens diferentes'} do separado` : 'tudo igual ao separado';
    cont.style.color = difs ? 'var(--farol-perto)' : 'var(--tx-5)';
    cont.title = 'Conta as linhas em que o Recebido está diferente do Separado — para mais ou para menos.';
  }
}

// A conferencia fala a LINGUA DO PEDIDO (dono, 10/09/2026): item com
// embalagem confere em caixas/potes — quem confere CONTA, nao pesa. O banco
// segue guardando na unidade de controle (kg/un): a conversao e na tela.
// Item com DUAS embalagens (pernil) fica em kg — nao da para saber o mix.
async function trAbrirConferencia(id) {
  const alvo = document.getElementById('trTelaConteudo');
  const [rl, ri, rv] = await Promise.all([
    trFetch(`tr_listas?id=eq.${id}&select=id,unidade`),
    trFetch(`tr_lista_itens?id_lista=eq.${id}&order=item&select=id,item,un_medida,qtd_separada,qtd_recebida,emb_separada,emb_recebida,avulso,observacao,editado,qtd_auto`),
    trFetch(`vw_tr_conferencia_valores?id_lista=eq.${id}&select=id,preco_efetivo`),
  ]);
  const lista = (await rl.json())[0] || {};
  const itens = await ri.json();
  // preco CONGELADO por linha (mascarado por login) — o valor ao vivo da conferencia
  const precos = {};
  if (rv.ok) (await rv.json()).forEach(v => { precos[v.id] = v.preco_efetivo; });
  const rc = await trFetch(`vw_tr_itens_pedido?unidade=eq.${encodeURIComponent(lista.unidade || '')}&select=item,un_medida,emb_nome,emb_fator,emb2_nome,emb2_fator`);
  const cat = {};
  if (rc.ok) (await rc.json()).forEach(x => { cat[x.item] = x; });
  const arred = (x) => Math.round(x * 100) / 100;
  itens.forEach(i => {
    // pote automatico confere em UNIDADES: em caixa de 26, 10 potes viravam 0,38 cx
    const cx = i.qtd_auto != null ? null : cat[i.item];
    i._desc = cx && cx.emb_fator ? cx.emb_nome + ' de ' + trEmbDesc(cx)
      + (cx.emb2_fator ? ' ou ' + cx.emb2_nome + ' de ' + trEmbDesc({ un_medida: cx.un_medida, emb_fator: cx.emb2_fator }) : '') : null;
    // so confere em embalagem quando a linha esta na unidade da grade e tem pelo
    // menos meia embalagem: 4 lacres num rolo de 250 viravam "0,02 rolo" e a
    // conferencia regravava 5 (o fantasma da #24418). Nada separado segue em embalagem.
    const sepC = Number(i.qtd_separada || 0);
    i._fator = cx && cx.emb_fator && !cx.emb2_fator && (cx.un_medida || '') === (i.un_medida || '')
      && (sepC === 0 || sepC / Number(cx.emb_fator) >= 0.5) ? Number(cx.emb_fator) : null;
    i._emb = i._fator ? cx.emb_nome : null;
    // PESA E CONTA (01/10/2026): linha que a separacao CONTOU confere pela
    // contagem e vale o peso da separacao — sem dividir peso por peso combinado.
    // Recebido gravado sem contagem (conferencia feita antes desta tela) fica na
    // regra de sempre, para a reconferencia nao mudar nada sozinha.
    i._cont = trTemContagem(i) && !(i.qtd_recebida != null && i.emb_recebida == null);
    if (i._cont) { i._fator = null; i._emb = (cat[i.item] && cat[i.item].emb_nome) || 'volume'; }
    i._pe = precos[i.id] != null ? Number(precos[i.id]) : null;
  });
  window._trItensConf = itens;
  alvo.innerHTML = `
    <div class="caption-label"><button class="preset-btn" onclick="trListaAberta=null; trTelaConferencia();">← listas</button>
      Conferência da lista <b>#${id}</b> — o campo vem preenchido com o separado; <b>corrija o que veio diferente</b>.
      Item com embalagem confere em <b>caixas/potes/pacotes</b>, como foi pedido: <b>conte, não precisa pesar</b> —
      bateu a contagem, vale o peso que a separação anotou.
      <span id="trConfTotal" style="font-size:12.5px; font-weight:700;"></span></div>
    <div id="tabelaTrOpConf"><table>
      <tr><th>Item</th><th>Separado</th><th>Recebido</th></tr>
      ${itens.map((i, idx) => `<tr><td>${i.item} <span class="dre-av">${i.un_medida || ''}</span>${i._desc ? ` <span class="tr-det">(${i._desc})</span>` : ''}${i.avulso ? ' <span class="tr-tag">🆕 fora da grade</span>' : ''}${i.observacao ? ` <span class="tr-tag">${i.observacao}</span>` : ''}${i.editado ? ' <span class="tr-tag">✏️ editado</span>' : ''}</td>
        <td>${i._cont ? trContTxt(i.emb_separada, i.qtd_separada, i.un_medida, i._emb) : i._fator
          ? `${trNum(arred(Number(i.qtd_separada || 0) / i._fator))} ${trEmbPlural(i._emb, arred(Number(i.qtd_separada || 0) / i._fator))} <span class="tr-det">= ${trNum(i.qtd_separada, 3)} ${(i.un_medida || '').toLowerCase()}</span>`
          : trNum(i.qtd_separada, 3)}</td>
        <td><input type="number" min="0" step="any" id="trc_${idx}" class="trc-in" oninput="trConfRecontar()"
          data-sep="${i._cont ? Number(i.emb_separada) : i._fator ? arred(Number(i.qtd_separada || 0) / i._fator) : Number(i.qtd_separada || 0)}"
          value="${i._cont ? Number(i.emb_recebida ?? i.emb_separada) : i._fator ? arred(Number(i.qtd_recebida ?? i.qtd_separada ?? 0) / i._fator) : (i.qtd_recebida ?? i.qtd_separada ?? 0)}"
          style="width:80px; text-align:right;"> <span class="tr-det">${i._fator || i._cont ? trEmbPlural(String(i._emb).split(' (')[0], 2) : trUnNome(i.un_medida || '', 2)}</span>
          <span class="tr-tag" id="trdif_${idx}" hidden>≠ diferente do separado</span>
          <br><span class="tr-conv" id="trcv_${idx}" style="font-size:11px;"></span></td></tr>`).join('')}
    </table></div>
    ${TR_OP.papel === 'SEPARACAO' ? `<div class="caption-label">Consulta da separação — quem registra o recebimento
      e fecha a lista é a filial que recebeu.</div>` : `<div style="margin-top:12px;">
      <label style="font-size:12.5px;"><input type="checkbox" id="trConfOk"> Conferi item a item, quantidade por quantidade</label><br>
      <button class="preset-btn" style="margin-top:8px;" onclick="trFecharConferencia(${id})">Registrar recebimento e fechar a lista</button>
      <span id="trConfDifs" style="font-size:12px; margin-left:8px;"></span>
      <span id="trConfMsg" style="font-size:12px; margin-left:8px;"></span>
    </div>`}`;
  // Marca o que ja veio diferente antes de alguem digitar (recebimento salvo numa
  // conferencia anterior) e acende o contador com o numero certo.
  trConfRecontar();
}

// Registrar o recebimento, com o retorno do botao (08/10/2026): enquanto grava, o botao
// fica apagado dizendo "Registrando…" e o segundo toque nao grava de novo. Antes, a mensagem
// de "Fechada" ficava 4 s ao lado do botao ainda de pe; um segundo toque trocava o texto por
// um "Nao deu" falso (o banco recusa mexer em lista ja fechada). Quem grava e
// trFecharConferenciaGrava — a mesma de sempre.
let trConfFechando = false;
async function trFecharConferencia(id) {
  if (trConfFechando) return;
  // sem a caixa marcada nada vai ser gravado: o aviso sai ja, sem o botao piscar "Registrando…"
  // (o botao trocando de tamanho empurrava o aviso para fora da tela)
  const cx = document.getElementById('trConfOk');
  if (cx && !cx.checked) { trConfFaltaCaixa(document.getElementById('trConfMsg')); return; }
  trConfFechando = true;
  const botoes = (on) => document.querySelectorAll('button[onclick^="trFecharConferencia("]').forEach(b => {
    b.disabled = on; b.textContent = on ? 'Registrando…' : 'Registrar recebimento e fechar a lista'; b.style.opacity = on ? '.6' : '';
  });
  botoes(true);
  try { await trFecharConferenciaGrava(id); }
  catch (e) {
    // o fetch nem voltou (antes a tela ficava em "Registrando..." para sempre)
    const msg = document.getElementById('trConfMsg');
    if (msg) {
      msg.innerHTML = '<b>A internet caiu no meio</b> e não deu para confirmar o registro. Os campos continuam preenchidos: quando a internet voltar, toque de novo em registrar.';
      msg.style.color = 'var(--brand)';
    }
  } finally {
    trConfFechando = false;
    botoes(false);
  }
}
// Tocou em registrar sem marcar a caixa "Conferi item a item" (revisao de 08/10/2026): o
// aviso sai embaixo do botao, em letra de ler, e a caixa que falta fica contornada. Antes
// eram 12px em amarelo claro sobre o creme, no meio do "tudo igual ao separado" — para quem
// tocou, o botao nao tinha feito nada. Marcou a caixa, o aviso e o contorno somem.
function trConfFaltaCaixa(msg) {
  const cx = document.getElementById('trConfOk'), rot = cx ? cx.closest('label') : null;
  if (msg) msg.innerHTML = '<span style="display:block; margin-top:8px; font-size:14px; font-weight:600; line-height:1.4; color:var(--brand);">'
    + '<b>Falta marcar a caixa “Conferi item a item”</b>, logo acima deste botão. Sem ela nada é registrado.</span>';
  if (rot) { rot.style.outline = '2px solid var(--brand)'; rot.style.outlineOffset = '4px'; rot.style.borderRadius = '6px'; }
  // o aviso nasce embaixo do botao: se o botao estava no pe da tela, a tela desce o que falta
  const aviso = msg ? msg.querySelector('span') : null;
  if (aviso) aviso.scrollIntoView({ block: 'nearest' });
  if (cx && !cx.dataset.avisa) {
    cx.dataset.avisa = '1';
    cx.addEventListener('change', () => {
      if (rot) rot.style.outline = '';
      if (msg && cx.checked && msg.querySelector('span')) msg.textContent = '';
    });
  }
}
async function trFecharConferenciaGrava(id) {
  const msg = document.getElementById('trConfMsg');
  if (!document.getElementById('trConfOk').checked) { trConfFaltaCaixa(msg); return; }
  // Linha contada (01/10/2026): a contagem tem de estar escrita e ser inteira ou
  // meia — conferida ANTES de mexer no status, para nao deixar a lista pela metade.
  const ruins = [];
  (window._trItensConf || []).forEach((i, idx) => {
    const el = document.getElementById('trc_' + idx);
    if (!i._cont || !el) return;
    const n = Number(el.value || 0);
    if (el.value !== '' && n >= 0 && trEmbInteira(n)) return;
    const emb = String(i._emb).split(' (')[0];
    ruins.push(el.value === '' ? `${i.item}: escreva quantos ${trEmbPlural(emb, 2)} chegaram (0 se não chegou nenhum)`
      : `${i.item}: ${trNum(n)} ${trEmbPlural(emb, n)} — conte inteiro ou meio`);
    el.style.borderColor = 'var(--farol-fora)';
    if (ruins.length === 1) el.scrollIntoView({ block: 'center' });
  });
  if (ruins.length) {
    msg.innerHTML = '<b>Nada foi registrado.</b> Corrija o campo em vermelho:<br>' + ruins.join('<br>');
    msg.style.color = 'var(--farol-fora)'; return;
  }
  msg.textContent = 'Registrando...'; msg.style.color = '#8a897e';
  const rs = await trFetch(`tr_listas?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'RECEBIDA' }) });
  if (!rs.ok) { msg.textContent = 'Não deu: ' + await trErroDe(rs); msg.style.color = '#ff6b6b'; return; }
  for (const [idx, i] of (window._trItensConf || []).entries()) {
    // campo em embalagens grava convertido na unidade de controle, sem a ida e
    // volta arredondada que gravava 9,88 no lugar de 10 potes (trConfQtd)
    const el = document.getElementById('trc_' + idx);
    const v = trConfQtd(i, el);
    // linha contada grava junto quantas embalagens chegaram; as outras, so o recebido
    const corpo = i._cont ? { qtd_recebida: v, emb_recebida: Number(el.value || 0) } : { qtd_recebida: v };
    const r = await trFetch(`tr_lista_itens?id=eq.${i.id}`, { method: 'PATCH', body: JSON.stringify(corpo) });
    if (!r.ok) { msg.textContent = `Item ${i.item}: ` + await trErroDe(r); msg.style.color = '#ff6b6b'; return; }
  }
  const rf = await trRpc('tr_fechar_lista', { p_id: id });
  if (!rf.ok) { msg.textContent = 'Quantidades salvas, mas não fechou: ' + await trErroDe(rf); msg.style.color = '#ff6b6b'; return; }
  // a lista ja esta fechada. Se so a leitura das diferencas falhar, o quadro sai SEM dizer se
  // bateu ou nao (divs = null) — a tela antiga dizia "bateu 100%" tambem nesse caso
  let divs = null;
  try { const rd = await trFetch(`vw_tr_divergencias?id_lista=eq.${id}`); if (rd.ok) divs = await rd.json(); } catch (e) { divs = null; }
  trListaAberta = null;
  // o quadro entra no lugar da lista, na hora (antes: 12px ao lado do botao por 4 s)
  trConfFechadaTela(id, divs);
}

// ---- tela: contas a pagar (FILIAL ve as suas; DONO baixa) ----
async function trTelaContas() {
  const alvo = document.getElementById('trTelaConteudo');
  const filtro = trFiltroVista('&');
  // So o dinheiro DO CICLO DAS LISTAS (dono, 09/09/2026): BENEFICIO/ACERTO sao
  // as remessas do beneficio iFood -> XP, que vivem no Fluxo Projetado — aqui
  // misturados confundiam (apareciam com "itens 0,00").
  const r = await trFetch(`vw_tr_contas_pagar?tipo=in.(LISTA,MENSAL,FRETE_MES)&order=vencimento${filtro}`);
  if (!r.ok) { alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">${await trErroDe(r)}</div>`; return; }
  const contas = await r.json();
  const dono = TR_OP.papel === 'DONO';
  const abertas = contas.filter(c => c.status !== 'PAGA');
  // Entradas das filiais no Saipos que NAO baixaram cobranca nenhuma (01/10/2026): o
  // texto nao diz o mes (o Boqueirao entra como "REPASSE BOQUEIRAO LISTA + ROYALTIES"),
  // o mes ainda nao tem fechamento validado, ou o titulo vinculado saiu do Saipos. Sem a
  // view (banco anterior a baixa_listas_pelo_saipos.sql novo) o quadro nao aparece.
  let entradas = [];
  try {
    const re = await trFetch(`vw_tr_pagamentos_saipos?situacao=neq.BAIXA&order=data${filtro}`);
    if (re.ok) entradas = await re.json();
  } catch (e) { entradas = []; }
  window._trEntradas = entradas;
  // BAIXA PARCIAL (dono, 01/10/2026): a filial paga aos poucos; cada pagamento
  // entra com valor e data, a tela mostra quanto ja foi pago e quanto falta, e a
  // cobranca so vira PAGA quando o saldo zera (tr_registrar_pagamento).
  const falta = c => c.saldo != null ? Number(c.saldo) : Number(c.valor_total || 0);
  window._trContas = contas;
  alvo.innerHTML = `
    <div class="caption-label">Só entra aqui o fechamento que a Rita já validou.
      ${TR_OP.papel === 'SEPARACAO' || dono ? 'O que está esperando validação fica em <b>Fechamento do mês</b>.' : ''}
      A filial pode pagar aos poucos. <b>O pagamento entra sozinho pelo Saipos</b>: a entrada lançada na Água Verde como
      “LISTA AHU 09/2026” (filial e mês da lista) baixa a cobrança na carga seguinte, e o que falta é calculado aqui.
      ${entradas.length ? 'Entrada que não baixou sozinha está no quadro de baixo.' : ''}
      ${dono ? 'Lance à mão só o que não passar pelo Saipos — nos dois lugares conta em dobro.' : ''}
      <span id="trContasMsg" style="font-size:12px; margin-left:6px;"></span></div>
    ${trContasDocBloco(contas)}
    <div id="tabelaTrOpContas"><table>
      <tr><th>Quem deve</th><th>Para quem</th><th>Tipo</th><th>Referência</th><th>Itens</th><th>Frete</th><th>Royalty</th><th>Total</th><th>Já pago</th><th>Falta</th><th>Vencimento</th><th>Status</th><th>Validou</th>${dono ? '<th>Lançar pagamento</th>' : ''}</tr>
      ${contas.map(c => `<tr>
        <td>${c.unidade}</td><td>${c.credor === 'MICHIRO' ? '🛵 MICHIRO' : c.credor || 'AGUA VERDE'}</td><td>${c.tipo}</td>
        <td>${c.id_lista ? 'lista #' + c.id_lista : (c.mes_referencia || '').slice(0, 7)}</td>
        <td>${fmt(-Number(c.valor_itens || 0))}</td><td>${Number(c.frete) ? fmt(-Number(c.frete)) : '—'}</td>
        <td>${Number(c.royalty) ? fmt(-Number(c.royalty)) : '—'}</td><td><b>${fmt(-Number(c.valor_total || 0))}</b></td>
        <td>${Number(c.valor_pago) ? fmt(Number(c.valor_pago)) : '—'}</td>
        <td><b>${c.status === 'PAGA' ? '—' : fmt(-falta(c))}</b></td>
        <td${c.vencida && c.status !== 'PAGA' ? ' style="color:#ff6b6b; font-weight:bold;"' : ''}>${c.vencimento ? c.vencimento.slice(8,10)+'/'+c.vencimento.slice(5,7) : '—'}${c.vencida && c.status !== 'PAGA' ? ' VENCIDA' : ''}</td>
        <td>${c.status === 'EM ABERTO' && Number(c.valor_pago) > 0 ? 'PAGA EM PARTE' : c.status}${c.pago_em ? ' em ' + c.pago_em.slice(8,10)+'/'+c.pago_em.slice(5,7) : ''}</td>
        <td>${c.validado_por ? c.validado_por + (c.validado_em ? ' em ' + c.validado_em.slice(8,10)+'/'+c.validado_em.slice(5,7) : '') : '—'}</td>
        ${dono ? `<td style="white-space:nowrap;">${c.status !== 'PAGA' ? `R$ <input type="number" min="0" step="0.01" inputmode="decimal" id="trpg_v_${c.id}" class="trc-in" value="${falta(c).toFixed(2)}" style="width:96px; text-align:right;">
          em <input type="date" id="trpg_d_${c.id}" class="trc-in" value="${trHoje()}">
          <button class="preset-btn" onclick="trPagar(${c.id})">lançar</button>` : ''}</td>` : ''}</tr>`).join('')}
      <tr class="liq"><td>TOTAL EM ABERTO</td><td></td><td></td><td>${abertas.length} cobrança(s)</td><td></td><td></td><td></td>
        <td><b>${fmt(-abertas.reduce((s, c) => s + Number(c.valor_total || 0), 0))}</b></td>
        <td>${fmt(abertas.reduce((s, c) => s + Number(c.valor_pago || 0), 0))}</td>
        <td><b>${fmt(-abertas.reduce((s, c) => s + falta(c), 0))}</b></td><td></td><td></td><td></td>${dono ? '<td></td>' : ''}</tr>
    </table></div>
    ${trEntradasBloco(entradas, contas, dono)}`;
}
// ENTRADAS QUE NAO BAIXARAM (01/10/2026). O banco diz de que filial e de que mes e cada
// entrada (vw_tr_pagamentos_saipos: vinculo explicito ou o texto "LISTA <FILIAL>
// MM/AAAA"); aqui so aparece a que ficou sem cobranca. Nada de adivinhar o mes pela
// data do deposito — foi isso que deslocou o "Pago" do Historico em um mes.
function trEntradasBloco(entradas, contas, dono) {
  if (!entradas || !entradas.length) return '';
  const dm = d => d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) : '—';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const mesAno = d => d ? String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '';
  const porque = e => e.situacao === 'SEM DESTINO' ? 'o texto não diz de que mês é a lista'
    : e.situacao === 'ESPERA O FECHAMENTO' ? `é da lista de ${mesAno(e.mes_referencia)}, que ainda não tem fechamento validado — baixa sozinha quando tiver`
    : 'estava vinculada a uma cobrança, mas o lançamento saiu do Saipos';
  const saldo = c => c.saldo != null ? Number(c.saldo) : Number(c.valor_total || 0);
  const abertasDe = u => contas.filter(c => c.unidade === u && c.tipo === 'MENSAL' && c.status === 'EM ABERTO' && c.credor !== 'MICHIRO');
  const vincular = (e, ix) => {
    if (e.situacao !== 'SEM DESTINO') return '—';
    if (e.id_titulo == null) return 'sem título no Saipos — só pelo texto';
    const ab = abertasDe(e.unidade);
    if (!ab.length) return 'nenhuma cobrança em aberto desta filial';
    return `<select id="trvinc_${ix}" class="trc-in">${ab.map(c => `<option value="${c.id}">${mesAno(c.mes_referencia)} — falta R$ ${fmt(saldo(c))}</option>`).join('')}</select>
          <button class="preset-btn" onclick="trVincular(${ix})">vincular</button>`;
  };
  return `
    <div class="section-label">Entradas das filiais no Saipos que não baixaram cobrança</div>
    <div class="caption-label">O dinheiro entrou na Água Verde, mas não foi para cobrança nenhuma.
      O conserto de sempre é escrever no lançamento do Saipos a filial e o mês da lista — “LISTA BOQUEIRAO 09/2026” — e ele baixa sozinho na carga seguinte.
      ${dono ? 'Ou diga aqui de qual cobrança é: o vínculo fica guardado e vale também nas próximas cargas.' : ''}</div>
    <div id="tabelaTrEntradas"><table>
      <tr><th>Entrou em</th><th>Filial</th><th>Valor</th><th>Texto no Saipos</th><th>Por que não baixou</th>${dono ? '<th>É de qual cobrança?</th>' : ''}</tr>
      ${entradas.map((e, ix) => `<tr>
        <td>${dm(e.data)}</td><td>${e.unidade}</td>
        <td><b>${fmt(Number(e.valor != null ? e.valor : e.valor_entrada || 0))}</b></td>
        <td style="text-align:left; white-space:normal;">${esc(e.descricao)}</td>
        <td style="text-align:left; white-space:normal;">${porque(e)}</td>
        ${dono ? `<td style="white-space:nowrap;">${vincular(e, ix)}</td>` : ''}</tr>`).join('')}
    </table></div>`;
}
// Vincular uma entrada do Saipos a uma cobranca (so o dono; tr_vincular_pagamento_lista).
// Entrada maior que o que falta (um deposito pagando dois meses), ou sobra de entrada ja
// vinculada em parte: vincula so a parte e o resto continua no quadro para a outra
// cobranca. A pergunta repete o que vai ser gravado. Desfazer, so pelo chat.
async function trVincular(ix) {
  const msg = document.getElementById('trContasMsg');
  const e = (window._trEntradas || [])[ix];
  const escolhida = document.getElementById('trvinc_' + ix)?.value;
  const c = (window._trContas || []).find(x => String(x.id) === String(escolhida));
  if (!e || !c) return;
  const avisa = (t, cor) => { if (msg) { msg.textContent = t; msg.style.color = cor; msg.scrollIntoView({ block: 'nearest' }); } };
  const falta = c.saldo != null ? Number(c.saldo) : Number(c.valor_total || 0);
  const valor = Number(e.valor || 0);
  const inteira = Math.abs(valor - Number(e.valor_entrada || 0)) <= 0.005;
  const parte = (!inteira || valor > falta + 0.005) ? Math.round(Math.min(valor, falta) * 100) / 100 : null;
  const usado = parte == null ? valor : parte;
  const resto = Math.round((falta - usado) * 100) / 100;
  const sobra = Math.round((valor - usado) * 100) / 100;
  const mes = String(c.mes_referencia || '').slice(5, 7) + '/' + String(c.mes_referencia || '').slice(0, 4);
  const dia = String(e.data || '').slice(8, 10) + '/' + String(e.data || '').slice(5, 7);
  if (!confirm(`Vincular R$ ${fmt(usado)} da entrada de ${dia} (“${e.descricao}”) à cobrança de ${c.unidade} ${mes}?\n`
      + (resto > 0.005 ? `Fica faltando R$ ${fmt(resto)} nessa cobrança.` : 'A cobrança fica PAGA.')
      + (sobra > 0.005 ? `\nSobram R$ ${fmt(sobra)} desta entrada para vincular a outra cobrança.` : '')
      + '\nNão dá para desfazer por aqui.')) return;
  avisoAcao('enviando', 'Vinculando a entrada…');
  const rv = await trRpcSeguro('tr_vincular_pagamento_lista', { p_id_titulo: e.id_titulo, p_id_cobranca: c.id, p_valor: parte, p_motivo: 'vinculado na tela Contas a pagar' });
  if (!rv.ok) return avisoAcao('erro', `✗ A entrada NÃO foi vinculada: ${await trErroDe(rv)}. Tente de novo.`);
  avisoAcao('ok', (resto > 0.005 ? `✓ Entrada vinculada a ${c.unidade} ${mes} — falta R$ ${fmt(resto)}.` : `✓ Entrada vinculada — cobrança de ${c.unidade} ${mes} PAGA.`) + ` Às ${avisoHora()}.`);
  LISTAS = null;   // o Historico fechado le a mesma cobranca: recarrega na proxima entrada na tela
  await trTelaContas();
}
// Lancar um pagamento (total ou parcial) numa cobranca. Nao tem desfazer pela
// tela, e as linhas sao parecidas (mesma filial, meses vizinhos): a pergunta
// repete exatamente o que vai ser gravado — filial, valor, data e o que fica faltando.
async function trPagar(id) {
  const msg = document.getElementById('trContasMsg');
  const c = (window._trContas || []).find(x => x.id === id);
  if (!c) return;
  const saldo = c.saldo != null ? Number(c.saldo) : Number(c.valor_total || 0);
  const valor = Math.round(Number(document.getElementById('trpg_v_' + id)?.value || 0) * 100) / 100;
  const quando = document.getElementById('trpg_d_' + id)?.value;
  const erro = (t) => avisoAcao('atencao', '! ' + t);
  if (!(valor > 0)) return erro('Informe o valor pago.');
  if (!quando) return erro('Informe a data do pagamento.');
  if (valor > saldo + 0.005) return erro(`O valor (R$ ${fmt(valor)}) é maior que o que falta (R$ ${fmt(saldo)}).`);
  const dia = quando.slice(8, 10) + '/' + quando.slice(5, 7) + '/' + quando.slice(0, 4);
  const resto = Math.round((saldo - valor) * 100) / 100;
  if (!confirm(`Lançar pagamento de ${c.unidade} — R$ ${fmt(valor)} — em ${dia}?\n`
      + (resto > 0 ? `Fica faltando R$ ${fmt(resto)}.` : 'A cobrança fica PAGA.')
      + '\nNão dá para desfazer por aqui.')) return;
  avisoAcao('enviando', 'Lançando o pagamento…');
  const r = await trRpcSeguro('tr_registrar_pagamento', { p_id: id, p_valor: valor, p_data: quando });
  if (!r.ok) return avisoAcao('erro', `✗ O pagamento NÃO foi lançado: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `✓ Pagamento de ${c.unidade} lançado: R$ ${fmt(valor)} em ${dia}${resto > 0 ? ` — falta R$ ${fmt(resto)}` : ' — cobrança PAGA'}. Às ${avisoHora()}.`);
  LISTAS = null;   // o Historico fechado le a mesma cobranca: recarrega na proxima entrada na tela
  await trTelaContas();
}
// ---- tela: fechamento do mes (SEPARACAO = Rita, e DONO) ----
// Mudou em 22/08/2026: a lista conferida NAO vira mais cobranca sozinha. As
// listas do mes fecham num documento so por unidade, no inicio do mes seguinte,
// e ele nasce EM VALIDACAO — a Rita confere o consolidado e valida; so entao
// vira conta a pagar na mesa da Hellen. Vencimento (dono, 01/10/2026): ultimo
// dia do mes seguinte para AHU/SÃO BRAZ (dia_pagamento 31), com baixa parcial
// conforme a filial paga; dia 20 para o Boqueirao. Tudo pela regra da unidade.
async function trTelaFechamento() {
  const alvo = document.getElementById('trTelaConteudo');
  const [rv, ru, ra] = await Promise.all([
    trFetch('vw_tr_fechamento_validar?order=unidade'),
    trFetch('tr_regras_unidade?select=unidade,dia_pagamento,vigencia_inicio&order=unidade,vigencia_inicio.desc'),
    trFetch('vw_tr_avulsos_pendentes?select=id,id_lista,unidade,status_lista,item,un_medida,qtd,avulso'),
  ]);
  if (!rv.ok) { alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">${await trErroDe(rv)}</div>`; return; }
  const esperando = await rv.json();
  window._trFechEsperando = esperando;   // a faixa do topo (20/10/2026) valida daqui
  const avulsos = ra.ok ? await ra.json() : [];
  const avulsosExtra = await trAvulsosExtra(avulsos);   // 18/10/2026: a Rita corrige aqui (trAvulsosBloco)
  // regras sao versionadas por vigencia (desde 01/09 ha duas por unidade):
  // o dropdown mostra so a vigente — a primeira de cada unidade, ja que a
  // consulta vem ordenada por vigencia decrescente.
  const regrasTodas = ru.ok ? await ru.json() : [];
  const regras = regrasTodas.filter((g, i) => regrasTodas.findIndex(x => x.unidade === g.unidade) === i);
  const mesPassado = (() => { const h = trHoje(); const d = new Date(h.slice(0,4), Number(h.slice(5,7)) - 1, 1);
    d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();

  alvo.innerHTML = `
    <div id="trFechFaixa"></div>
    <!-- 04/11/2026 (dono: "essa tabela de cima fechar mês tem necessidade? fechar cada bloco de cada empresa já não faz
         a mesma coisa?"): faz — o "fechar o mês" de cada cartão chama o mesmo tr_fechar_mes. Do quadro de cima fica só o
         MÊS, que escolhe o mês dos cartões. O select de filial fica escondido: é dele que sai a lista de filiais dos cartões. -->
    <div style="text-align:center; margin:4px 0 6px;">
      <label for="trFechMes" style="font-size:13px; color:var(--tx-2);">Mês:</label>
      <input type="month" id="trFechMes" min="${TR_FECH_DOC_INICIO}" value="${mesPassado}" style="background:#232321; border:1px solid #34332f; border-radius:6px; color:#fff; padding:4px 6px; margin-left:6px;">
      <select id="trFechUn" hidden>
        ${regras.map(g => `<option value="${g.unidade}">${g.unidade}</option>`).join('')}
      </select>
      <div id="trFechMsg" style="font-size:12px; margin-top:6px;"></div>
    </div>

    <div id="trFechGeral"></div>

    ${trAvulsosBloco(avulsos, avulsosExtra)}

    <div class="section-label">Esperando validação</div>
    ${!esperando.length ? '<div class="contexto">Nada esperando. Todo mês fechado já virou conta a pagar.</div>' : `
    <div class="caption-label">Confira o total e as diferenças antes de validar. Depois de validado vira conta a pagar
      — a regra atual cobra o que <b>saiu</b> da Água Verde; diferença é acerto do dono.</div>
    <div id="tabelaTrFech"><table>
      <tr><th>Filial</th><th>Mês</th><th>Listas</th><th>Itens</th><th>Frete</th><th>Royalty</th><th>Total</th><th>Vence</th><th>Diferenças</th><th></th></tr>
      ${esperando.map(f => `<tr>
        <td>${f.unidade}</td><td>${(f.mes_referencia || '').slice(0, 7)}</td>
        <td>${f.qtd_listas} lista(s)<br><span style="color:#8a897e; font-size:11px;">${f.itens} itens</span></td>
        <td>${fmt(-Number(f.valor_itens || 0))}</td>
        <td>${Number(f.frete) ? fmt(-Number(f.frete)) : '—'}</td>
        <td>${Number(f.royalty) ? fmt(-Number(f.royalty)) : '—'}</td>
        <td><b>${fmt(-Number(f.valor_total || 0))}</b></td>
        <td>${f.vencimento ? f.vencimento.slice(8,10)+'/'+f.vencimento.slice(5,7) : '—'}</td>
        <td${Number(f.itens_divergentes) ? ' style="color:#f5a623;"' : ''}>${Number(f.itens_divergentes)
            ? f.itens_divergentes + ' item(ns) · ' + fmt(Number(f.valor_divergencia || 0))
            : 'bateu 100%'}</td>
        <td><button class="preset-btn" onclick="trValidarFechamento(${f.id})">validar</button></td></tr>`).join('')}
    </table></div>`}`;
  trFechGeralMontar();
}

// ---- LINHA ESCRITA À MÃO, SEM PREÇO: a Rita corrige aqui (dono, 18/10/2026) ----
// "essa tela tem que ir pros avisos da Rita pra ela corrigir, tá passando batido essas correções".
// Quem tem papel DONO ou SEPARACAO (a Rita entra como compras@) resolve cada linha que a filial
// escreveu à mão: (1) liga a um item que JÁ está na grade, ativo ou inativo — o preço sai da grade
// pela MESMA regra do nascimento da linha (tr_preco_linha_grade, dentro de tr_avulso_corrigir);
// ninguém digita preço; ou (2) tira a linha com motivo (tr_avulso_tirar). Nome que não existe na
// grade fica no quadro: item novo é com o Neto. A pergunta "confirma?" mostra a SIMULAÇÃO do banco
// (p_simular): preço, valor da linha e total da lista exatos, antes de gravar, e os avisos do banco
// (unidade nova em lista ainda não separada; quanto a filial paga quando já saiu mercadoria). As
// recusas (unidade diferente com mercadoria saída, item já na lista, item sem custo, lista ou mês
// fechado) vêm do banco, em português. Embaixo, "corrigidos nos últimos 30 dias"
// (tr_avulso_corrigidos): é como o dono confere o que foi ligado e por quanto (revisão de 19/10).
// Cada linha é um cartão (os campos empilham no celular). Sem as funções no banco (SQL de 18/10
// ainda não aplicado) o quadro volta a ser o aviso antigo, "avise o Neto".
// SQL e ensaio: relatorios/caixa-plano-de-ataque-2026-10-10/avisos-2026-10-18/rita/.
async function trAvulsosExtra(avulsos) {
  const pode = !!TR_OP && ['DONO', 'SEPARACAO'].includes(TR_OP.papel);
  if (!pode) return { pode: false };
  try {
    const ids = (avulsos || []).map(a => a.id).filter(x => x != null);
    // sugestões por linha (dono, 23/10/2026: "ir incluindo por dedução conforme os nomes forem aparecendo");
    // sem a função no banco a linha só fica sem sugestão — a lista comum continua
    const sugDe = id => trRpc('tr_avulso_sugestoes', { p_id: id })
      .then(r => (r && r.ok ? r.json() : [])).catch(() => []);
    const [ro, rq, rc, rs] = await Promise.all([
      ids.length ? trRpc('tr_avulso_opcoes') : null,
      ids.length ? trFetch(`tr_lista_itens?id=in.(${ids.join(',')})&select=id,qtd_solicitada,qtd_separada,qtd_recebida,emb_separada,emb_recebida`) : null,
      null,   // tr_avulso_corrigidos: o bloco saiu da tela em 04/11/2026
      Promise.all(ids.map(sugDe)),
    ]);
    if (ids.length && !(ro && ro.ok)) return { pode: true, semFuncoes: true, corrigidos: [] };
    const corrigidos = rc && rc.ok ? await rc.json() : [];
    const qtds = {};
    if (rq && rq.ok) (await rq.json()).forEach(q => { qtds[q.id] = q; });
    const sugestoes = {};
    ids.forEach((id, k) => { sugestoes[id] = (rs && rs[k]) || []; });
    return { pode: true, opcoes: ro ? await ro.json() : [], qtds, corrigidos, sugestoes };
  } catch (e) { return { pode: true, semFuncoes: true, corrigidos: [] }; }
}
// o que já foi corrigido (dono confere): fechado por padrão; o título conta as ligações feitas
// numa linha de onde já tinha saído mercadoria (é ali que a escolha do item muda o que a filial paga)
function trAvulsosCorrigidosHtml(cs) {
  if (!cs || !cs.length) return '';
  const quando = s => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  // 04/11/2026 (dono: "se já foi corrigido e ainda aparece, confunde, dá a impressão que o usuário ainda tem que
  // fazer algo"): saiu o aviso laranja "N ligações com mercadoria que já tinha saído" e a marca por linha.
  // O registro fica só para consulta.
  return `<details style="text-align:left;"><summary style="cursor:pointer;"><b>Corrigidos nos últimos 30 dias: ${cs.length}</b></summary>
    ${cs.map(c => `<div style="border-top:1px solid var(--line); padding:5px 0; font-size:12px; line-height:1.5;">
      ${quando(c.feito_em)} · lista #${c.id_lista} · ${trEscH(c.unidade)} · “${trEscH(c.escrito)}” ${c.acao === 'LIGOU'
        ? `→ <b>${trEscH(c.item)}</b>${c.cobranca === 'NAO_COBRA' ? ' · não cobra' : c.cobranca === 'COBRA_NF' ? ' · cobra pela nota (sem 19%)' : c.cobranca === 'COBRA' ? ' · cobra' : ''}${
            c.sem_cobranca && !c.cobranca ? ' · sem cobrança' : (c.preco != null && c.cobranca !== 'NAO_COBRA' ? ` · R$ ${Number(c.preco).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} por ${trEscH(c.un)}` : '')}${c.valor != null ? ` · valor R$ ${fmt(Number(c.valor))}` : ''}`
        : `→ tirada da lista · motivo: ${trEscH(c.motivo)}`}
      · ${trEscH(c.feito_por)}</div>`).join('')}
  </details>`;
}
function trAvulsosBloco(avulsos, extra) {
  const lista = avulsos || [];
  // 04/11/2026 (dono: "pode eliminar tudo, o que foi corrigido já foi, não vejo motivo para consultar esses itens"):
  // o bloco "Corrigidos nos últimos 30 dias" saiu da tela. O registro continua no banco (tr_avulso_corrigidos).
  const feitos = '';
  if (!lista.length) return feitos ? `<div class="contexto" style="margin-top:12px; text-align:left;">${feitos}</div>` : '';
  const n = lista.length;
  const topo = `<b>⚠️ ${n} ${n === 1 ? 'item escrito' : 'itens escritos'} à mão, sem preço</b> — o mês não fecha com ${n === 1 ? 'ele' : 'eles'}.`;
  if (!extra || !extra.pode || extra.semFuncoes) {
    // sem papel de correção: quem corrige é a Rita (a mesma frase de tr_fechar_lista); com papel
    // mas sem as funções no banco (SQL de 18/10 ainda não aplicado): é com o Neto, como antes
    const quem = extra && extra.pode ? 'Avise o Neto para vincular:'
      : 'Avise a Rita: ela corrige em Listas · Financeiro → Fechamento do mês; depois é só fechar.';
    return `<div class="contexto" style="border-color:var(--farol-perto); margin-top:12px;">${topo}
      ${quem}<br>
      ${lista.map(a => `· <b>${trEscH(a.item)}</b> (${a.qtd == null ? '?' : String(Number(a.qtd)).replace('.', ',')} ${trEscH(a.un_medida || '')}, ${trEscH(a.unidade)}, lista #${a.id_lista})`).join('<br>')}
    </div>`;
  }
  window._trAvulsos = lista;
  window._trAvulsoSug = extra.sugestoes || {};
  window._trAvulsoOpc = extra.opcoes || [];   // unidade de cada item da lista comum (pergunta do fator)
  window._trAvulsoQtds = extra.qtds || {};
  const nq = v => v == null ? '—' : String(Number(v)).replace('.', ',');
  const opcoes = (extra.opcoes || []).map(o => `<option value="${trEscH(o.item)}">${trEscH([o.un, o.ativo ? '' : 'inativo', o.sem_custo ? 'sem custo' : ''].filter(Boolean).join(' · '))}</option>`).join('');
  // o valor que a sugestão põe no campo: o item da grade, ou o nome da base (fora da grade)
  const sugValor = s => s.origem === 'BASE' ? s.nome_base : s.item_da_grade;
  const sugOpcoes = id => (window._trAvulsoSug[id] || []).filter(s => s.pode_escolher)
    .map(s => `<option value="${trEscH(sugValor(s))}">${trEscH(['sugestão', s.un,
        s.origem === 'BASE' ? 'da base, entra na grade' : (s.item_ativo ? '' : 'inativo'),
        s.fornecedor ? 'fornecedor: pela nota' : '',
        s.precisa_fator ? `diga quanto 1 ${s.un_escrita} dá em ${s.un_item}` : ''].filter(Boolean).join(' · '))}</option>`).join('');
  const sugHtml = id => {
    const sg = (window._trAvulsoSug[id] || []).slice(0, 4);
    if (!sg.length) return '';
    return `<div style="font-size:12px; margin-top:6px;">Parece ser:${sg.map((s, k) => s.pode_escolher
      ? `<div style="margin-top:3px;"><button class="preset-btn" style="font-size:11px;" onclick="trAvulsoEscolhe(${id}, ${k})">${trEscH(sugValor(s))}</button> <span style="color:var(--tx-3);">${trEscH(s.frase)}</span></div>`
      : `<div style="margin-top:3px; color:var(--tx-3);">${trEscH(sugValor(s))} — ${trEscH(s.frase)}</div>`).join('')}</div>`;
  };
  const cartao = a => {
    const q = extra.qtds[a.id] || {};
    // saiu mercadoria = peso/medida OU contagem de pacotes, separado OU recebido (o banco confere igual)
    const saiu = [q.qtd_separada, q.qtd_recebida, q.emb_separada, q.emb_recebida].some(v => Number(v || 0) !== 0);
    const pacotes = Number(q.emb_separada || 0) !== 0 || Number(q.emb_recebida || 0) !== 0
      ? ` · pacotes ${nq(q.emb_separada)} · ${nq(q.emb_recebida)}` : '';
    const situacao = a.status_lista === 'SOLICITADA' ? ' · <span style="color:var(--farol-perto);">ainda não separada</span>' : '';
    const ligar = `<span style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; flex:1 1 260px; min-width:0;">
        <input list="travdl_${a.id}" id="travg_${a.id}" class="trc-in" placeholder="escolha a sugestão ou digite o item" style="flex:1 1 180px; min-width:0; max-width:340px;" oninput="trAvulsoFatorVer(${a.id})" onchange="trAvulsoFatorVer(${a.id})">
        <span id="travfw_${a.id}" style="display:none; align-items:center; gap:4px; flex:0 1 auto;">
          <label for="travf_${a.id}" id="travfl_${a.id}" style="font-size:12px;"></label>
          <input id="travf_${a.id}" class="trc-in" inputmode="decimal" placeholder="ex.: 5" style="width:70px;"></span>
        <datalist id="travdl_${a.id}">${sugOpcoes(a.id)}${opcoes}</datalist>
        <select id="travc_${a.id}" class="trc-in" title="obrigatório: esta linha é cobrada da filial?" style="flex:0 0 auto;">
          <option value="">cobra?</option><option value="COBRA">cobra</option><option value="NAO_COBRA">não cobra</option></select>
        <button class="preset-btn" onclick="trAvulsoCorrigir(${a.id})">corrigir</button></span>`;
    const tirar = saiu
      ? '<span style="color:var(--tx-3); font-size:12px;">saiu mercadoria: ligue a um item</span>'
      : `<span style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; flex:1 1 220px; min-width:0;">
        <input id="travm_${a.id}" class="trc-in" placeholder="ou o motivo de tirar" style="flex:1 1 150px; min-width:0; max-width:280px;">
        <button class="preset-btn" onclick="trAvulsoTirar(${a.id})">não vai na lista</button></span>`;
    return `<div style="border-top:1px solid var(--line); padding:8px 0;">
      <div><b>${trEscH(a.item)}</b> · lista #${a.id_lista} · ${trEscH(a.unidade)}${situacao}</div>
      <div style="font-size:12px;">pedido ${nq(q.qtd_solicitada)} · separado ${nq(q.qtd_separada)} · recebido ${nq(q.qtd_recebida)} ${trEscH(a.un_medida || '')}${pacotes}</div>
      ${a.avulso === false ? '' : sugHtml(a.id)}
      <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-top:6px;">${a.avulso === false
        ? '<span style="color:var(--tx-3); font-size:12px;">item da grade sem custo (não foi escrito à mão): o custo é com o Neto</span>'
        : ligar + tirar}</div>
    </div>`;
  };
  return `
    <div class="contexto" style="border-color:var(--farol-perto); margin-top:12px; text-align:left;">${topo}
      <div style="margin-top:4px; font-size:12px;">Escolha o item que a filial quis dizer <b>e marque se cobra ou não</b>: as sugestões vêm do nome que ela escreveu; digitando, aparece a grade ativa. O preço vem da grade (fornecedor: da nota, sem os 19%), ninguém digita. Se a filial escreveu em outra unidade (ex.: pacote) e o item é em KG, diga quanto 1 pacote dá em KG: pedido, separado e recebido mudam pelo mesmo número.
        Sugestão "da base" entra na grade na hora, sem aparecer no pedido das filiais. Não é item de lista? Escreva o motivo e tire. Nome que não está em lugar nenhum fica aqui: item novo é com o Neto.</div>
      <div id="trAvulsoMsg" style="font-size:12px; margin-top:4px;"></div>
      <div style="margin-top:6px;">${lista.map(cartao).join('')}</div>
      ${feitos ? `<div style="border-top:1px solid var(--line); padding-top:8px; margin-top:4px;">${feitos}</div>` : ''}
    </div>`;
}
function trAvulsoAvisa(t, cor) {
  // 29/10/2026: resultado de ação vai à barra do resultado (o redesenho apagava o recado)
  if (cor === 'var(--farol-ok)') return avisoAcao('ok', `✓ ${t} Às ${avisoHora()}.`);
  if (cor === 'var(--farol-fora)') return avisoAcao(/^Não deu/.test(t) ? 'erro' : 'atencao', /^Não deu/.test(t) ? `✗ ${t}. Tente de novo.` : `! ${t}`);
  const m = document.getElementById('trAvulsoMsg') || document.getElementById('trFechMsg');
  if (m) { m.textContent = t; m.style.color = cor; m.scrollIntoView({ block: 'nearest' }); }
}
// unidade 23/10/2026 (dono: "a unidade não pode entrar como correção pra Rita fazer também?"): o item escolhido é
// de outra unidade e já saiu mercadoria → aparece "quanto 1 <un escrita> dá em <un do item>?". A sugestão diz
// (precisa_fator); item digitado da lista comum, a tela compara a unidade. Quem confere de verdade é o banco.
function trAvulsoFatorVer(id) {
  const a = (window._trAvulsos || []).find(x => x.id === id);
  const campo = document.getElementById('travg_' + id);
  const wrap = document.getElementById('travfw_' + id);
  if (!a || !campo || !wrap) return;
  const v = (campo.value || '').trim();
  const s = ((window._trAvulsoSug || {})[id] || []).find(x => x.pode_escolher && (x.origem === 'BASE' ? x.nome_base : x.item_da_grade) === v);
  // 04/11/2026 (dono: "senti falta da marcação cobra pela NF"): item de fornecedor → a opção diz "pela NF".
  // O valor enviado continua COBRA; quem grava COBRA_NF é o banco (tr_avulso_corrigir).
  const optC = document.querySelector('#travc_' + id + ' option[value="COBRA"]');
  if (optC) optC.textContent = s && s.fornecedor ? 'cobra pela NF (sem 19%)' : 'cobra';
  let de = null, para = null;
  if (s && s.precisa_fator) { de = s.un_escrita; para = s.un_item; }
  else if (!s) {
    const o = (window._trAvulsoOpc || []).find(x => x.item === v);
    const q = ((window._trAvulsoQtds || {})[id]) || {};
    const saiu = [q.qtd_separada, q.qtd_recebida, q.emb_separada, q.emb_recebida].some(n => Number(n || 0) !== 0);
    if (o && o.un && a.un_medida && o.un !== a.un_medida && saiu) { de = a.un_medida; para = o.un; }
  }
  wrap.style.display = de ? 'inline-flex' : 'none';
  wrap.dataset.de = de || ''; wrap.dataset.para = para || '';
  if (de) document.getElementById('travfl_' + id).textContent = `quanto 1 ${de} dá em ${para}?`;
}
// "é este item da grade": simula no banco, mostra preço/valor/total e os avisos, e só então grava
async function trAvulsoCorrigir(id) {
  const a = (window._trAvulsos || []).find(x => x.id === id);
  const campo = document.getElementById('travg_' + id);
  const item = ((campo && campo.value) || '').trim();
  if (!a) return;
  if (!item) return trAvulsoAvisa('Escolha o item da grade no campo da linha.', 'var(--farol-fora)');
  const cobra = ((document.getElementById('travc_' + id) || {}).value || '');
  if (!cobra) return trAvulsoAvisa('Marque se cobra ou não cobra.', 'var(--farol-fora)');
  // nome da base fora da grade (sugestão 'BASE'): a correção cria o item na grade (inativo, fornecedor)
  const daBase = ((window._trAvulsoSug || {})[id] || []).some(s => s.origem === 'BASE' && s.pode_escolher && s.nome_base === item);
  const fn = daBase ? 'tr_avulso_corrigir_base' : 'tr_avulso_corrigir';
  const args = daBase ? { p_id: id, p_nome_base: item, p_cobranca: cobra } : { p_id: id, p_item: item, p_cobranca: cobra };
  // unidade 23/10/2026: o campo só existe quando o item é de outra unidade; aí é obrigatório
  const fw = document.getElementById('travfw_' + id);
  if (fw && fw.style.display !== 'none') {
    const ft = ((document.getElementById('travf_' + id) || {}).value || '').trim().replace(',', '.');
    const fator = Number(ft);
    if (!ft || !(fator > 0)) return trAvulsoAvisa(`Diga quanto 1 ${fw.dataset.de} dá em ${fw.dataset.para} (ex.: se 1 pacote tem 5 ${fw.dataset.para}, escreva 5).`, 'var(--farol-fora)');
    args.p_fator = fator;
  }
  const rs = await trRpc(fn, { ...args, p_simular: true });
  if (!rs.ok) return trAvulsoAvisa('Não deu: ' + await trErroDe(rs), 'var(--farol-fora)');
  const s = await rs.json();
  const reais = v => v == null ? '—' : 'R$ ' + fmt(Number(v));
  const preco = s.cobranca === 'NAO_COBRA' ? 'não cobra (marcado na correção)'
    : s.cobranca === 'COBRA_NF' && s.preco != null ? `cobra pela NF (sem 19%) · R$ ${Number(s.preco).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} por ${s.un}`
    : s.sem_cobranca ? 'sem cobrança (a grade diz que este item não é cobrado desta filial)'
    : s.preco == null ? 'o da grade' : `R$ ${Number(s.preco).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} por ${s.un}`;
  const valores = s.valor_linha == null && s.total_lista_antes == null ? ''
    : `Valor desta linha: ${reais(s.valor_linha)}. Total da lista: ${reais(s.total_lista_antes)} → ${reais(s.total_lista_depois)}.\n`;
  if (!confirm(`Ligar “${s.escrito}” (lista #${s.id_lista}, ${s.unidade}) a ${s.item}${s.criou_na_grade
        ? ' (item da base: entra na grade agora, inativo — não aparece no pedido das filiais)'
        : s.item_ativo ? '' : ' (item inativo da grade)'}?\n`
      + (s.conversao ? `Unidade: ${s.conversao}.\n` : '')
      + `Preço: ${preco}.${s.regra && s.cobranca !== 'NAO_COBRA' ? ' ' + s.regra + '.' : ''} Ninguém digita.\n`
      + valores
      + (s.aviso ? '\n⚠️ ' + String(s.aviso).split('\n').join('\n⚠️ ') + '\n\n' : '')
      + 'O que a filial escreveu fica guardado na observação da linha.')) return;
  avisoAcao('enviando', 'Corrigindo a linha…');
  const r = await trRpcSeguro(fn, { ...args, p_simular: false });
  if (!r.ok) return trAvulsoAvisa('Não deu: ' + await trErroDe(r), 'var(--farol-fora)');
  LISTAS = null;   // o Histórico e as listas leem o mesmo valor: recarregam na próxima entrada
  await trTelaFechamento();
  trAvulsoAvisa(`Corrigido: “${s.escrito}” agora é ${s.item}${s.conversao ? ' · ' + s.conversao : ''} · ${cobra === 'NAO_COBRA' ? 'não cobra' : s.cobranca === 'COBRA_NF' ? 'cobra pela NF (sem 19%)' : 'cobra'}.`, 'var(--farol-ok)');
}
// o botão da sugestão só preenche o campo; quem corrige é o "corrigir" (com a simulação e a pergunta)
function trAvulsoEscolhe(id, k) {
  const s = ((window._trAvulsoSug || {})[id] || [])[k];
  const campo = document.getElementById('travg_' + id);
  if (!s || !campo) return;
  campo.value = s.origem === 'BASE' ? s.nome_base : s.item_da_grade;
  trAvulsoFatorVer(id);
  const f = s.precisa_fator && document.getElementById('travf_' + id);
  (f || campo).focus();
  trAvulsoAvisa(s.frase || '', 'var(--tx-2)');
}
// "não vai na lista": o banco confere (simulação) antes da pergunta; o motivo fica no registro
async function trAvulsoTirar(id) {
  const a = (window._trAvulsos || []).find(x => x.id === id);
  const campo = document.getElementById('travm_' + id);
  const motivo = ((campo && campo.value) || '').trim();
  if (!a) return;
  if (motivo.length < 3) return trAvulsoAvisa('Escreva o motivo para tirar a linha.', 'var(--farol-fora)');
  const rs = await trRpc('tr_avulso_tirar', { p_id: id, p_motivo: motivo, p_simular: true });
  if (!rs.ok) return trAvulsoAvisa('Não deu: ' + await trErroDe(rs), 'var(--farol-fora)');
  if (!confirm(`Tirar “${a.item}” da lista #${a.id_lista} (${a.unidade})?\nMotivo: ${motivo}\n`
      + 'O que a filial escreveu fica guardado no registro.')) return;
  avisoAcao('enviando', 'Tirando a linha da lista…');
  const r = await trRpcSeguro('tr_avulso_tirar', { p_id: id, p_motivo: motivo, p_simular: false });
  if (!r.ok) return trAvulsoAvisa('Não deu: ' + await trErroDe(r), 'var(--farol-fora)');
  LISTAS = null;
  await trTelaFechamento();
  trAvulsoAvisa(`Tirado da lista #${a.id_lista}: “${a.item}”.`, 'var(--farol-ok)');
}

// ---- CONFERENCIA ANTES DE FECHAR + DOCUMENTO DE FECHAMENTO (dono, 01/10/2026) ----
// "seria legal eu conseguir ver um geral antes de bater o martelo no fechamento" e
// "coloca na fila a geracao de um PDF com o fechamento final" — o documento que ele
// monta a mao todo mes para a Loana (Boqueirao); Ahu e Sao Braz ganham o delas.
// A TELA NAO FAZ CONTA: os numeros vem prontos do banco (vw_tr_fech_doc_resumo, _itens e
// _listas — script/fechamento_documento_listas.sql), que le da mesma fonte de
// tr_fechar_mes. Antes de fechar (PREVIA) e exatamente o que o fechamento vai gravar;
// depois de fechado e o que esta gravado na cobranca (o mesmo de Contas a pagar).
// O documento na tela e o PDF sao o MESMO html (trFechDocHtml): na tela ele entra num
// iframe, no PDF numa janela de impressao (mesmo mecanismo de trImprimirSeparacao).
// Sem as views no banco (arquivo ainda nao aplicado) o quadro nao aparece e a tela
// fica como era.
// O PRIMEIRO MES COM DOCUMENTO (dono, 01/10/2026: "pode esconder"): antes de agosto/2026
// nao ha quadro, nem documento, nem mes no seletor — julho do Boqueirao sairia com uma linha
// de diferenca de R$ 810,35 (a planilha final nao bate com as linhas guardadas). E o mesmo
// corte do Historico (mes=gte.2026-08-01); o anterior vive nas planilhas aposentadas.
const TR_FECH_DOC_INICIO = '2026-08';
// O PRIMEIRO MES EM QUE A SEPARACAO PESA E CONTA (01/10/2026). Antes dele ninguem contava e o
// documento deduz a embalagem da grade; dele em diante, peso sem contagem NAO vira embalagem
// (a linha sem contagem e a que foi so pesada) — ver trFechDocEmb.
const TR_FECH_CONTAGEM_INICIO = '2026-10';
function trFechData(d) { return d ? String(d).slice(8, 10) + '/' + String(d).slice(5, 7) + '/' + String(d).slice(0, 4) : '—'; }
function trFechMesTxt(mes) { return trMesNome(mes + '-01') + '/' + String(mes).slice(0, 4); }   // "setembro/2026"
// o estado de uma filial no mes, em palavra de operador + a borda do cartao
function trFechSituacao(r) {
  if (!r) return { txt: 'sem lista neste mês', cls: 'neutral', cor: 'var(--tx-3)' };
  if (r.situacao === 'PREVIA') return r.pode_fechar
    ? { txt: 'pronto para fechar', cls: 'pos', cor: 'var(--farol-ok)' }
    : { txt: 'não fecha ainda', cls: 'neg', cor: 'var(--farol-fora)' };
  if (r.cobranca_status === 'EM VALIDACAO') return { txt: 'fechado — falta validar', cls: 'neutral', cor: 'var(--farol-perto)' };
  if (r.cobranca_status === 'PAGA') return { txt: 'fechado e pago', cls: 'neutral', cor: 'var(--farol-ok)' };
  if (r.cobranca_status === 'EM ABERTO') return { txt: Number(r.valor_pago) > 0 ? 'fechado — pago em parte' : 'fechado — a receber', cls: 'neutral', cor: 'var(--tx-2)' };
  return { txt: 'fechado', cls: 'neutral', cor: 'var(--tx-2)' };
}
// chamada no fim de trTelaFechamento: o quadro acompanha o mes do seletor de cima
function trFechGeralMontar() {
  const inp = document.getElementById('trFechMes');
  if (!inp || !document.getElementById('trFechGeral')) return;
  if (window._trFechMesSel) inp.value = window._trFechMesSel;   // a tela e redesenhada depois de fechar/validar
  inp.addEventListener('change', trFechGeral);
  trFechGeral();
}
// O QUADRO: as filiais lado a lado no mes escolhido — listas, itens, frete, royalty,
// total, o que trava — e, em cada uma, ver o documento, gerar o PDF e fechar.
async function trFechGeral() {
  const inp = document.getElementById('trFechMes');
  const sel = document.getElementById('trFechUn');
  if (!inp || !inp.value || !document.getElementById('trFechGeral')) return;
  const mes = inp.value;                       // AAAA-MM
  window._trFechMesSel = mes;
  if (mes < TR_FECH_DOC_INICIO) {              // digitado a mao: o seletor ja nao oferece
    window._trFechGeral = null;
    document.getElementById('trFechGeral').innerHTML = `
    <div class="section-label">Fechamento — ${trFechMesTxt(mes)}</div>
    <div class="caption-label" style="text-align:center;">A conferência e o documento de fechamento começam em ${trFechMesTxt(TR_FECH_DOC_INICIO)}. O que veio antes está nas planilhas aposentadas.</div>`;
    return;
  }
  let r;
  try { r = await trFetch(`vw_tr_fech_doc_resumo?mes=eq.${mes}-01&order=unidade`); } catch (e) { return; }
  const alvo = document.getElementById('trFechGeral');
  if (!alvo || window._trFechMesSel !== mes) return;   // trocou de mes (ou de tela) enquanto a resposta vinha
  if (!r.ok) {
    // 404 = as views ainda nao existem no banco: a tela fica como era
    alvo.innerHTML = r.status === 404 ? '' : `<div class="contexto" style="border-color:var(--farol-fora);">Não consegui montar a conferência do mês: ${trEscH(await trErroDe(r))}</div>`;
    return;
  }
  const linhas = await r.json();
  const filiais = [...new Set([...(sel ? [...sel.options].map(o => o.value) : []), ...linhas.map(x => x.unidade)])].filter(Boolean);
  window._trFechGeral = { mes, filiais, linhas };
  const nu = (v) => Number(v) || 0;
  const linha = (rot, val) => `<div style="display:flex; justify-content:space-between; gap:10px; padding:4px 0; border-bottom:1px solid var(--line);"><span style="white-space:nowrap;">${rot}</span><span style="text-align:right; color:var(--tx-1);">${val}</span></div>`;
  const cinza = (t) => `<span style="color:var(--tx-3);">${t}</span>`;
  const cartoes = filiais.map((u, ix) => {
    const x = linhas.find(l => l.unidade === u);
    const s = trFechSituacao(x);
    const cab = `<div class="card-lbl">${trEscH(u)} · <b style="color:${s.cor};">${s.txt}</b></div>`;
    if (!x) return `<div class="card neutral" style="text-align:left;">${cab}</div>`;
    const comValor = x.valor_total != null;      // login sem valores recebe os R$ vazios
    const abertas = nu(x.listas_abertas), entregas = nu(x.frete_entregas), diretas = nu(x.frete_direto_entregas);
    const frete = x.frete_na_conta || nu(x.frete)
      ? `R$ ${fmt(nu(x.frete))}${entregas ? ' ' + cinza(`(${entregas} ${entregas === 1 ? 'entrega' : 'entregas'})`) : ''}`
      : (diretas ? `<span style="color:var(--tx-3);" title="${diretas} ${diretas === 1 ? 'entrega' : 'entregas'} do Michiro que a própria loja paga — não entra neste total.">loja paga direto: R$ ${fmt(nu(x.frete_direto))}</span>` : '—');
    return `<div class="card ${s.cls}" style="text-align:left;">
      ${cab}
      <div class="card-val">${comValor ? 'R$ ' + fmt(nu(x.valor_total)) : '—'}</div>
      <div class="card-pct" style="font-size:12.5px;">${x.vencimento ? 'vence em ' + trFechData(x.vencimento) : '&nbsp;'}</div>
      <div style="margin-top:10px; font-size:12.5px; color:var(--tx-2);">
        ${linha('Listas', `${x.listas}${abertas ? ` · <span style="color:var(--farol-fora);">${abertas} sem conferir</span>` : (x.situacao === 'PREVIA' && nu(x.listas) ? ' · todas conferidas' : '')}`)}
        ${comValor ? linha('Itens', `R$ ${fmt(nu(x.valor_itens))}`) : ''}
        ${comValor ? linha('Frete Michiro', frete) : ''}
        ${comValor ? linha('Royalty', nu(x.royalty) ? `R$ ${fmt(nu(x.royalty))}` : '—') : ''}
        ${comValor && nu(x.ajustes) ? linha('Ajustes', `R$ ${fmt(nu(x.ajustes))}`) : ''}
        ${comValor && x.origem === 'COBRANCA' && x.cobranca_status !== 'EM VALIDACAO' ? linha('Já pago · falta', `R$ ${fmt(nu(x.valor_pago))} · <b>R$ ${fmt(nu(x.saldo))}</b>`) : ''}
      </div>
      ${(x.trava || []).length ? `<div style="margin-top:8px; font-size:12.5px; color:var(--farol-fora);"><b>O que trava:</b>${x.trava.map(t => '<br>• ' + trEscH(t)).join('')}</div>` : ''}
      ${comValor && nu(x.valor_itens_abertas) ? `<div style="margin-top:6px; font-size:12.5px; color:var(--farol-perto);">R$ ${fmt(nu(x.valor_itens_abertas))} dos itens vêm de lista ainda não conferida — pode mudar.</div>` : ''}
      ${(x.avisos || []).length ? `<div style="margin-top:6px; font-size:12.5px; color:var(--farol-perto);">${x.avisos.map(t => '• ' + trEscH(t)).join('<br>')}</div>` : ''}
      ${comValor ? `<div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:6px;">
        <button class="preset-btn" onclick="trFechDocVer(${ix})">ver o documento</button>
        <button class="preset-btn" onclick="trFechDocPdf(${ix})">Gerar PDF</button>
        ${x.pode_fechar ? `<button class="preset-btn" style="border-color:var(--farol-ok); color:var(--tx-1);" onclick="trFechFecharDaqui(${ix})">fechar o mês</button>` : ''}
      </div>` : ''}
    </div>`;
  });
  const comTotal = linhas.filter(x => x.valor_total != null);
  const soma = comTotal.length > 1
    ? `<div class="caption-label" style="text-align:center;">As ${comTotal.length} filiais juntas: itens <b>R$ ${fmt(comTotal.reduce((t, x) => t + nu(x.valor_itens), 0))}</b> · total <b>R$ ${fmt(comTotal.reduce((t, x) => t + nu(x.valor_total), 0))}</b></div>` : '';
  const av = window._trFechAviso; window._trFechAviso = null;
  // 29/10/2026: o resultado do fechamento vai à barra do resultado (a faixa se redesenhava e o recado sumia)
  if (av) avisoAcao(av.ok ? 'ok' : 'erro', `${av.ok ? '✓' : '✗'} ${av.txt} Às ${avisoHora()}.`);
  const fx = document.getElementById('trFechFaixa');
  if (fx) fx.innerHTML = trFechFaixa(linhas, filiais, mes, null);   // o aviso do que acabou de acontecer vai na faixa
  const temPrevia = linhas.some(x => x.situacao === 'PREVIA');
  alvo.innerHTML = `
    <div class="section-label">${temPrevia || !linhas.length ? 'Conferência antes de fechar' : 'Fechamento'} — ${trFechMesTxt(mes)}</div>
    <div class="caption-label" style="text-align:center;">${!linhas.length
      ? 'Nenhuma filial tem lista neste mês.'
      : temPrevia
      ? 'O total de cada filial é o que o fechamento grava. Abra o documento, confira e só então feche.'
      : linhas.some(x => x.origem === 'CONGELADO')
      ? 'O total de cada filial é o valor em que o mês foi fechado — o mesmo do Histórico.'
      : 'O total de cada filial é o que ficou gravado no fechamento — o mesmo de Contas a pagar.'}</div>
    ${av && !fx ? `<div class="contexto" style="margin:8px auto; border-color:${av.ok ? 'var(--farol-ok)' : 'var(--farol-fora)'};">${trEscH(av.txt)}</div>` : ''}
    <div class="cards" style="grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); align-items:start;">${cartoes.join('')}</div>
    ${soma}
    <div id="trFechDocTela"></div>`;
}
// busca o documento de UMA filial no mes: o quadro, a tabela e as listas
async function trFechDocDados(unidade, mes) {
  if (String(mes) < TR_FECH_DOC_INICIO) return { erro: `Não há documento de ${trFechMesTxt(mes)} — o documento de fechamento começa em ${trFechMesTxt(TR_FECH_DOC_INICIO)}.` };
  const f = `unidade=eq.${encodeURIComponent(unidade)}&mes=eq.${mes}-01`;
  try {
    const rs = await Promise.all([
      trFetch(`vw_tr_fech_doc_resumo?${f}`),
      trFetch(`vw_tr_fech_doc_itens?${f}&order=categoria,item,un`),
      trFetch(`vw_tr_fech_doc_listas?${f}&order=data_pedido,id_lista`),
    ]);
    for (const x of rs) if (!x.ok) return { erro: 'Não consegui montar o documento: ' + await trErroDe(x) };
    const res = (await rs[0].json())[0];
    if (!res) return { erro: `Não há lista de ${unidade} em ${trFechMesTxt(mes)}.` };
    if (res.valor_total == null) return { erro: 'Seu login não vê valores — o documento de fechamento não é gerado.' };
    // a grade da filial (embalagem e unidade de cada item), para escrever "8 rolos" ao lado
    // de "2.000"; se ela nao vier, o documento sai so na unidade, como antes
    let cat = {};
    try { cat = await trCatMapa(unidade); } catch (e) { cat = {}; }
    return { res, itens: await rs[1].json(), listas: await rs[2].json(), cat };
  } catch (e) { return { erro: 'Não consegui falar com o banco — tente de novo.' }; }
}
// O DOCUMENTO (um html so, para a tela e para o PDF): cabecalho, tabela categoria > item
// > unidade > quantidade > total com subtotal por categoria, quadro final e as listas.
// A4 retrato, preto e branco. Cores escritas a mao de proposito: e outro documento, sem
// o :root do painel (as mesmas da folha de separacao).
// ARREDONDAMENTO: cada item sai com 2 casas e o subtotal da categoria e a soma do que
// esta impresso; a cobranca soma todas as casas e arredonda uma vez. A diferenca (centavos)
// vem do banco e sai numa linha propria antes do TOTAL — nunca ha dois totais.
function trFechDocHtml(d, opc = {}) {
  const r = d.res, e = trEscH, nu = (v) => Number(v) || 0;
  const cent = (v) => Math.round(nu(v) * 100);
  const mesNome = trMesNome(r.mes), ano = String(r.mes).slice(0, 4);
  const titulo = `Fechamento das listas — ${r.unidade} — ${mesNome}/${ano}`;
  const previa = r.situacao === 'PREVIA';
  const sit = previa ? ['PRÉVIA', 'mês ainda não fechado']
    : r.cobranca_status === 'EM VALIDACAO' ? ['FECHADO', 'aguardando validação']
    : ['FECHADO', r.fechado_em ? 'em ' + trFechData(r.fechado_em) : ''];
  const dm = (x) => x ? String(x).slice(8, 10) + '/' + String(x).slice(5, 7) : '—';
  const entregasTxt = (n) => `${n} ${n === 1 ? 'entrega' : 'entregas'}`;

  // --- tabela: categoria > item ---
  const cats = [];
  (d.itens || []).forEach(i => { let c = cats.find(x => x.nome === i.categoria); if (!c) cats.push(c = { nome: i.categoria, itens: [] }); c.itens.push(i); });
  let impresso = 0;                                   // em centavos
  // a conta da grade so vale em mes inteiro do painel: a embalagem da grade descreve como o
  // PAINEL pede; lista da era planilha tinha a unidade propria dela (CX, FD, RL)
  const doPainel = (d.listas || []).length > 0 && d.listas.every(l => l.fonte === 'PAINEL');
  let temEmb = false;
  const emb = (i) => {
    const x = trFechDocEmb(i, d.cat, doPainel, String(r.mes || '').slice(0, 7));
    if (!x) return '';
    temEmb = true;
    return ` <span class="emb"><span class="pt">· </span>${trNum(x.n)} ${e(trEmbPlural(x.nome, x.n))}</span>`;
  };
  const corpo = cats.map(c => {
    const sub = c.itens.reduce((s, i) => s + cent(i.valor), 0);
    impresso += sub;
    const uns = [...new Set(c.itens.map(i => i.un))];
    const qtdSub = uns.length === 1 ? trNum(c.itens.reduce((s, i) => s + nu(i.qtd), 0), 4) : '';
    return `<tr class="cat"><td colspan="4">${e(c.nome)}</td></tr>`
      + c.itens.map(i => `<tr><td>${e(previa && i.nome_base ? i.nome_base : i.item)}${previa && i.tem_aberta ? ' *' : ''}</td><td>${e(i.un || '')}</td>
        <td class="n">${trNum(i.qtd, 4)}${emb(i)}</td>
        <td class="n">${i.sem_preco ? (cent(i.valor) ? fmt(nu(i.valor)) + ' + sem preço' : 'sem preço') : i.sem_cobranca ? 'sem cobrança' : fmt(nu(i.valor))}</td></tr>`).join('')
      + `<tr class="sub"><td colspan="2">Total ${e(c.nome)}</td><td class="n">${qtdSub}</td><td class="n">${c.itens.every(i => i.sem_cobranca) ? 'sem cobrança' : fmt(sub / 100)}</td></tr>`;
  }).join('');
  // diferenca para o valor fechado: ate 5 centavos e arredondamento (o banco diz em
  // diferenca_relevante) e entra na linha de centavos; acima disso ganha linha propria
  const ajustes = [];
  const centavos = cent(r.arredondamento) + (r.diferenca_relevante ? 0 : cent(r.diferenca_fechado));
  if (centavos) ajustes.push(['Arredondamento de centavos — cada item sai com 2 casas; a cobrança soma tudo e arredonda uma vez', centavos / 100]);
  if (r.diferenca_relevante) ajustes.push(['Diferença para o valor fechado — a soma das linhas de hoje não é a do fechamento; vale o valor fechado', r.diferenca_fechado]);
  const fecha = impresso + cent(r.arredondamento) + cent(r.diferenca_fechado) === cent(r.valor_itens);

  // --- quadro final ---
  const comp = [['LISTA', r.valor_itens]];
  if (nu(r.royalty)) comp.push(['ROYALTIES', r.royalty]);
  if (r.frete_na_conta || nu(r.frete)) comp.push(['FRETE MICHIRO' + (nu(r.frete_entregas) ? ` (${entregasTxt(nu(r.frete_entregas))})` : ''), r.frete]);
  if (nu(r.ajustes)) comp.push(['AJUSTES', r.ajustes]);
  const quadro = comp.length === 1
    ? `<tr class="tot"><td>TOTAL (LISTA)</td><td class="n">R$ ${fmt(nu(r.valor_total))}</td></tr>`
    : comp.map(([a, v]) => `<tr><td>${a}</td><td class="n">R$ ${fmt(nu(v))}</td></tr>`).join('')
      + `<tr class="tot"><td>TOTAL</td><td class="n">R$ ${fmt(nu(r.valor_total))}</td></tr>`;
  const info = [];
  if (r.vencimento) info.push(`<b>Vencimento: ${trFechData(r.vencimento)}</b>`);
  if (r.origem === 'COBRANCA' && r.cobranca_status === 'PAGA') info.push(`Pago: R$ ${fmt(nu(r.valor_pago))}${r.pago_em ? ' (último pagamento em ' + trFechData(r.pago_em) + ')' : ''}`);
  else if (r.origem === 'COBRANCA' && nu(r.valor_pago)) info.push(`Já pago: R$ ${fmt(nu(r.valor_pago))} · <b>Falta: R$ ${fmt(nu(r.saldo))}</b>`);
  if (!r.frete_na_conta && nu(r.frete_direto_entregas)) info.push(`${entregasTxt(nu(r.frete_direto_entregas))} do Michiro pagas direto pela loja: R$ ${fmt(nu(r.frete_direto))} (não entram neste total)`);

  // --- avisos da previa ---
  const notas = [];
  if (previa) {
    (r.trava || []).forEach(t => notas.push('Falta para fechar: ' + e(t) + '.'));
    if (nu(r.valor_itens_abertas)) notas.push(`R$ ${fmt(nu(r.valor_itens_abertas))} deste total vêm de lista ainda não conferida (marcada com *) e podem mudar.`);
    (r.avisos || []).forEach(t => notas.push('Atenção: ' + e(t) + '.'));
  }
  if (!fecha) notas.push('ATENÇÃO: a soma das linhas não fechou com o total — não envie este documento e avise o Neto.');

  // --- as listas do mes ---
  // 04/11/2026 (dono, 18:33: "porque a lista 30779 está como falta fechar?"): RECEBIDA conferida inteira e com
  // preço fecha sozinha no fechamento do mês (tr_fechar_mes) e já não vem `aberta` → só "conferida"
  const sitLista = (l) => l.fonte !== 'PAINEL' ? '—'
    : l.status === 'RECEBIDA' ? (l.aberta ? 'conferida — falta preço ou conferência de item' : 'conferida')
    : ({ SOLICITADA: 'pedida — falta separar', SEPARADA: 'separada — falta enviar', ENVIADA: 'enviada — falta conferir', RECEBIDA: 'conferida — falta fechar', FECHADA: 'conferida' }[l.status] || e(l.status));
  const listas = (d.listas || []).map(l => `<tr><td>${l.fonte === 'PAINEL' ? '#' + l.id_lista : 'planilha'}${l.aberta ? ' *' : ''}</td><td>${dm(l.data_pedido)}</td><td>${dm(l.data_entrega)}</td>
      <td>${sitLista(l)}</td><td>${l.michiro ? 'sim' + (l.frete_outro_mes ? ' (frete de ' + dm(l.frete_data) + ')' : '') : (l.fonte === 'PAINEL' ? 'não' : '—')}</td>
      <td class="n">${fmt(nu(l.valor))}</td></tr>`).join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(titulo)}</title><style>
    @page { size:A4 portrait; margin:12mm; }
    * { box-sizing:border-box; }
    body { font-family:Arial, Helvetica, sans-serif; color:#000; background:#fff; margin:0; padding:18px; font-size:12px; line-height:1.3; }
    .folha { max-width:760px; margin:0 auto; }
    .topo { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; border-bottom:2px solid #000; padding-bottom:8px; }
    .marca { font-size:11px; letter-spacing:1.5px; text-transform:uppercase; color:#45443f; }
    h1 { font-size:19px; margin:2px 0 3px; }
    .sub { font-size:12px; color:#45443f; }
    .sit { border:2px solid #000; padding:6px 12px; text-align:center; font-weight:bold; font-size:15px; letter-spacing:1px; white-space:nowrap; }
    .sit small { display:block; font-size:10px; font-weight:normal; letter-spacing:0; }
    .sit.previa { border-style:dashed; }
    .notas { border:1px solid #000; padding:6px 10px; margin-top:10px; font-size:11.5px; }
    .notas div + div { margin-top:3px; }
    h2 { font-size:11px; text-transform:uppercase; letter-spacing:.5px; margin:16px 0 4px; }
    table { width:100%; border-collapse:collapse; }
    thead { display:table-header-group; }
    tr { page-break-inside:avoid; }
    td, th { border-bottom:1px solid #bbb; padding:3px 6px; text-align:left; vertical-align:top; }
    th { font-size:10px; text-transform:uppercase; color:#45443f; border-bottom:1.5px solid #000; }
    .n { text-align:right; white-space:nowrap; }
    .emb { color:#45443f; }
    tr.cat { page-break-after:avoid; }
    tr.cat td { font-weight:bold; text-transform:uppercase; font-size:11px; padding-top:9px; border-bottom:1px solid #000; }
    tr.sub td { font-weight:bold; }
    tr.aj td { font-style:italic; color:#45443f; }
    tr.tot td { font-weight:bold; font-size:13.5px; border-top:2px solid #000; border-bottom:2px solid #000; }
    .fim { display:flex; justify-content:space-between; align-items:flex-start; gap:18px; margin-top:16px; page-break-inside:avoid; }
    .info { font-size:12px; }
    .info div + div { margin-top:4px; }
    .quadro { width:320px; flex:none; border:2px solid #000; }
    .quadro td { padding:6px 10px; font-size:13px; }
    .quadro tr.tot td { font-size:15px; border-bottom:none; }
    .rodape { margin-top:14px; font-size:10px; color:#45443f; }
    .naoimprime { float:right; padding:8px 14px; margin:0 0 8px 8px; }
    @media (max-width:560px) { body { padding:10px; font-size:11.5px; } .topo, .fim { display:block; } .sit { display:inline-block; margin-top:8px; } .quadro { width:100%; margin-top:10px; } td, th { padding:4px 3px; } .emb { display:block; font-size:10.5px; } .emb .pt { display:none; } .naoimprime { float:none; display:block; width:100%; margin:0 0 10px; } }
    @media print { .naoimprime { display:none; } body { padding:0; } }
  </style></head><body><div class="folha">
    ${opc.botao ? '<button class="naoimprime" onclick="window.print()">Imprimir / salvar PDF</button>' : ''}
    <div class="topo">
      <div><div class="marca">Cidadão do Mundo</div>
        <h1>Fechamento das listas — ${e(r.unidade)}</h1>
        <div class="sub">${mesNome.charAt(0).toUpperCase() + mesNome.slice(1)} de ${ano} · ${nu(r.listas)} ${nu(r.listas) === 1 ? 'lista' : 'listas'} · emitido em ${trFechData(trHoje())}</div></div>
      <div class="sit${previa ? ' previa' : ''}">${sit[0]}<small>${sit[1]}</small></div>
    </div>
    ${notas.length ? `<div class="notas">${notas.map(t => '<div>' + t + '</div>').join('')}</div>` : ''}
    <table style="margin-top:10px;">
      <thead><tr><th>Categoria / item</th><th>Un.</th><th class="n">Quantidade</th><th class="n">Total (R$)</th></tr></thead>
      <tbody>${corpo || '<tr><td colspan="4">Nenhum item neste mês.</td></tr>'}
        ${ajustes.map(([t, v]) => `<tr class="aj"><td colspan="3">${t}</td><td class="n">${fmt(nu(v))}</td></tr>`).join('')}
        <tr class="tot"><td colspan="3">TOTAL DAS LISTAS</td><td class="n">${fmt(nu(r.valor_itens))}</td></tr>
      </tbody>
    </table>
    <div class="fim">
      <div class="info">${info.map(t => '<div>' + t + '</div>').join('')}</div>
      <table class="quadro">${quadro}</table>
    </div>
    ${listas ? `<h2>Listas do mês</h2>
    <table><thead><tr><th>Lista</th><th>Pedido</th><th>Entrega</th><th>Situação</th><th>Michiro levou</th><th class="n">Valor (R$)</th></tr></thead>
      <tbody>${listas}</tbody></table>` : ''}
    <div class="rodape">Quantidade = a recebida na conferência (sem conferência, a separada).${temEmb ? ' Rolos, pacotes e caixas = as embalagens contadas na separação e na conferência; nas listas sem contagem, a quantidade dividida pelo tamanho da embalagem do item.' : ''} Valor = preço da tabela na data do pedido. O valor de cada lista é arredondado; vale o total do quadro.</div>
  </div></body></html>`;
}
// "ver o documento": a mesma folha do PDF, na tela
async function trFechDocVer(ix) {
  const g = window._trFechGeral;
  if (!g) return;
  const mes = g.mes;
  return trFechDocAbrir(g.filiais[ix], mes, () => !!window._trFechGeral && window._trFechGeral.mes === mes);
}
// O documento de UMA filial num mes, na caixa #trFechDocTela da tela que estiver aberta
// (Fechamento do mes ou Contas a pagar). `vale` diz se a tela ainda e a mesma quando a
// resposta chega; e so o ULTIMO documento pedido e desenhado (clicar em dois seguidos nao
// deixa o primeiro cair por cima do segundo).
async function trFechDocAbrir(un, mes, vale) {
  let tela = document.getElementById('trFechDocTela');
  if (!tela) return;
  const vez = window._trFechDocVez = (window._trFechDocVez || 0) + 1;
  tela.innerHTML = `<div class="contexto" style="margin-top:14px;">Montando o documento de ${trEscH(un)}...</div>`;
  const d = await trFechDocDados(un, mes);
  tela = document.getElementById('trFechDocTela');
  if (!tela || vez !== window._trFechDocVez || (vale && !vale())) return;
  window._trFechDocAberto = { un, mes };
  if (d.erro) { tela.innerHTML = `<div class="contexto" style="margin-top:14px; border-color:var(--farol-fora);">${trEscH(d.erro)}</div>`; return; }
  tela.innerHTML = `
    <div class="section-label">Documento — ${trEscH(un)} · ${trFechMesTxt(mes)}</div>
    <div style="display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-bottom:10px;">
      <button class="preset-btn" onclick="trFechDocPdfAberto()">Gerar PDF</button>
      <button class="preset-btn" onclick="document.getElementById('trFechDocTela').innerHTML=''">fechar o documento</button>
    </div>
    <iframe id="trFechDocFrame" title="Documento de fechamento" style="display:block; width:100%; max-width:860px; height:640px; margin:0 auto; border:1px solid var(--line); border-radius:10px; background:var(--tx-1);"></iframe>`;
  const fr = document.getElementById('trFechDocFrame');
  fr.onload = () => { try { fr.style.height = (fr.contentDocument.documentElement.scrollHeight + 6) + 'px'; } catch (e) {} };
  fr.srcdoc = trFechDocHtml(d);
  tela.scrollIntoView({ block: 'start' });
}
// "Gerar PDF": abre a folha numa janela e chama a impressao (salvar como PDF fica no
// dialogo do navegador). A janela abre ANTES da consulta para o navegador nao bloquear.
async function trFechDocPdf(ix) {
  const g = window._trFechGeral;
  if (!g) return;
  return trFechDocImprimir(g.filiais[ix], g.mes);
}
// o PDF do documento que esta aberto na tela (o botao de dentro da caixa do documento)
function trFechDocPdfAberto() { const a = window._trFechDocAberto; if (a) return trFechDocImprimir(a.un, a.mes); }
// (sem await antes do window.open: a janela tem de abrir dentro do clique)
async function trFechDocImprimir(un, mes) {
  if (TR_OP && TR_OP.veValores === false) { alert('Seu login não vê valores — o documento de fechamento não é gerado.'); return; }
  const w = window.open('', '_blank');
  if (!w) { alert('O navegador bloqueou a janela de impressão — libere pop-ups para este site.'); return; }
  w.document.write('<p style="font-family:Arial, sans-serif;">Montando o documento...</p>');
  const d = await trFechDocDados(un, mes);
  w.document.open();
  if (d.erro) { w.document.write('<p style="font-family:Arial, sans-serif;">' + trEscH(d.erro) + '</p>'); w.document.close(); return; }
  w.document.write(trFechDocHtml(d, { botao: true }));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
}
// EMBALAGENS NO DOCUMENTO (dono, 01/10/2026: "sim"). A quantidade sai na unidade do painel
// (2.000 un) e, ao lado, em embalagens (8 rolos) — como no documento que ele montava a mao
// ("4 RL", "3 PC"). Duas fontes, nesta ordem, e nenhuma inventa contagem:
//  1. a separacao CONTOU as embalagens (de 01/10/2026 em diante): vale a contagem do banco
//     (vw_tr_fech_doc_itens.emb_cont — a recebida; sem conferencia, a separada). O banco so a
//     entrega quando TODAS as linhas do item no mes foram contadas; item com linha contada e
//     linha nao contada fica so na unidade.
//  2. item sem contagem nenhuma, em mes so de listas do painel (setembro/2026): a conta da
//     grade, com a MESMA regra do pedido (trEmbQtdDe) — embalagem unica, na unidade da linha,
//     fechando em embalagem inteira ou meia. Item de PESO VARIAVEL (T-bone) fica de fora: nele
//     cada pacote pesa diferente, e peso nao diz quantos pacotes foram.
// PESO (kg, litro) so vira contagem pela grade com DUAS garantias: o banco disse que nenhuma
// linha foi contada (linhas_cont veio, e veio 0 — sem as colunas, arquivo ainda nao rodado,
// nao ha garantia) E o mes e anterior a contagem (TR_FECH_CONTAGEM_INICIO). De outubro/2026
// em diante a separacao pesa e conta: linha sem contagem e linha so PESADA, e peso pesado
// dividido pelo tamanho da embalagem inventaria pacote quando fechasse por coincidencia.
// O que e contado por unidade (un, rolo, caixa) vale sempre: ali a divisao e aritmetica exata.
function trFechDocEmb(i, cat, doPainel, mes) {
  const c = cat && cat[i.item];
  const nome = String(i.emb_nome || (c && c.emb_nome) || '').split(' (')[0];   // "pacote", sem o "(20x130 g)"
  if (!nome) return null;
  let n = null;
  if (Number(i.linhas_cont) > 0) n = i.emb_cont != null ? Number(i.emb_cont) : null;
  else if (doPainel && !(c && c.peso_variavel)) {
    const peso = ['KG', 'G', 'LT', 'L', 'ML'].includes(String(i.un || '').toUpperCase());
    if (!peso || (i.linhas_cont != null && !!mes && String(mes) < TR_FECH_CONTAGEM_INICIO)) n = trEmbQtdDe(i.qtd, i.un, c);
  }
  return n != null && n > 0 ? { n, nome } : null;
}
// ---- O DOCUMENTO DE FECHAMENTO EM CONTAS A PAGAR (dono, 01/10/2026: "sim") ----
// O financeiro (Hellen) e a filial que ve valores abrem aqui a mesma folha de Fechamento do
// mes — "ver o documento" e "Gerar PDF" —, uma por cobranca MENSAL (filial x mes) desta
// tela, de agosto/2026 em diante. A filial so escolhe entre as cobrancas da propria unidade,
// e o banco so entrega a ela as linhas da propria unidade (vw_tr_fech_doc_*). Login sem
// valores nao tem esta aba; se chegasse aqui, o bloco nao aparece e o banco nao da os R$.
function trContasDocBloco(contas) {
  window._trContasDocs = [];
  if (!TR_OP || TR_OP.veValores === false) return '';
  const docs = [];
  (contas || []).forEach(c => {
    const mes = String(c.mes_referencia || '').slice(0, 7);
    if (c.tipo !== 'MENSAL' || c.credor === 'MICHIRO' || c.status === 'CANCELADA' || mes < TR_FECH_DOC_INICIO) return;
    if (trFilialVista() && c.unidade !== trFilialVista()) return;
    if (!docs.some(x => x.un === c.unidade && x.mes === mes)) docs.push({ un: c.unidade, mes });
  });
  if (!docs.length) return '';
  docs.sort((a, b) => (a.mes < b.mes ? 1 : a.mes > b.mes ? -1 : String(a.un).localeCompare(String(b.un))));
  window._trContasDocs = docs;
  return `
    <div class="contexto" style="margin:10px 0;">
      <b>Documento de fechamento</b> — a folha do mês: os itens, o total e o vencimento${TR_OP.unidade ? '' : ' de cada filial'}.
      <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; justify-content:center;">
        <select id="trContasDocSel" class="trc-in" style="max-width:100%;" aria-label="Filial e mês do documento">
          ${docs.map((x, ix) => `<option value="${ix}">${trEscH(x.un)} · ${trFechMesTxt(x.mes)}</option>`).join('')}
        </select>
        <button class="preset-btn" onclick="trContasDocVer()">ver o documento</button>
        <button class="preset-btn" onclick="trContasDocPdf()">Gerar PDF</button>
      </div>
    </div>
    <div id="trFechDocTela"></div>`;
}
function trContasDocEscolhido() {
  const s = document.getElementById('trContasDocSel');
  return s ? (window._trContasDocs || [])[Number(s.value)] || null : null;
}
function trContasDocVer() {
  const x = trContasDocEscolhido();
  if (x) return trFechDocAbrir(x.un, x.mes, () => !!document.getElementById('trContasDocSel'));
}
function trContasDocPdf() {
  const x = trContasDocEscolhido();
  if (x) return trFechDocImprimir(x.un, x.mes);
}
// "fechar o mes" direto do quadro: a pergunta repete o numero que esta na tela, e
// depois de fechar a tela le de volta o que ficou gravado e diz se e o mesmo.
// FAIXA "O QUE FALTA PARA FECHAR" (dono, 20/10/2026: "podemos facilitar esse processo de validação ... quanto
// menos cliques melhor"). Uma linha por filial do mês escolhido, com a ação na própria linha. BATEU (pode fechar, sem
// aviso e sem item de lista aberta) = "fechar e mandar à Hellen" num clique (dono, 20/10: "com fechar e mandar à Hellen
// num clique só quando bateu 100%"): fecha (tr_fechar_mes) e só valida (tr_validar_fechamento) se o valor gravado for
// igual ao da prévia e sem diferença; senão para no meio e diz que falta validar. Com aviso ou diferença, os dois passos
// seguem separados, como antes.
function trFechBateu(x) {
  return !!x && x.situacao === 'PREVIA' && x.pode_fechar && !(x.avisos || []).length && !(Number(x.valor_itens_abertas) || 0);
}
function trFechFaixa(linhas, filiais, mes, av) {
  const nu = (v) => Number(v) || 0;
  const esp = window._trFechEsperando || [];
  const linhasHtml = [];
  const bateram = [];
  filiais.forEach((u, ix) => {
    const x = linhas.find(l => l.unidade === u);
    if (!x) return;
    const val = x.valor_total != null ? ` · R$ ${fmt(nu(x.valor_total))}` : '';
    const nome = `<b>${trEscH(u)}</b>${val}`;
    const btn = (rot, fn, forte) => `<button class="preset-btn" style="white-space:nowrap;${forte ? ' border-color:var(--farol-ok); color:var(--tx-1);' : ''}" onclick="${fn}">${rot}</button>`;
    let detalhe = '', acao = '';
    if (x.cobranca_status === 'EM VALIDACAO') {
      const e = esp.find(z => z.unidade === u && String(z.mes_referencia || '').slice(0, 7) === mes);
      detalhe = `fechado — falta validar${e && nu(e.itens_divergentes) ? ` · <span style="color:var(--farol-perto);">${e.itens_divergentes} item(ns) com diferença</span>` : ''}`;
      // 04/11/2026 (dono: "esse mandar à Hellen não precisa, ele fecha e lança no Saipos"): o botão diz só a ação
      acao = e ? btn('validar', `trValidarFechamento(${e.id})`, true) : '';
    } else if (trFechBateu(x)) {
      bateram.push(ix);
      detalhe = '<span style="color:var(--farol-ok);">bateu: todas as listas conferidas, nada travando</span>';
      acao = btn('fechar', `trFechFecharEValidar([${ix}])`, true);
    } else if (x.situacao === 'PREVIA' && x.pode_fechar) {
      detalhe = `<span style="color:var(--farol-perto);">pode fechar, com aviso: ${trEscH([...(x.avisos || []), nu(x.valor_itens_abertas) ? 'tem item de lista ainda não conferida' : ''].filter(Boolean).join('; '))}</span>`;
      acao = btn('fechar', `trFechFecharDaqui(${ix})`, false);
    } else if (x.situacao === 'PREVIA') {
      const travas = x.trava || [];
      detalhe = travas.map(t => `<div style="color:var(--farol-fora);">trava: ${trEscH(t)}</div>`).join('')
        + ((x.avisos || []).length ? `<div style="color:var(--tx-3);">${trEscH(x.avisos.join('; '))}</div>` : '');
      if (travas.some(t => /sem preço/i.test(t)) && document.getElementById('trAvulsoMsg'))
        acao = btn('corrigir aqui', "document.getElementById('trAvulsoMsg').scrollIntoView({block:'center'})", false);
    } else return;   // fechado, a receber ou pago: não é com quem aprova
    linhasHtml.push(`<div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:8px 0; border-top:1px solid var(--line);">
      <div style="flex:1 1 260px; min-width:0;">${nome}<div style="font-size:12.5px;">${detalhe}</div></div>${acao}</div>`);
  });
  const aviso = av ? `<div style="margin-top:6px; color:${av.ok ? 'var(--farol-ok)' : 'var(--farol-fora)'};">${trEscH(av.txt)}</div>` : '';
  if (!linhasHtml.length) return `<div class="contexto" style="text-align:left;"><b>Nada para você aprovar em ${trFechMesTxt(mes)}.</b>${aviso}</div>`;
  return `<div class="contexto" style="text-align:left; border-color:var(--farol-perto);">
    <b>O que falta para fechar ${trFechMesTxt(mes)}</b>${aviso}
    <div style="margin-top:6px;">${linhasHtml.join('')}</div>
    ${bateram.length > 1 ? `<div style="padding-top:8px; border-top:1px solid var(--line);"><button class="preset-btn" style="border-color:var(--farol-ok); color:var(--tx-1);" onclick="trFechFecharEValidar([${bateram.join(',')}])">fechar as ${bateram.length} que bateram</button></div>` : ''}
  </div>`;
}
// fecha e valida as filiais escolhidas (as que bateram), uma pergunta só para todas
async function trFechFecharEValidar(ixs) {
  const g = window._trFechGeral;
  if (!g) return;
  const nu = (v) => Number(v) || 0;
  const alvos = ixs.map(ix => ({ un: g.filiais[ix], r: g.linhas.find(x => x.unidade === g.filiais[ix]) })).filter(a => trFechBateu(a.r));
  if (!alvos.length) return;
  if (!confirm(`Fechar ${trFechMesTxt(g.mes)}? Vira conta a pagar.\n\n`
      + alvos.map(a => `${a.un}: R$ ${fmt(nu(a.r.valor_total))} · vence em ${trFechData(a.r.vencimento)}`).join('\n')
      + '\n\nSó manda se o valor gravado for igual a este e sem diferença; senão para e avisa.')) return;
  const foi = [], parou = [];
  avisoAcao('enviando', `Fechando e validando ${alvos.length} ${alvos.length === 1 ? 'filial' : 'filiais'} (leva alguns segundos)…`);
  for (const a of alvos) {
    const f = await trRpc('tr_fechar_mes', { p_unidade: a.un, p_mes: g.mes + '-01' });
    if (!f.ok) { parou.push(`${a.un}: não fechou — ${await trErroDe(f)}`); continue; }
    let v = null;
    try {
      const rv = await trFetch(`vw_tr_fechamento_validar?unidade=eq.${encodeURIComponent(a.un)}&mes_referencia=eq.${g.mes}-01`);
      if (rv.ok) v = (await rv.json())[0];
    } catch (e) { /* sem a leitura de volta nao valida */ }
    const igual = v && Math.round(Math.abs(nu(v.valor_total)) * 100) === Math.round(Math.abs(nu(a.r.valor_total)) * 100);
    if (!v || !igual || nu(v.itens_divergentes)) {
      parou.push(`${a.un}: fechou, mas ${!v ? 'não consegui ler de volta' : nu(v.itens_divergentes) ? 'tem diferença' : 'o valor gravado não é o da prévia'} — valide aqui em cima`);
      continue;
    }
    const val = await trRpc('tr_validar_fechamento', { p_id: v.id });
    if (!val.ok) { parou.push(`${a.un}: fechou, mas não validou — ${await trErroDe(val)}`); continue; }
    foi.push(`${a.un} R$ ${fmt(Math.abs(nu(v.valor_total)))}`);
  }
  window._trFechAviso = { ok: !parou.length,
    txt: [foi.length ? `Fechado (já está em Contas a pagar): ${foi.join(' · ')}.` : '', ...parou].filter(Boolean).join(' ') };
  LISTAS = null;
  trTelaFechamento();
}
async function trFechFecharDaqui(ix) {
  const g = window._trFechGeral;
  if (!g) return;
  const un = g.filiais[ix], r = g.linhas.find(x => x.unidade === un);
  if (!r || !r.pode_fechar) return;
  const nu = (v) => Number(v) || 0;
  const partes = [`Itens: R$ ${fmt(nu(r.valor_itens))}`];
  if (r.frete_na_conta || nu(r.frete)) partes.push(`Frete Michiro: R$ ${fmt(nu(r.frete))}`);
  if (nu(r.royalty)) partes.push(`Royalty: R$ ${fmt(nu(r.royalty))}`);
  if (!confirm(`Fechar ${trFechMesTxt(g.mes)} de ${un}?\n\n${partes.join('\n')}\nTOTAL: R$ ${fmt(nu(r.valor_total))}\nVence em ${trFechData(r.vencimento)}\n`
      + ((r.avisos || []).length ? '\nAtenção: ' + r.avisos.join('; ') + '.\n' : '')
      + '\nDepois de fechado, a Rita valida e vira conta a pagar.')) return;
  avisoAcao('enviando', `Fechando ${un}…`);
  const resp = await trRpcSeguro('tr_fechar_mes', { p_unidade: un, p_mes: g.mes + '-01' });
  if (!resp.ok) { window._trFechAviso = { ok: false, txt: `Não fechou ${un}: ` + await trErroDe(resp) }; return trFechGeral(); }
  let gravado = null;
  try {
    const rr = await trFetch(`vw_tr_fech_doc_resumo?unidade=eq.${encodeURIComponent(un)}&mes=eq.${g.mes}-01`);
    if (rr.ok) gravado = (await rr.json())[0];
  } catch (e) { /* sem a leitura de volta o aviso diz que nao conferiu */ }
  const bate = gravado && gravado.origem === 'COBRANCA' && Math.round(nu(gravado.valor_total) * 100) === Math.round(nu(r.valor_total) * 100);
  window._trFechAviso = bate
    ? { ok: true, txt: `${un} fechado em R$ ${fmt(nu(gravado.valor_total))} — igual à prévia. Falta validar, logo abaixo, para virar conta a pagar.` }
    : { ok: false, txt: `${un} fechou${gravado && gravado.origem === 'COBRANCA' ? ' em R$ ' + fmt(nu(gravado.valor_total)) : ''}, mas não consegui confirmar que é o mesmo valor da prévia (R$ ${fmt(nu(r.valor_total))}) — confira antes de validar.` };
  trTelaFechamento();
}

async function trFecharMes() {
  const msg = document.getElementById('trFechMsg');
  const un = document.getElementById('trFechUn').value;
  const m = document.getElementById('trFechMes').value;
  if (!un || !m) { msg.textContent = 'Escolha a filial e o mês.'; msg.style.color = '#f5a623'; return; }
  msg.textContent = '';
  avisoAcao('enviando', `Fechando o mês de ${un}…`);
  const r = await trRpcSeguro('tr_fechar_mes', { p_unidade: un, p_mes: m + '-01' });
  if (!r.ok) return avisoAcao('erro', `✗ O mês de ${un} NÃO fechou: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `✓ Mês de ${un} fechado — às ${avisoHora()}. Agora confira abaixo e valide para virar conta a pagar.`);
  setTimeout(trTelaFechamento, 1200);
}

async function trValidarFechamento(id) {
  const msg = document.getElementById('trFechMsg');
  if (msg) msg.textContent = '';
  avisoAcao('enviando', 'Validando o fechamento…');
  const r = await trRpcSeguro('tr_validar_fechamento', { p_id: id });
  if (!r.ok) return avisoAcao('erro', `✗ NÃO validou: ${await trErroDe(r)}. Tente de novo.`);
  avisoAcao('ok', `✓ Validado — já está em Contas a pagar. Às ${avisoHora()}.`);
  setTimeout(trTelaFechamento, 1200);
}

// ---- tela: CMV semanal ----
async function trTelaCmv() {
  const alvo = document.getElementById('trTelaConteudo');
  const filtro = trFiltroVista('&');
  const r = await trFetch(`vw_tr_cmv_semanal?order=semana.desc${filtro}&limit=24`);
  if (!r.ok) { alvo.innerHTML = `<div class="contexto" style="border-color:#ff6b6b;">${await trErroDe(r)}</div>`; return; }
  const cmv = await r.json();
  alvo.innerHTML = `
    <div class="caption-label">O que cada filial recebeu da central, semana a semana (é o motivo do prazo de 7 dias:
      resultado sem esperar o mês fechar).</div>
    <div id="tabelaTrOpCmv"><table>
      <tr><th>Semana</th><th>Filial</th><th>Listas</th><th>Valor recebido</th></tr>
      ${cmv.map(c => `<tr><td>${c.semana ? c.semana.slice(8,10)+'/'+c.semana.slice(5,7) : '—'}</td>
        <td>${c.unidade}</td><td>${c.listas}</td><td>R$ ${fmt(Number(c.valor || 0))}</td></tr>`).join('')}
    </table></div>`;
}

