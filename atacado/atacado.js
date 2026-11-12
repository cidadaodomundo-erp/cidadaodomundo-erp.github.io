// ATACADO · ORÇAMENTOS (dono, 29/10/2026 15:35: módulo Atacado, tela Orçamentos; 30/10 12:22 e 12:53: aprovar baixa o estoque da AV).
// Proposta: contexto/propostas-telas/2026-10-29-orcamento-burger-cpf.md (chat Atacado). A conta é toda do banco: a tela nunca manda custo.
// orc_calcular só mostra; orc_salvar grava com o custo do dia; orc_situacao aprova, recusa ou volta a orçado (a baixa e a devolução são do banco).
// O valor por pessoa não leva frete (dono, 30/10): preço dos lanches ÷ pessoas.
const ORC_PAPEIS = ['DONO', 'FINANCEIRO'];
const ORC_SIT = { ORCADO: ['Orçado', 'var(--tx-2)'], APROVADO: ['Aprovado', 'var(--farol-ok)'], RECUSADO: ['Recusado', 'var(--farol-fora)'] };
// o exemplo do dono (45 pessoas, 132%, frete R$ 30), por lanche: muda o número de pessoas e a lista acompanha
const ORC_PADRAO = [['HAMBURGUER DE CARNE RECEITA', 1], ['PAO TRADICIONAL', 1], ['MOZARELA FATIA MP', 0.02], ['ALFACE AMERICANA MP', 0.01], ['TOMATE MP', 0.025],
                    ['PEPINO AGRIDOCE MP', 0.025], ['MOLHO ESPECIAL RECEITA', 0.02], ['MAIONESE HELLMANS MP', 0.02], ['BACON EM CUBOS FRITO RECEITA', 0.03]];
// 30/10/2026 12:56 (dono): também é a tela de pedidos do Fabio, não só de burger. Pedido sem contagem de pessoas: pessoas = 1 e quantidade total.
// 04/11/2026 10:42 (dono): duas abas no Montar. "Itens" (T-bone, costelinha...): quantidade e preço na linha, o preço vem sugerido
// (vitrine da lojinha) e pode mudar; o lucro sai do preço. "Kit burgers": pessoas e valor por pessoa (sugerido a 132%, pode mudar).
const ORC_LUCRO_KIT = 132;
// cobrança em dois campos (dono, 04/11/2026 11:01): status pago/cobrar e forma PIX/cartão; grava como texto "Cobrar · PIX"
const ORC_COB_STATUS = { PAGO: 'Pago', COBRAR: 'Cobrar' };
const ORC_COB_FORMA = { PIX: 'PIX', CARTAO: 'Cartão' };
const ORC_VAZIO = () => ({ cliente: '', contato: '', forma: '', quando: '', local: '', cobStatus: '', cobForma: '', obs: '', pessoas: '1', lucro: '', frete: '', valorPessoa: '', valorManual: false, linhas: [{ item: '', qtd: '', por: 'TOTAL', preco: '' }], calc: null, erro: null });
const ORC = Object.assign(ORC_VAZIO(), { modo: 'itens', sugerido: null, papel: undefined, aba: 'montar', base: null, seq: 0, salvando: false, hist: null, itens: {}, aberto: null, equipe: null, erroEquipe: null, sug: [], sugK: -1, clientes: [], enderecos: [], erroClientes: null });
const ORC_FORMA = { RETIRADA: 'Retirada', ENTREGA: 'Entrega' };
const orcR = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const orcQ = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const orcD = (v) => v ? new Date(String(v).length <= 10 ? v + 'T12:00:00' : v).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
const orcFonte = (x) => x.custo_fonte === 'NF' ? `NF ${orcD(x.custo_data).slice(0, 5)}` : /^FICHA/.test(x.custo_fonte || '') ? 'ficha da receita' : String(x.custo_fonte || '').toLowerCase();
const orcNorm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const orcAdmin = () => ORC_PAPEIS.includes(ORC.papel);
const orcTemPessoas = (n) => Number(n) > 1;
const orcHora = (v) => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '';
const orcQuandoIso = (v) => v ? new Date(v).toISOString() : null;
const orcPorPessoa = (o) => Number(o.n_lanches) ? Number(o.preco_total) / Number(o.n_lanches) : 0;
const orcEl = (id) => document.getElementById(id);
const ORC_CAMPO = 'padding:7px 9px;border-radius:6px;background:var(--surface-2);color:var(--tx-1);border:1px solid var(--line);font:inherit;font-size:13px;box-sizing:border-box;';

function orcEstilo() {
  if (orcEl('orcEstilo')) return;
  const s = document.createElement('style'); s.id = 'orcEstilo';
  s.textContent = `
    #orcImpressao { display:none; }
    @media print {
      body.orc-imprimindo > *:not(#orcImpressao) { display:none !important; }
      body.orc-imprimindo { background:#fff !important; padding:0 !important; }
      body.orc-imprimindo::before { display:none !important; }
      body.orc-imprimindo #orcImpressao { display:block; color:#000; font-size:13px; }
      #orcImpressao table { width:100%; border-collapse:collapse; }
      #orcImpressao th, #orcImpressao td { color:#000 !important; background:#fff !important; border:1px solid var(--tx-5); padding:5px 8px; text-align:left; }
      #orcImpressao h3 { color:#000; margin:0 0 10px; }
      #orcImpressao .orc-nao-imprime { display:none; }
    }`;
  document.head.appendChild(s);
}
async function entrarOrcamentos() {
  orcEstilo();
  const v = orcEl('view-orcamentos');
  if (!v) return;
  if (ORC.papel === undefined) {
    v.innerHTML = '<div class="contexto">Lendo…</div>';
    const r = await trRpcSeguro('tr_meu_papel', {});
    ORC.papel = r.ok ? await r.json() : null;
  }
  if (!orcAdmin()) { ORC.aba = 'equipe'; orcRender(); orcEquipe(); return; }
  try {
    if (!ORC.base) ORC.base = await consultarTudo('vw_orc_item_escolha?select=item,nome_base,un,custo_un,custo_fonte,custo_data,grupo&order=item');
    // 04/11/2026 11:15 (dono): a aba Itens usa os produtos do atacado (costelinha 1 kg, 500 g...), a mesma lista do ePadoca e da lojinha.
    // Preço sugerido do pacote = o mais alto entre as tabelas modelo do atacado (dono, 30/10 18:59: "a tabela mais alta do atacado").
    if (!ORC.produtos) {
      const [prods, modelos] = await Promise.all([
        consultarTudo('loja_produto?select=id,nome_vitrine,un_vitrine,qtd_por_venda,un&tipo=eq.ATACADO&ativo=is.true&order=nome_vitrine'),
        consultarTudo('loja_empresa?select=id&modelo=is.true').catch(() => [])]);
      const precos = modelos.length ? await consultarTudo(`loja_preco?select=produto_id,preco&empresa_id=in.(${modelos.map((m) => m.id).join(',')})`).catch(() => []) : [];
      const alto = {}; precos.forEach((p) => { alto[p.produto_id] = Math.max(alto[p.produto_id] || 0, Number(p.preco)); });
      ORC.produtos = prods.map((p) => ({ id: p.id, item: p.nome_vitrine, un: p.un_vitrine || String(p.un || '').toLowerCase(), sug: alto[p.id] || null }));
    }
  } catch (e) { v.innerHTML = `<h2>Orçamentos</h2><div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler a lista de itens: ${trEscH(e.message)}</div>`; return; }
  await orcLerClientes();
  orcRender();
  if (ORC.aba === 'historico') orcHistorico();
  if (ORC.aba === 'equipe') orcEquipe();
}
function orcTrocarAba(a) { ORC.aba = a; orcRender(); if (a === 'historico') orcHistorico(); if (a === 'equipe') orcEquipe(); }
function orcRender() {
  const v = orcEl('view-orcamentos'); if (!v) return;
  const aba = (k, r) => `<button type="button" onclick="orcTrocarAba('${k}')" style="background:none;border:0;border-bottom:3px solid ${ORC.aba === k ? 'var(--marca-amarelo)' : 'transparent'};padding:8px 12px;cursor:pointer;font:inherit;font-weight:700;color:${ORC.aba === k ? 'var(--tx-1)' : 'var(--tx-3)'};">${r}</button>`;
  v.innerHTML = `<h2>Orçamentos</h2>
    <div style="display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--line);margin:0 0 12px;">${orcAdmin() ? aba('montar', 'Montar') + aba('historico', 'Histórico') : ''}${aba('equipe', 'Pedidos aprovados')}</div>
    <div id="orcCorpo">${ORC.aba === 'montar' ? orcMontarHtml() : ORC.aba === 'historico' ? orcHistoricoHtml() : orcEquipeHtml()}</div>`;
  if (ORC.aba === 'montar' && ORC.calc) orcPintar();
}

// ---------------------------------------------------------------- Montar
function orcMontarHtml() {
  const rot = 'font-size:12px;color:var(--tx-3);display:block;text-align:left;';
  const cx = (r, c, ex) => `<label style="${rot}">${r}<input style="${ORC_CAMPO}width:100%;" value="${trEscH(ORC[c])}" ${/oninput=/.test(ex || '') ? '' : `oninput="ORC.${c}=this.value"`} ${ex || ''}></label>`;
  const nu = (r, c, id, ex) => `<label style="${rot}">${r}<input id="${id}" type="number" style="${ORC_CAMPO}width:100%;" value="${trEscH(ORC[c])}" oninput="ORC.${c}=this.value;orcAgendar()" ${ex}></label>`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:10px;">
      ${cx('Cliente', 'cliente', `id="orcCliente" autocomplete="off" oninput="ORC.cliente=this.value;orcBuscarCliente(this)" onfocus="orcBuscarCliente(this)" onblur="orcSairCliente(this)" onkeydown="orcTeclaCliente(event, this)"`)}${cx('Telefone do cliente', 'contato', 'id="orcContato" inputmode="tel" placeholder="(41) 99999-9999" oninput="this.value=orcFone(this.value);ORC.contato=this.value"')}
      <label style="${rot}">Forma de entrega<select style="${ORC_CAMPO}width:100%;" onchange="ORC.forma=this.value;orcEnderecosLista()"><option value="">escolha</option>${Object.entries(ORC_FORMA).map(([k, r]) => `<option value="${k}"${ORC.forma === k ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
      <label style="${rot}">Quando<input type="datetime-local" style="${ORC_CAMPO}width:100%;" value="${trEscH(ORC.quando)}" oninput="ORC.quando=this.value"></label>
      ${cx('Onde', 'local', `list="orcEnderecos" autocomplete="off" placeholder="${ORC.forma === 'RETIRADA' ? 'local da retirada' : 'endereço de entrega'}"`)}<datalist id="orcEnderecos">${orcEnderecosOpcoes()}</datalist>
      <label style="${rot}">Cobrança<select style="${ORC_CAMPO}width:100%;" onchange="ORC.cobStatus=this.value"><option value="">escolha</option>${Object.entries(ORC_COB_STATUS).map(([k, r]) => `<option value="${k}"${ORC.cobStatus === k ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
      <label style="${rot}">Forma de pagamento<select style="${ORC_CAMPO}width:100%;" onchange="ORC.cobForma=this.value"><option value="">escolha</option>${Object.entries(ORC_COB_FORMA).map(([k, r]) => `<option value="${k}"${ORC.cobForma === k ? ' selected' : ''}>${r}</option>`).join('')}</select></label>
    </div>
    ${ORC.erroClientes ? `<div class="contexto" style="color:var(--farol-fora);text-align:left;">✗ Não consegui ler a lista de clientes: ${trEscH(ORC.erroClientes)}. Dá para digitar o nome.</div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 10px;">${[['itens', 'Itens (T-bone, costelinha…)'], ['kit', 'Kit burgers']].map(([k, r]) =>
      `<button type="button" class="preset-btn${ORC.modo === k ? ' active' : ''}" onclick="orcModo('${k}')">${r}</button>`).join('')}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:12px;">
      ${ORC.modo === 'kit' ? nu('Pessoas', 'pessoas', 'orcPessoas', 'min="1" step="1"') + `<label style="${rot}">Valor por pessoa (R$) <span id="orcSugPessoa" style="color:var(--tx-4);"></span><input id="orcValorPessoa" type="number" min="0" step="0.01" style="${ORC_CAMPO}width:100%;" value="${trEscH(ORC.valorPessoa)}" oninput="ORC.valorPessoa=this.value;ORC.valorManual=this.value!=='';orcPintar()"></label>` : ''}
      ${nu('Frete (R$)', 'frete', 'orcFrete', 'min="0" step="0.01"')}
      ${cx('Observação', 'obs')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
      <button type="button" class="preset-btn" onclick="orcMaisItem()">+ item</button>
      ${ORC.modo === 'kit' ? '<button type="button" class="preset-btn" onclick="orcPadrao()">Burger padrão</button>' : ''}
    </div>
    <div id="tabelaOrcItens" class="cel-cartao"><table><thead><tr>${ORC.modo === 'kit'
      ? '<th>Item</th><th style="text-align:right;">Quantidade por lanche</th><th style="text-align:right;">Total</th><th style="text-align:right;">Custo do item</th><th>Origem</th><th style="text-align:right;">Custo</th><th></th>'
      : '<th>Item</th><th style="text-align:right;">Quantidade</th><th style="text-align:right;">Preço de cada (R$)</th><th style="text-align:right;">Total</th><th style="text-align:right;">Custo</th><th style="text-align:right;">Lucro</th><th></th>'}</tr></thead>
      <tbody>${ORC.linhas.map(orcLinhaHtml).join('')}</tbody></table></div>
    <div id="orcTotais" style="margin-top:12px;">${orcTotaisHtml()}</div>`;
}
function orcLinhaHtml(l, i) {
  return `<tr id="orcL${i}">
      <td style="min-width:260px;"><input style="${ORC_CAMPO}width:100%;" value="${trEscH(l.item)}" placeholder="${ORC.modo === 'kit' ? 'buscar na base' : 'buscar produto do atacado'}" autocomplete="off" oninput="orcBuscar(${i}, this)" onfocus="orcBuscar(${i}, this)" onblur="orcSairBusca(${i}, this)" onkeydown="orcTeclaBusca(event, ${i}, this)"></td>
      <td style="text-align:right;white-space:nowrap;"><input type="number" min="0" step="0.001" style="${ORC_CAMPO}width:90px;text-align:right;" value="${trEscH(l.qtd)}" oninput="orcLinha(${i},'qtd',this.value)"> <span class="orc-un" style="font-size:12px;color:var(--tx-3);">${trEscH(orcUn(l.item))}</span></td>
      ${ORC.modo === 'kit'
        ? `<td class="orc-c1" style="text-align:right;"></td><td class="orc-c2" style="text-align:right;"></td><td class="orc-c3" style="font-size:12px;color:var(--tx-3);"></td><td class="orc-c4" style="text-align:right;"></td>`
        : `<td style="text-align:right;"><input class="orc-preco" type="number" min="0" step="0.01" style="${ORC_CAMPO}width:100px;text-align:right;" value="${trEscH(l.preco)}" oninput="orcLinha(${i},'preco',this.value)"><div class="orc-c3" style="font-size:11px;color:var(--tx-4);"></div></td>
           <td class="orc-c1" style="text-align:right;"></td><td class="orc-c4" style="text-align:right;"></td><td class="orc-c5" style="text-align:right;"></td>`}
      <td><button type="button" class="preset-btn" title="Tirar a linha" onclick="orcTirar(${i})">×</button></td></tr>`;
}
// 30/10/2026 (dono): acha "tbone" e "t-bone" em "FILE C MIGNON (T BONE) MP": compara sem hífen, espaço e acento
function orcFecharBusca() { const s = orcEl('orcSug'); if (s) s.remove(); ORC.sug = []; }
// kit: itens da base (ingredientes); Itens: produtos do atacado
const orcOpcoes = () => ORC.modo === 'kit' ? (ORC.base || []) : (ORC.produtos || []);
function orcBuscar(i, el) {
  ORC.linhas[i].item = el.value;
  const igual = orcOpcoes().find((b) => b.item === el.value);
  ORC.linhas[i].produto_id = ORC.modo === 'kit' ? null : igual ? igual.id : null;
  orcAgendar();
  const q = orcNorm(el.value);
  orcFecharBusca();
  if (!q) return;
  ORC.sug = orcOpcoes().filter((b) => orcNorm(b.item).includes(q)).sort((a, b) => orcNorm(b.item).startsWith(q) - orcNorm(a.item).startsWith(q)).slice(0, 10);
  if (!ORC.sug.length || (ORC.sug.length === 1 && ORC.sug[0].item === el.value)) return;
  const r = el.getBoundingClientRect(), s = document.createElement('div');
  s.id = 'orcSug';
  s.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 2}px;width:${Math.max(r.width, 320)}px;max-height:300px;overflow:auto;z-index:10060;background:var(--surface);border:1px solid var(--line-2);border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.45);`;
  s.innerHTML = ORC.sug.map((b, k) => `<div onmousedown="event.preventDefault();orcEscolher(${i}, ${k})" style="padding:7px 10px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--line);"><span>${trEscH(b.nome_base || b.item)}</span><span style="color:var(--tx-4);">${trEscH(b.un || '')}</span></div>`).join('');
  document.body.appendChild(s);
}
function orcEscolher(i, k) {
  const b = ORC.sug[k]; if (!b) return;
  ORC.linhas[i].item = b.item;
  ORC.linhas[i].produto_id = ORC.modo === 'kit' ? null : b.id;
  orcFecharBusca();
  const tr = orcEl('orcL' + i), inp = tr && tr.querySelector('input');
  if (inp) inp.value = b.item;
  orcItemEscolhido(i);
  orcAgendar();
}
const orcUn = (item) => { const b = orcOpcoes().find((x) => x.item === item); return b ? String(b.un || '').toLowerCase() : ''; };
// item escolhido: unidade ao lado da quantidade e, na aba Itens, o preço sugerido do pacote (só se a linha ainda não tem preço)
function orcItemEscolhido(i) {
  const l = ORC.linhas[i], tr = orcEl('orcL' + i); if (!l) return;
  const pr = ORC.modo === 'itens' && (ORC.produtos || []).find((x) => x.id === l.produto_id);
  if (pr && l.preco === '' && pr.sug != null) l.preco = String(pr.sug);
  if (!tr) return;
  const un = tr.querySelector('.orc-un'); if (un) un.textContent = orcUn(l.item);
  const p = tr.querySelector('.orc-preco'); if (p) p.value = l.preco;
}
function orcModo(m) {
  if (ORC.modo === m) return;
  ORC.modo = m; ORC.calc = null; ORC.erro = null; ORC.valorPessoa = ''; ORC.valorManual = false;
  if (m === 'kit') { ORC.linhas = ORC_PADRAO.map(([item, qtd]) => ({ item, qtd: String(qtd), por: 'LANCHE', preco: '' })); if (!orcTemPessoas(ORC.pessoas)) ORC.pessoas = '45'; }
  else { ORC.linhas = [orcLinhaNova()]; ORC.pessoas = '1'; }
  orcRender(); orcAgendar();
}
function orcSairBusca(i, el) {
  const q = orcNorm(el.value), iguais = orcOpcoes().filter((b) => orcNorm(b.item) === q);
  if (iguais.length === 1 && (iguais[0].item !== el.value || (ORC.modo === 'itens' && ORC.linhas[i].produto_id !== iguais[0].id))) {
    el.value = iguais[0].item; ORC.linhas[i].item = iguais[0].item; ORC.linhas[i].produto_id = ORC.modo === 'kit' ? null : iguais[0].id; orcAgendar();
  }
  orcItemEscolhido(i);
  orcFecharBusca();
}
function orcTeclaBusca(e, i, el) {
  if (e.key === 'Enter' && ORC.sug.length) { e.preventDefault(); orcEscolher(i, 0); }
  else if (e.key === 'Escape') orcFecharBusca();
}
window.addEventListener('scroll', (e) => { if (!e.target || e.target.id !== 'orcSug') orcFecharBusca(); }, true);
// 30/10/2026 14:49 (dono): cadastra uma vez e o cliente aparece na lista. Quem cadastra é o orc_salvar, por gatilho: nome fora da lista continua aceito.
async function orcLerClientes() {
  try {
    [ORC.clientes, ORC.enderecos] = await Promise.all([consultarTudo('orc_cliente?select=id,nome,contato&order=nome'),
      consultarTudo('orc_cliente_endereco?select=cliente_id,forma,endereco&order=ultimo_uso.desc').catch(() => [])]);
    ORC.erroClientes = null;
  } catch (e) { ORC.erroClientes = e.message; }
}
// 04/11/2026 (dono): o "Onde" lembra os endereços do cliente (pode ter vários), o último usado primeiro; o novo entra ao salvar
function orcEnderecosOpcoes() {
  const c = (ORC.clientes || []).find((x) => orcNorm(x.nome) === orcNorm(ORC.cliente));
  if (!c) return '';
  return (ORC.enderecos || []).filter((e) => e.cliente_id === c.id && (!ORC.forma || e.forma === ORC.forma)).map((e) => `<option value="${trEscH(e.endereco)}">`).join('');
}
function orcEnderecosLista() {
  const d = orcEl('orcEnderecos'); if (d) d.innerHTML = orcEnderecosOpcoes();
  const o = d && d.previousElementSibling && d.previousElementSibling.querySelector('input');
  if (o) o.placeholder = ORC.forma === 'RETIRADA' ? 'local da retirada' : 'endereço de entrega';
}
function orcBuscarCliente(el) {
  const q = orcNorm(el.value);
  orcFecharBusca();
  ORC.sugK = -1;
  ORC.sug = (ORC.clientes || []).filter((c) => !q || orcNorm(c.nome).includes(q)).sort((a, b) => orcNorm(b.nome).startsWith(q) - orcNorm(a.nome).startsWith(q));
  if (!ORC.sug.length || (ORC.sug.length === 1 && ORC.sug[0].nome === el.value)) return;
  const r = el.getBoundingClientRect(), s = document.createElement('div');
  s.id = 'orcSug';
  s.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom + 2}px;width:${Math.max(r.width, 320)}px;max-height:300px;overflow:auto;z-index:10060;background:var(--surface);border:1px solid var(--line-2);border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.45);`;
  s.innerHTML = ORC.sug.map((c, k) => `<div data-k="${k}" onmousedown="event.preventDefault();orcEscolherCliente(${k})" style="padding:7px 10px;cursor:pointer;font-size:13px;display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--line);"><span>${trEscH(c.nome)}</span><span style="color:var(--tx-4);">${trEscH(c.contato || '')}</span></div>`).join('');
  document.body.appendChild(s);
}
// telefone vira (41) 99999-9999 enquanto se digita; fixo vira (41) 3333-4444; com letra ou @ (e-mail) fica como foi digitado (04/11/2026)
function orcFone(v) {
  v = String(v || '');
  if (/[a-z@]/i.test(v)) return v;
  let d = v.replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return '(' + d;
  const ddd = d.slice(0, 2), r = d.slice(2), corte = d.length === 11 ? 5 : 4;
  return `(${ddd}) ` + (r.length > corte ? r.slice(0, corte) + '-' + r.slice(corte) : r);
}
function orcEscolherCliente(k) {
  const c = ORC.sug[k]; if (!c) return;
  ORC.cliente = c.nome;
  if (c.contato) ORC.contato = orcFone(c.contato);
  const n = orcEl('orcCliente'), ct = orcEl('orcContato');
  if (n) n.value = ORC.cliente;
  if (ct) ct.value = ORC.contato;
  orcEnderecosLista();
  orcFecharBusca();
}
// mesmo nome com outra grafia é o mesmo cliente: não deixa nascer "joao" ao lado de "João"
function orcSairCliente(el) {
  const q = orcNorm(el.value), iguais = q ? (ORC.clientes || []).filter((c) => orcNorm(c.nome) === q) : [];
  if (iguais.length === 1 && (iguais[0].nome !== el.value || !ORC.contato.trim())) { ORC.sug = iguais; orcEscolherCliente(0); }
  orcFecharBusca();
}
// Enter só escolhe o que foi marcado com as setas: nome novo que começa igual a um antigo não é trocado
function orcTeclaCliente(e, el) {
  const s = orcEl('orcSug');
  if (e.key === 'Escape') return orcFecharBusca();
  if (e.key === 'Enter' && s && ORC.sugK >= 0) { e.preventDefault(); return orcEscolherCliente(ORC.sugK); }
  if (!s || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  e.preventDefault();
  ORC.sugK = (ORC.sugK + (e.key === 'ArrowDown' ? 1 : -1) + ORC.sug.length) % ORC.sug.length;
  [...s.children].forEach((d, k) => { d.style.background = k === ORC.sugK ? 'var(--surface-2)' : ''; if (k === ORC.sugK) d.scrollIntoView({ block: 'nearest' }); });
}
const orcTemPreco = (l) => String(l.preco ?? '').trim() !== '' && Number(l.preco) >= 0;
function orcValida(l) {
  if (!l.item || !(Number(l.qtd) > 0)) return false;
  return ORC.modo === 'kit' ? (ORC.base || []).some((b) => b.item === l.item) : !!l.produto_id && orcTemPreco(l);
}
function orcLinha(i, campo, valor) { ORC.linhas[i][campo] = valor; orcAgendar(); }
function orcLinhaNova() { return { item: '', qtd: '', por: ORC.modo === 'kit' ? 'LANCHE' : 'TOTAL', preco: '' }; }
function orcMaisItem() { ORC.linhas.push(orcLinhaNova()); orcRender(); orcPintar(); }
function orcTirar(i) { ORC.linhas.splice(i, 1); if (!ORC.linhas.length) ORC.linhas.push(orcLinhaNova()); orcRender(); orcAgendar(); }
function orcPadrao() {
  ORC.linhas = ORC_PADRAO.map(([item, qtd]) => ({ item, qtd: String(qtd), por: 'LANCHE', preco: '' }));
  if (!orcTemPessoas(ORC.pessoas)) ORC.pessoas = '45';
  if (!ORC.frete) ORC.frete = '30';
  orcRender(); orcAgendar();
}
// Itens: quantidade total com o preço da linha. Kit: quantidade por lanche, sem preço na linha (o preço é o valor por pessoa).
function orcItensDe() {
  return ORC.linhas.filter(orcValida).map((l) => ORC.modo === 'kit' ? { item: l.item, qtd: Number(l.qtd), por: 'LANCHE' } : { produto_id: l.produto_id, qtd: Number(l.qtd), preco: Number(l.preco) });
}
const orcPessoasDe = () => ORC.modo === 'kit' ? Number(ORC.pessoas) : 1;
// kit: o banco devolve o custo e o sugerido a 132%; o valor por pessoa digitado decide o preço e o lucro
function orcKitConta() {
  const c = ORC.calc; if (!c || ORC.modo !== 'kit') return null;
  const n = Number(ORC.pessoas), vp = ORC.valorManual && Number(ORC.valorPessoa) >= 0 ? Number(ORC.valorPessoa) : Number(c.por_pessoa);
  const preco = Math.round(vp * n * 100) / 100, custo = Number(c.custo_total), frete = Number(c.frete);
  return { custo, preco, lucro: preco - custo, pct: custo > 0 ? (preco / custo - 1) * 100 : 0, frete, total: preco + frete, por_pessoa: vp, sugerido: Number(c.por_pessoa) };
}
// a prévia leva quase 2 s: só quando a pessoa para de digitar
function orcAgendar() { clearTimeout(orcAgendar._t); orcAgendar._t = setTimeout(orcCalcular, 500); }
async function orcCalcular() {
  const itens = orcItensDe(), n = orcPessoasDe();
  const seq = ++ORC.seq;
  if (!itens.length || !(n > 0)) { ORC.calc = null; ORC.erro = null; orcPintar(); return; }
  const tot = orcEl('orcTotais'); if (tot) tot.style.opacity = '.55';
  const r = await trRpcSeguro('orc_calcular', { p_n_lanches: n, p_pct_lucro: ORC.modo === 'kit' ? ORC_LUCRO_KIT : 0, p_itens: itens, p_frete: Number(ORC.frete) || 0 });
  if (seq !== ORC.seq) return;
  if (r.ok) { ORC.calc = await r.json(); ORC.erro = null; } else { ORC.calc = null; ORC.erro = await trErroDe(r); }
  orcPintar();
}
function orcPintar() {
  if (ORC.aba !== 'montar') return;
  let k = 0;
  ORC.linhas.forEach((l, i) => {
    const tr = orcEl('orcL' + i); if (!tr) return;
    const ok = orcValida(l), x = ok && ORC.calc && (ORC.calc.itens || [])[k];
    if (ok) k++;
    const foraDaBase = l.item && (ORC.modo === 'kit' ? !(ORC.base || []).some((b) => b.item === l.item) : !l.produto_id);
    const semPreco = ORC.modo === 'itens' && l.item && !foraDaBase && Number(l.qtd) > 0 && !orcTemPreco(l);
    const set = (cl, v) => { const e = tr.querySelector(cl); if (e) e.textContent = v; return e; };
    const c3 = set('.orc-c3', x ? (ORC.modo === 'kit' ? orcFonte(x) : `custo ${orcR(x.custo_produto)} o ${orcUn(l.item) || 'pacote'}`) : foraDaBase ? 'escolha na lista' : semPreco ? 'informe o preço' : '');
    if (c3) c3.style.color = foraDaBase || semPreco ? 'var(--farol-fora)' : '';
    set('.orc-c4', x ? orcR(x.custo_linha) : '');
    if (ORC.modo === 'kit') {
      set('.orc-c1', x ? `${orcQ(x.qtd_total)} ${x.un}` : '');
      set('.orc-c2', x ? `${orcR(x.custo_un)}/${x.un}` : '');
    } else {
      set('.orc-c1', x ? orcR(x.preco_linha) : '');
      const c5 = set('.orc-c5', x ? `${orcR(x.lucro_linha)} · ${Number(x.custo_linha) > 0 ? orcQ(Math.round(Number(x.lucro_linha) / Number(x.custo_linha) * 1000) / 10) : '–'}%` : '');
      if (c5) c5.style.color = x && Number(x.lucro_linha) < 0 ? 'var(--farol-fora)' : '';
    }
  });
  const kc = orcKitConta(), vp = orcEl('orcValorPessoa'), sp = orcEl('orcSugPessoa');
  if (vp && kc && !ORC.valorManual && document.activeElement !== vp) vp.value = kc.sugerido.toFixed(2);
  if (sp) sp.textContent = kc ? `· sugerido ${orcR(kc.sugerido)}` : '';
  const t = orcEl('orcTotais');
  if (t) { t.style.opacity = ''; t.innerHTML = orcTotaisHtml(); }
}
function orcTotaisHtml() {
  const c = ORC.calc, k = orcKitConta();
  const v = k ? { custo: k.custo, lucro: k.lucro, pct: k.pct, frete: k.frete, total: k.total } : c ? { custo: c.custo_total, lucro: c.lucro, pct: c.pct_lucro, frete: c.frete, total: c.total_cliente } : null;
  const card = (r, x, cl, sub) => `<div class="card ${cl || 'neutral'}"><div class="card-lbl">${r}</div><div class="card-val">${v ? orcR(x) : '–'}</div>${v && sub ? `<div class="card-delta" style="color:var(--tx-3);">${sub}</div>` : ''}</div>`;
  return `<div class="cards">${card('Custo', v && v.custo)}${card('Lucro', v && v.lucro, v && v.lucro < 0 ? 'neg' : '', v ? `${orcQ(Math.round(v.pct * 10) / 10)}% sobre o custo` : '')}${card('Frete', v && v.frete)}${card('Total ao cliente', v && v.total, 'blue')}${ORC.modo === 'kit' ? card('Por pessoa, sem frete', k && k.por_pessoa) : ''}</div>
    ${ORC.erro ? `<div class="contexto" style="color:var(--farol-fora);text-align:left;">✗ ${trEscH(ORC.erro)}</div>` : ''}
    <button type="button" class="preset-btn active" style="font-size:14px;padding:10px 18px;"${ORC.salvando ? ' disabled' : ''} onclick="orcSalvar()">Salvar orçamento</button>`;
}
async function orcSalvar() {
  if (ORC.salvando) return;
  const itens = orcItensDe(), n = orcPessoasDe();
  const fora = ORC.linhas.filter((l) => (l.item || l.qtd || l.preco) && !orcValida(l));
  if (!(n > 0)) return avisoAcao('atencao', '! Informe o número de pessoas.');
  if (!itens.length) return avisoAcao('atencao', ORC.modo === 'kit' ? '! Coloque ao menos um item da base com quantidade.' : '! Coloque ao menos um item da base com quantidade e preço.');
  if (fora.length) return avisoAcao('atencao', `! Corrija ou tire: ${fora.map((l) => l.item || 'linha sem item').join(', ')}.`);
  let pct = 0;
  if (ORC.modo === 'kit') {
    if (ORC.seq && !ORC.calc) await orcCalcular();
    const k = orcKitConta();
    if (!k) return avisoAcao('atencao', '! Espere a conta do kit aparecer.');
    if (k.preco < k.custo) return avisoAcao('atencao', `! O valor por pessoa está abaixo do custo (${orcR(k.custo / n)} por pessoa).`);
    pct = k.pct;   // o banco refaz: custo × (1 + %) = valor por pessoa × pessoas
  }
  ORC.salvando = true; orcPintar();
  avisoAcao('enviando', 'Salvando o orçamento…');
  const r = await trRpcSeguro('orc_salvar', { p_cliente: ORC.cliente.trim() || null, p_n_lanches: n, p_pct_lucro: pct, p_itens: itens, p_obs: ORC.obs.trim() || null, p_frete: Number(ORC.frete) || 0,
    p_contato: ORC.contato.trim() || null, p_entrega_forma: ORC.forma || null, p_entrega_quando: orcQuandoIso(ORC.quando), p_entrega_local: ORC.local.trim() || null,
    p_cobranca: [ORC_COB_STATUS[ORC.cobStatus], ORC_COB_FORMA[ORC.cobForma]].filter(Boolean).join(' · ') || null });
  ORC.salvando = false;
  if (!r.ok) { orcPintar(); return avisoAcao('erro', `✗ Não salvou: ${await trErroDe(r)}.`, orcSalvar); }
  const id = await r.json();
  avisoAcao('ok', `✓ Orçamento nº ${id} salvo — às ${avisoHora()}.`);
  Object.assign(ORC, ORC_VAZIO(), { aba: 'historico', aberto: Number(id) });
  orcRender(); orcHistorico(); orcLerClientes();
}

// ---------------------------------------------------------------- Histórico
async function orcHistorico() {
  try {
    ORC.hist = await consultarTudo('orc_orcamento?select=id,tipo,cliente,n_lanches,pct_lucro,custo_total,preco_total,frete,total_cliente,situacao,origem,obs,criado_por,criado_em,aprovado_em,aprovado_por,cliente_contato,entrega_forma,entrega_quando,entrega_local,cobranca&order=id.desc');
    if (!ORC.vitrine) ORC.vitrine = new Map((await consultarTudo('loja_produto?select=item,nome_vitrine').catch(() => [])).map((x) => [x.item, x.nome_vitrine]));
    ORC.erroHist = null;
  } catch (e) { ORC.erroHist = e.message; }
  if (ORC.aberto && !ORC.itens[ORC.aberto]) await orcLerItens(ORC.aberto);
  if (ORC.aba === 'historico') orcRender();
}
// 07/11/2026 (frente Atacado): item na tela = nome da base (vw_orc_orcamento_item.nome_base); sem nome na base, o nome gravado
// aparece marcado "fora da base" (ex.: pedido da lojinha com o nome da ficha do atacado)
function orcNomeBase(x) {
  return x.nome_base ? trEscH(x.nome_base) : `${trEscH(x.item)} <span style="font-size:11px;color:var(--farol-perto);white-space:nowrap;">fora da base</span>`;
}
async function orcLerItens(id) {
  ORC.itens[id] = await consultarTudo(`vw_orc_orcamento_item?select=ordem,item,nome_base,un,qtd_informada,por,qtd_total,preco_un,custo_un,custo_fonte,custo_data,custo_linha,produto_nome,produto_qtd,produto_preco&orcamento_id=eq.${Number(id)}&order=ordem`).catch(() => []);
}
async function orcAbrir(id) {
  ORC.aberto = ORC.aberto === id ? null : id;
  if (ORC.aberto && !ORC.itens[id]) await orcLerItens(id);
  orcRender();
}
function orcHistoricoHtml() {
  if (ORC.erroHist) return `<div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler o histórico: ${trEscH(ORC.erroHist)}</div>`;
  if (!ORC.hist) return '<div class="contexto">Lendo…</div>';
  if (!ORC.hist.length) return '<div class="contexto">Nenhum orçamento salvo.</div>';
  const dir = 'style="text-align:right;"';
  return `<div id="tabelaOrcHist" class="cel-cartao"><table><thead><tr><th>Nº</th><th>Data</th><th>Quem</th><th>Cliente</th><th>Entrega</th><th ${dir}>Pessoas</th><th ${dir}>% lucro</th><th ${dir}>Custo</th><th ${dir}>Frete</th><th ${dir}>Total ao cliente</th><th ${dir}>Por pessoa</th><th>Situação</th></tr></thead><tbody>
    ${ORC.hist.map((o) => { const s = ORC_SIT[o.situacao] || [o.situacao, 'var(--tx-3)'];
      return `<tr style="cursor:pointer;${ORC.aberto === o.id ? 'background:var(--surface-2);' : ''}" onclick="orcAbrir(${o.id})"><td>${o.id}</td><td>${orcD(o.criado_em)}</td><td>${o.origem === 'LOJA' ? '<b style="color:var(--marca-amarelo);">veio pelo link</b>' : trEscH(String(o.criado_por || '').split('@')[0])}</td><td>${trEscH(o.cliente || '')}</td><td style="white-space:normal;">${orcEntregaCurta(o)}</td>
        <td ${dir}>${orcTemPessoas(o.n_lanches) ? o.n_lanches : '–'}</td><td ${dir}>${orcQ(o.pct_lucro)}%</td><td ${dir}>${orcR(o.custo_total)}</td><td ${dir}>${orcR(o.frete)}</td><td ${dir}>${orcR(o.total_cliente)}</td><td ${dir}>${orcTemPessoas(o.n_lanches) ? orcR(orcPorPessoa(o)) : '–'}</td>
        <td style="color:${s[1]};font-weight:700;">${s[0]}</td></tr>
        ${ORC.aberto === o.id ? `<tr><td colspan="12" style="white-space:normal;cursor:default;" onclick="event.stopPropagation()">${orcDetalheHtml(o)}</td></tr>` : ''}`; }).join('')}
    </tbody></table></div>`;
}
function orcEntregaCurta(o) { return [ORC_FORMA[o.entrega_forma] || '', orcHora(o.entrega_quando)].filter(Boolean).join(' · '); }
// contato, entrega e cobrança: o que a equipe precisa saber (o mesmo no orçamento aprovado e na lista de separação)
function orcEntregaLinhas(o) {
  return [['Contato', o.cliente_contato], ['Entrega', ORC_FORMA[o.entrega_forma]], ['Quando', orcHora(o.entrega_quando)], ['Onde', o.entrega_local], ['Cobrança', o.cobranca], ['Observação', o.obs]].filter(([, v]) => v);
}
function orcEntregaHtml(o) {
  const L = orcEntregaLinhas(o);
  return L.length ? `<table style="margin-bottom:10px;"><tbody>${L.map(([r, v]) => `<tr><td style="width:1%;white-space:nowrap;">${r}</td><td style="white-space:normal;">${trEscH(v)}</td></tr>`).join('')}</tbody></table>` : '';
}
function orcBotaoSit(o, sit, rot, forte) { return o.situacao === sit ? '' : `<button type="button" class="preset-btn${forte ? ' active' : ''}" onclick="orcSituacao(${o.id}, '${sit}')">${rot}</button>`; }
function orcSeparacaoHtml(o) {
  const L = ORC.itens[o.id] || [];
  return `<h3 style="margin:0 0 8px;font-size:15px;">Lista de separação · orçamento nº ${o.id}${o.cliente ? ' · ' + trEscH(o.cliente) : ''}</h3>
    ${orcEntregaHtml(o)}<table><thead><tr><th>Item</th><th style="text-align:right;">Quantidade</th><th>Un</th></tr></thead>
    <tbody>${L.map((x) => `<tr><td>${x.produto_nome ? `${orcQ(x.produto_qtd)} × ${trEscH(x.produto_nome)}` : orcNomeBase(x)}</td><td style="text-align:right;">${orcQ(x.qtd_total)}</td><td>${trEscH(x.un)}</td></tr>`).join('')}</tbody></table>`;
}
// pedido do link: a linha tem o preço de venda (preco_un); no kit ele é por pessoa
function orcLinhasPreco(o, lin) {
  return (ORC.itens[o.id] || []).filter((x) => x.preco_un != null).map((x) => {
    // produto do atacado (04/11/2026): quantidade em pacotes e preço do pacote
    if (x.produto_nome) return lin(`${trEscH(x.produto_nome)} · ${orcQ(x.produto_qtd)} × ${orcR(x.produto_preco)}`, orcR(Number(x.produto_qtd) * Number(x.produto_preco)));
    const q = x.por === 'LANCHE' ? Number(o.n_lanches) : Number(x.qtd_informada);
    return lin(`${trEscH((ORC.vitrine && ORC.vitrine.get(x.item)) || x.item)} · ${orcQ(q)} × ${orcR(x.preco_un)}`, orcR(q * Number(x.preco_un)));
  }).join('');
}
function orcClienteHtml(o) {
  const lin = (r, v, b) => `<tr><td>${b ? `<b>${r}</b>` : r}</td><td style="text-align:right;">${b ? `<b>${v}</b>` : v}</td></tr>`;
  return `<h3 style="margin:0 0 8px;font-size:15px;">Orçamento nº ${o.id}${o.cliente ? ' · ' + trEscH(o.cliente) : ''}</h3>
    ${orcEntregaHtml(o)}<table><tbody>${orcLinhasPreco(o, lin)}${orcTemPessoas(o.n_lanches) ? lin('Pessoas', o.n_lanches) + lin('Lanches', orcR(o.preco_total)) : lin('Itens', orcR(o.preco_total))}${Number(o.frete) ? lin('Frete', orcR(o.frete)) : ''}${lin('Total', orcR(o.total_cliente), true)}${orcTemPessoas(o.n_lanches) ? lin('Valor por pessoa, sem frete', orcR(orcPorPessoa(o))) : ''}</tbody></table>
    <div style="margin-top:6px;font-size:12px;">${orcD(o.criado_em)}</div>`;
}
function orcDetalheHtml(o) {
  const L = ORC.itens[o.id] || [];
  return `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:4px 0 12px;">
      ${orcBotaoSit(o, 'APROVADO', 'Aprovar', true)}${orcBotaoSit(o, 'RECUSADO', 'Recusar')}${orcBotaoSit(o, 'ORCADO', 'Voltar para orçado')}
      ${o.situacao === 'APROVADO' && o.aprovado_em ? `<span style="font-size:12px;color:var(--tx-3);">aprovado em ${orcD(o.aprovado_em)}${o.aprovado_por ? ' por ' + trEscH(String(o.aprovado_por).split('@')[0]) : ''}</span>` : ''}
      <span style="display:inline-flex;gap:6px;align-items:center;margin-left:auto;"><label for="orcFrete${o.id}" style="font-size:12px;color:var(--tx-3);">Frete combinado</label>
        <input id="orcFrete${o.id}" type="text" inputmode="decimal" value="${orcQ(o.frete)}" style="width:80px;text-align:right;"><button type="button" class="preset-btn" onclick="orcGravarFrete(${o.id})">Gravar frete</button></span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;align-items:start;">
      <div>${orcSeparacaoHtml(o)}<div style="margin-top:8px;"><button type="button" class="preset-btn" onclick="orcImprimir(${o.id},'separacao')">🖨 Imprimir a lista</button></div></div>
      <div>${orcClienteHtml(o)}<div style="margin-top:8px;"><button type="button" class="preset-btn" onclick="orcImprimir(${o.id},'cliente')">🖨 Imprimir o orçamento</button></div></div>
      <div><h3 style="margin:0 0 8px;font-size:15px;">Custo do dia</h3><table><thead><tr><th>Item</th><th style="text-align:right;">Custo do item</th><th>Origem</th><th style="text-align:right;">Custo</th></tr></thead>
        <tbody>${L.map((x) => `<tr><td>${orcNomeBase(x)}</td><td style="text-align:right;">${orcR(x.custo_un)}/${trEscH(x.un)}</td><td style="font-size:12px;">${orcFonte(x)}</td><td style="text-align:right;">${orcR(x.custo_linha)}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="sub"><td colspan="3">Custo</td><td style="text-align:right;">${orcR(o.custo_total)}</td></tr></tfoot></table></div>
    </div>`;
}
function orcImprimir(id, qual) {
  const o = (ORC.hist || []).find((x) => x.id === id); if (!o) return;
  let p = orcEl('orcImpressao');
  if (!p) { p = document.createElement('div'); p.id = 'orcImpressao'; document.body.appendChild(p); }
  p.innerHTML = qual === 'separacao' ? orcSeparacaoHtml(o) : orcClienteHtml(o);
  document.body.classList.add('orc-imprimindo');
  const fim = () => { document.body.classList.remove('orc-imprimindo'); window.removeEventListener('afterprint', fim); };
  window.addEventListener('afterprint', fim);
  window.print();
}
async function orcGravarFrete(id) {
  const ent = orcEl('orcFrete' + id), txt = String(ent ? ent.value : '').trim();
  const v = Number(txt.includes(',') ? txt.replace(/\./g, '').replace(',', '.') : txt);
  if (txt === '' || !Number.isFinite(v) || v < 0) return avisoAcao('erro', '✗ Não gravou: digite o valor do frete.');
  avisoAcao('enviando', 'Gravando o frete…');
  const r = await trRpcSeguro('orc_frete', { p_id: id, p_frete: v });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou o frete: ${await trErroDe(r)}.`, () => orcGravarFrete(id));
  const d = await r.json();
  avisoAcao('ok', `✓ Frete do orçamento nº ${id} gravado: total ao cliente ${orcR(d.total_cliente)} — às ${avisoHora()}.`);
  await orcHistorico();
}
async function orcSituacao(id, sit) {
  const ok = { APROVADO: 'Aprovado: a lista de separação sai do estoque da AV', RECUSADO: 'Recusado', ORCADO: 'Voltou para orçado' }[sit];
  avisoAcao('enviando', 'Mudando a situação…');
  const r = await trRpcSeguro('orc_situacao', { p_id: id, p_situacao: sit });
  if (!r.ok) return avisoAcao('erro', `✗ Não mudou: ${await trErroDe(r)}.`, () => orcSituacao(id, sit));
  const o = (ORC.hist || []).find((x) => x.id === id), tinhaBaixa = o && o.situacao === 'APROVADO';
  avisoAcao('ok', `✓ ${ok}${sit !== 'APROVADO' && tinhaBaixa ? '; a baixa do estoque foi desfeita' : ''} — às ${avisoHora()}.`);
  await orcHistorico();
}

// ---------------------------------------------------------------- Pedidos aprovados (a equipe: sem custo nem lucro)
async function orcEquipe() {
  try { ORC.equipe = await consultarTudo('vw_orc_pedidos_equipe?select=numero,cliente,cliente_contato,entrega_forma,entrega_quando,entrega_local,cobranca,frete,total_cliente,obs,criado_por,aprovado_em,itens&order=numero.desc'); ORC.erroEquipe = null; }
  catch (e) { ORC.erroEquipe = e.message; }
  if (ORC.aba === 'equipe') orcRender();
}
function orcEquipeHtml() {
  if (ORC.erroEquipe) return `<div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler os pedidos: ${trEscH(ORC.erroEquipe)}</div>`;
  if (!ORC.equipe) return '<div class="contexto">Lendo…</div>';
  if (!ORC.equipe.length) return '<div class="contexto">Nenhum pedido aprovado.</div>';
  // os próximos primeiro, do mais perto ao mais longe; os que já passaram vão para o fim
  const agora = Date.now(), tempo = (x) => x.entrega_quando ? new Date(x.entrega_quando).getTime() : null;
  const L = [...ORC.equipe].sort((a, b) => {
    const ta = tempo(a), tb = tempo(b), pa = ta == null ? 1 : ta < agora ? 2 : 0, pb = tb == null ? 1 : tb < agora ? 2 : 0;
    return pa - pb || (pa === 2 ? tb - ta : (ta || 0) - (tb || 0));
  });
  return `<div id="tabelaOrcEquipe" class="cel-cartao"><table><thead><tr><th>Nº</th><th>Cliente</th><th>Contato</th><th>Entrega</th><th>Quando</th><th>Onde</th><th>Cobrança</th><th>Itens</th><th style="text-align:right;">Frete</th><th style="text-align:right;">Total</th><th>Observação</th></tr></thead><tbody>
    ${L.map((x) => { const passou = tempo(x) != null && tempo(x) < agora;
      return `<tr${passou ? ' style="opacity:.55;"' : ''}><td>${x.numero}</td><td style="white-space:normal;">${trEscH(x.cliente || '')}</td><td>${trEscH(x.cliente_contato || '')}</td><td>${trEscH(ORC_FORMA[x.entrega_forma] || '')}</td><td>${orcHora(x.entrega_quando)}</td>
        <td style="white-space:normal;">${trEscH(x.entrega_local || '')}</td><td style="white-space:normal;">${trEscH(x.cobranca || '')}</td>
        <td style="white-space:normal;">${(x.itens || []).map((i) => `${orcQ(i.qtd)} ${trEscH(i.un || '')} ${trEscH(i.item)}`).join('<br>')}</td>
        <td style="text-align:right;">${orcR(x.frete)}</td><td style="text-align:right;">${orcR(x.total_cliente)}</td><td style="white-space:normal;">${trEscH(x.obs || '')}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}

// ---------------------------------------------------------------- Lojinha por empresa (gestão)
// 30/10/2026 (dono no chat Atacado, 23:45): cada empresa tem link próprio, preço e frete. Proposta: contexto/propostas-telas/2026-10-30-lojinha-substituir-epadoca.md, seção 7b.
// Só DONO e FINANCEIRO. Ligar empresa real é decisão do dono: o botão sempre pede confirmação e diz o efeito.
// 12/11/2026 (dono, 00:25; proposta contexto/propostas-telas/2026-11-12-loja-online.md): tabela que a empresa segue, pessoas que entram
// (convite) e áreas de entrega. O código do convite só aparece na resposta do loja_usuario_convidar e fica só na memória desta tela.
const LG = { papel: undefined, aba: 'empresas', emp: null, prod: null, preco: null, erro: null, busca: '', filtro: null, confirma: null, empresa: '', bprod: '',
             modelos: [], usuarios: null, erroUsu: null, areas: null, erroAreas: null, minimoGeral: null, aberto: null, convite: null, confirmaU: null, areaEd: null };
const LG_USU = 'loja_usuario?select=id,empresa_id,nome,email,celular,ativo,bloqueado_ate,ultimo_acesso,convite_expira&order=nome';
const LG_AREAS = 'loja_area_entrega?select=id,canal,unidade,cidade,bairro,frete,minimo,ativa,origem&order=canal,cidade,bairro.nullsfirst';
const lgEl = () => document.getElementById('view-lojaempresas');
const lgNum = (t) => { t = String(t).trim(); return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); };
const LG_PAGINA = new URL('../lojinha.html', document.currentScript.src).href;   // pelo script: este arquivo roda em atacado/index.html e em dashboard.html
const lgLink = (e) => LG_PAGINA + '?c=' + encodeURIComponent(e.chave);
const lgDin = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function entrarLojaEmpresas() {
  orcEstilo();
  const v = lgEl(); if (!v) return;
  v.innerHTML = '<div class="contexto">Lendo…</div>';
  const r = await trRpcSeguro('tr_meu_papel', {});
  LG.papel = r.ok ? await r.json() : null;
  if (!ORC_PAPEIS.includes(LG.papel)) { v.innerHTML = '<div class="contexto">Nada para mostrar — este login não cuida da lojinha.</div>'; return; }
  try {
    const [emp, prod, preco, config, modelos, minimo] = await Promise.all([
      consultarTudo('loja_empresa?select=id,nome,situacao_portal,chave,ativa,frete,tabela_id&modelo=eq.false&order=nome'),
      consultarTudo('loja_produto?select=id,nome_vitrine,un_vitrine,un,ativo,ordem&tipo=eq.ATACADO&order=ordem,nome_vitrine'),
      consultarTudo('loja_preco?select=empresa_id,produto_id,preco'),
      consultarTudo('loja_config?select=aberta').catch(() => []),
      consultarTudo('loja_empresa?select=id,nome&modelo=is.true&order=nome').catch(() => []),
      consultarTudo('loja_config?select=minimo_empresa').catch(() => [])]);
    Object.assign(LG, { emp, prod, preco, modelos, aberta: config[0] ? config[0].aberta : null, minimoGeral: minimo[0] ? minimo[0].minimo_empresa : null, erro: null });
  } catch (e) { LG.erro = e.message; }
  // pessoas e áreas à parte: se faltar, só a parte delas mostra o erro
  await Promise.all([lgLerUsuarios(), lgLerAreas()]);
  lgRender();
}
async function lgLerUsuarios() { try { LG.usuarios = await consultarTudo(LG_USU); LG.erroUsu = null; } catch (e) { LG.usuarios = null; LG.erroUsu = e.message; } }
async function lgLerAreas() { try { LG.areas = await consultarTudo(LG_AREAS); LG.erroAreas = null; } catch (e) { LG.areas = null; LG.erroAreas = e.message; } }
function lgAba(a) { LG.aba = a; LG.confirma = null; LG.confirmaU = null; LG.convite = null; LG.areaEd = null; lgRender(); }
function lgRender() {
  const v = lgEl(); if (!v) return;
  if (LG.erro) { v.innerHTML = `<h2>Lojinha por empresa</h2><div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler: ${trEscH(LG.erro)}</div>`; return; }
  const aba = (k, r) => `<button type="button" onclick="lgAba('${k}')" style="background:none;border:0;border-bottom:3px solid ${LG.aba === k ? 'var(--marca-amarelo)' : 'transparent'};padding:8px 12px;cursor:pointer;font:inherit;font-weight:700;color:${LG.aba === k ? 'var(--tx-1)' : 'var(--tx-3)'};">${r}</button>`;
  const situacao = LG.aberta === true ? '<b style="color:var(--farol-ok);">Aberta</b>' : LG.aberta === false ? '<b style="color:var(--tx-3);">Fechada: quem abrir vê "Em breve"</b>' : '';
  v.innerHTML = `<h2 style="margin:0 0 10px;">Lojinha por empresa</h2>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 12px;"><b>Link da lojinha</b> <a href="${trEscH(LG_PAGINA)}" target="_blank" rel="noopener" style="overflow-wrap:anywhere;color:var(--tx-1);">${trEscH(LG_PAGINA)}</a> <a class="preset-btn" href="${trEscH(LG_PAGINA)}" target="_blank" rel="noopener" style="text-decoration:none;">Abrir</a> <button type="button" class="preset-btn" onclick="lgCopiarGeral()">Copiar</button> ${situacao}</div>
    <div style="display:flex;flex-wrap:wrap;gap:2px;border-bottom:1px solid var(--line);margin:0 0 12px;">${aba('empresas', 'Empresas')}${aba('precos', 'Preços por empresa')}${aba('produtos', 'Produtos')}${aba('areas', 'Áreas de entrega')}</div>
    <div id="lgCorpo">${LG.aba === 'empresas' ? lgEmpresasHtml() : LG.aba === 'precos' ? lgPrecosHtml() : LG.aba === 'areas' ? lgAreasHtml() : lgProdutosHtml()}</div>`;
}
function lgEmpresasHtml() {
  const lig = LG.emp.filter((e) => e.ativa), des = LG.emp.filter((e) => !e.ativa), b = orcNorm(LG.busca);
  const card = (id, rot, n) => `<div class="card neutral" style="cursor:pointer;${LG.filtro === id ? 'outline:2px solid var(--marca-amarelo);' : ''}" onclick="LG.filtro=LG.filtro==='${id}'?null:'${id}';lgRender()"><div class="card-lbl">${rot}</div><div class="card-val">${n}</div></div>`;
  const L = (LG.filtro === 'ligadas' ? lig : LG.filtro === 'desligadas' ? des : LG.emp).filter((e) => !b || orcNorm(e.nome).includes(b));
  const nPreco = (id) => LG.preco.filter((x) => x.empresa_id === id).length;
  return `<div class="cards">${card('ligadas', 'Link ligado', lig.length)}${card('desligadas', 'Link desligado', des.length)}</div>
    <input id="lgBusca" type="search" placeholder="Buscar empresa" value="${trEscH(LG.busca)}" style="width:260px;margin:0 0 10px;" oninput="LG.busca=this.value;lgRender();const i=document.getElementById('lgBusca');i.focus();i.setSelectionRange(i.value.length,i.value.length)">
    <div id="tabelaLgEmpresas" style="overflow-x:auto;"><table><thead><tr><th>Empresa</th><th>No ePadoca</th><th style="text-align:right;">Preços</th><th>Tabela que segue</th><th>Pessoas que entram</th><th>Frete</th><th>Link</th><th>Situação</th></tr></thead><tbody>
    ${L.map((e) => { const c = LG.confirma;
      const tabela = `<select onchange="lgTabela(${e.id},this.value)" aria-label="Tabela de ${trEscH(e.nome)}"><option value="">Só a lista própria</option>${LG.modelos.map((m) => `<option value="${m.id}"${e.tabela_id === m.id ? ' selected' : ''}>${trEscH(m.nome)}</option>`).join('')}</select>`;
      const nUsu = LG.usuarios ? LG.usuarios.filter((u) => u.empresa_id === e.id).length : null;
      const pessoas = `<button type="button" class="preset-btn${LG.aberto === e.id ? ' active' : ''}" onclick="LG.aberto=LG.aberto===${e.id}?null:${e.id};LG.convite=null;LG.confirmaU=null;lgRender()">${nUsu == null ? 'Ver' : nUsu ? `${nUsu} ${nUsu === 1 ? 'pessoa' : 'pessoas'}` : 'Convidar'}</button>`;
      const ficha = LG.aberto === e.id ? `<tr><td colspan="8" style="white-space:normal;background:var(--surface-2);">${lgPessoasHtml(e)}</td></tr>` : '';
      const alerta = c && c.id === e.id ? `<tr><td colspan="8" style="white-space:normal;"><b style="color:var(--farol-perto);">${c.tipo === 'ligar' ? `Ligar ${trEscH(e.nome)}: quem tiver o link passa a fazer pedidos de verdade.` : `Trocar o link de ${trEscH(e.nome)}: o link antigo para de funcionar.`}</b>
          <button type="button" class="preset-btn active" style="margin-left:8px;" onclick="${c.tipo === 'ligar' ? `lgAjustar(${e.id},{p_ativa:true},'Link ligado')` : `lgAjustar(${e.id},{p_trocar_chave:true},'Link trocado')`}">Confirmar</button>
          <button type="button" class="preset-btn" onclick="LG.confirma=null;lgRender()">Voltar</button></td></tr>` : '';
      return `<tr><td style="white-space:normal;">${trEscH(e.nome)}</td><td>${trEscH(e.situacao_portal || '')}</td><td style="text-align:right;">${nPreco(e.id)}</td>
        <td style="white-space:nowrap;">${tabela}</td><td style="white-space:nowrap;">${pessoas}</td>
        <td style="white-space:nowrap;"><input id="lgFrete${e.id}" type="text" inputmode="decimal" value="${lgDin(e.frete)}" style="width:70px;text-align:right;"> <button type="button" class="preset-btn" onclick="lgGravarFrete(${e.id})">Gravar</button></td>
        <td style="white-space:nowrap;"><button type="button" class="preset-btn" onclick="lgCopiar(${e.id})">Copiar link</button> <button type="button" class="preset-btn" onclick="LG.confirma={id:${e.id},tipo:'trocar'};lgRender()">Trocar</button></td>
        <td style="white-space:nowrap;"><b style="color:${e.ativa ? 'var(--farol-ok)' : 'var(--tx-3)'};">${e.ativa ? 'Ligado' : 'Desligado'}</b> ${e.ativa ? `<button type="button" class="preset-btn" onclick="lgAjustar(${e.id},{p_ativa:false},'Link desligado')">Desligar</button>` : `<button type="button" class="preset-btn" onclick="LG.confirma={id:${e.id},tipo:'ligar'};lgRender()">Ligar</button>`}</td></tr>${alerta}${ficha}`; }).join('')}
    </tbody></table></div>`;
}
async function lgCopiarGeral() {
  try { await navigator.clipboard.writeText(LG_PAGINA); avisoAcao('ok', `✓ Link da lojinha copiado${LG.aberta === false ? ', mas ela está fechada: quem abrir vê "Em breve"' : ''} — às ${avisoHora()}.`); }
  catch (x) { avisoAcao('erro', `✗ Não copiou. O link é: ${LG_PAGINA}`); }
}
async function lgCopiar(id) {
  const e = LG.emp.find((x) => x.id === id); if (!e) return;
  try { await navigator.clipboard.writeText(lgLink(e)); avisoAcao('ok', `✓ Link de ${e.nome} copiado${e.ativa ? '' : ', mas está desligado: quem abrir vê "Link indisponível"'} — às ${avisoHora()}.`); }
  catch (x) { avisoAcao('erro', `✗ Não copiou. O link é: ${lgLink(e)}`); }
}
async function lgAjustar(id, campos, feito) {
  const e = LG.emp.find((x) => x.id === id); if (!e) return;
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('loja_empresa_ajustar', Object.assign({ p_empresa: id }, campos));
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}.`, () => lgAjustar(id, campos, feito));
  const d = await r.json();
  Object.assign(e, { ativa: d.ativa, frete: d.frete, chave: d.chave });
  LG.confirma = null; lgRender();
  avisoAcao('ok', `✓ ${feito}: ${e.nome} — às ${avisoHora()}.`);
}
function lgGravarFrete(id) {
  const t = (document.getElementById('lgFrete' + id) || {}).value, v = lgNum(t);
  if (!String(t || '').trim() || !Number.isFinite(v) || v < 0) return avisoAcao('erro', '✗ Não gravou: digite o valor do frete.');
  return lgAjustar(id, { p_frete: v }, 'Frete gravado');
}
// tabela de preço que a empresa segue (preço próprio vale por cima dela); vazio = só a lista própria
async function lgTabela(id, v) {
  const e = LG.emp.find((x) => x.id === id); if (!e) return;
  const tab = v === '' ? null : Number(v), nomeTab = tab ? ((LG.modelos.find((m) => m.id === tab) || {}).nome || '') : '';
  avisoAcao('enviando', 'Gravando a tabela…');
  const r = await trRpcSeguro('loja_empresa_tabela', { p_empresa: id, p_tabela: tab });
  if (!r.ok) { const m = await trErroDe(r); lgRender(); return avisoAcao('erro', `✗ Não gravou: ${m}.`, () => lgTabela(id, v)); }
  e.tabela_id = tab; lgRender();
  avisoAcao('ok', `✓ ${e.nome} ${tab ? `segue a tabela ${nomeTab}` : 'fica só com a lista própria'} — às ${avisoHora()}.`);
}
// ficha das pessoas que entram na lojinha por esta empresa (login do cliente; nunca é login do painel)
function lgPessoasHtml(e) {
  if (!LG.usuarios) return `<div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler as pessoas: ${trEscH(LG.erroUsu || '')}</div>`;
  const L = LG.usuarios.filter((u) => u.empresa_id === e.id), cv = LG.convite && LG.convite.empresa === e.id ? LG.convite : null;
  const link = cv ? `<div style="margin:0 0 10px;padding:10px;border:1px solid var(--farol-ok);border-radius:8px;"><b style="color:var(--farol-ok);">✓ Convite criado para ${trEscH(cv.nome)}: copie o link e mande para a pessoa.</b>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;"><input readonly value="${trEscH(cv.link)}" style="flex:1;min-width:260px;" onfocus="this.select()"> <button type="button" class="preset-btn active" onclick="lgCopiarConvite()">Copiar link</button></div>
      <div style="color:var(--tx-3);margin-top:4px;">Vale 7 dias, só uma vez (até ${orcHora(cv.expira)}). Este link não aparece de novo: se perder, mande um novo convite.</div></div>` : '';
  const linha = (u) => { const conf = LG.confirmaU === u.id;
    return `<tr><td style="white-space:normal;">${trEscH(u.nome)}</td><td>${trEscH(u.email || '')}</td><td>${trEscH(orcFone(u.celular || ''))}</td>
      <td>${u.ultimo_acesso ? orcHora(u.ultimo_acesso) : 'nunca entrou'}</td><td>${u.convite_expira ? orcHora(u.convite_expira) : ''}</td>
      <td style="white-space:nowrap;"><b style="color:${u.ativo ? 'var(--farol-ok)' : 'var(--tx-3)'};">${u.ativo ? 'Entra' : 'Desligada'}</b>
        <button type="button" class="preset-btn" onclick="lgUsuarioAtivar(${u.id},${!u.ativo})">${u.ativo ? 'Desligar' : 'Religar'}</button>
        <button type="button" class="preset-btn" onclick="LG.confirmaU=${u.id};LG.convite=null;lgRender()">Mandar novo convite</button></td></tr>
      ${conf ? `<tr><td colspan="6" style="white-space:normal;"><b style="color:var(--farol-perto);">Novo convite para ${trEscH(u.nome)}: a senha atual para de valer e a pessoa sai de todos os aparelhos até criar outra.</b>
        <button type="button" class="preset-btn active" style="margin-left:8px;" onclick="lgConvidar(${e.id},${u.id})">Confirmar</button> <button type="button" class="preset-btn" onclick="LG.confirmaU=null;lgRender()">Voltar</button></td></tr>` : ''}`; };
  return `<b>Pessoas que entram por ${trEscH(e.nome)}</b>${link}
    ${L.length ? `<div style="overflow-x:auto;margin:6px 0 10px;"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Celular</th><th>Último acesso</th><th>Convite vence</th><th>Situação</th></tr></thead><tbody>${L.map(linha).join('')}</tbody></table></div>`
      : '<div class="contexto" style="margin:6px 0 10px;">Ninguém entra por esta empresa ainda.</div>'}
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;"><b>Convidar pessoa</b>
      <input id="lgCvNome" placeholder="Nome" maxlength="80" style="width:180px;"> <input id="lgCvEmail" type="email" placeholder="E-mail" maxlength="120" style="width:200px;">
      <input id="lgCvCel" inputmode="tel" placeholder="Celular com DDD" maxlength="20" style="width:150px;">
      <button type="button" class="preset-btn active" onclick="lgConvidar(${e.id},null)">Convidar</button></div>`;
}
async function lgConvidar(emp, usuario) {
  const u = usuario ? (LG.usuarios || []).find((x) => x.id === usuario) : null;
  const val = (id) => String((document.getElementById(id) || {}).value || '').trim();
  const nome = u ? u.nome : val('lgCvNome'), email = u ? u.email : val('lgCvEmail'), cel = u ? u.celular : val('lgCvCel');
  if (!u && nome.length < 2) return avisoAcao('erro', '✗ Não criou: digite o nome da pessoa.');
  if (!u && !email && !cel) return avisoAcao('erro', '✗ Não criou: digite o e-mail ou o celular.');
  avisoAcao('enviando', 'Criando o convite…');
  const r = await trRpcSeguro('loja_usuario_convidar', { p_empresa: emp, p_nome: nome, p_email: email || null, p_celular: cel || null });
  if (!r.ok) return avisoAcao('erro', `✗ Não criou: ${await trErroDe(r)}.`, () => lgConvidar(emp, usuario));
  const d = await r.json();
  LG.convite = { empresa: emp, nome, link: LG_PAGINA + '?convite=' + encodeURIComponent(d.convite), expira: d.expira };
  LG.confirmaU = null;
  await lgLerUsuarios();
  lgRender();
  avisoAcao('ok', `✓ Convite criado para ${nome}, copie o link — às ${avisoHora()}.`);
}
async function lgCopiarConvite() {
  if (!LG.convite) return;
  try { await navigator.clipboard.writeText(LG.convite.link); avisoAcao('ok', `✓ Link do convite de ${LG.convite.nome} copiado — às ${avisoHora()}.`); }
  catch (x) { avisoAcao('erro', '✗ Não copiou: selecione o link na caixa e copie à mão.'); }
}
async function lgUsuarioAtivar(id, ativo) {
  const u = (LG.usuarios || []).find((x) => x.id === id);
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('loja_usuario_ativar', { p_usuario: id, p_ativo: ativo });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}.`, () => lgUsuarioAtivar(id, ativo));
  if (u) u.ativo = ativo;
  lgRender();
  avisoAcao('ok', `✓ ${u ? u.nome : 'Pessoa'} ${ativo ? 'religada: volta a entrar' : 'desligada: não entra mais e saiu dos aparelhos'} — às ${avisoHora()}.`);
}
// ---- áreas de entrega: onde a lojinha entrega e quanto cobra (bairro vazio = a cidade toda; mínimo vazio = o geral)
function lgAreasHtml() {
  if (!LG.areas) return `<div class="contexto" style="color:var(--farol-fora);">✗ Não consegui ler as áreas: ${trEscH(LG.erroAreas || '')}</div>`;
  const geral = LG.minimoGeral != null ? `o geral (${orcR(LG.minimoGeral)})` : 'o geral';
  const editor = (a) => { a = a || { id: null, canal: 'ATACADO', cidade: '', bairro: '', frete: '', minimo: null, ativa: true, unidade: null };
    return `<tr><td><select id="lgArCanal">${['ATACADO', 'VAREJO'].map((c) => `<option${a.canal === c ? ' selected' : ''}>${c}</option>`).join('')}</select></td>
      <td><input id="lgArCidade" value="${trEscH(a.cidade)}" placeholder="Cidade" maxlength="80" style="width:160px;"></td>
      <td><input id="lgArBairro" value="${trEscH(a.bairro || '')}" placeholder="vazio = cidade toda" maxlength="80" style="width:150px;"></td>
      <td><input id="lgArFrete" inputmode="decimal" value="${a.frete === '' ? '' : lgDin(a.frete)}" style="width:70px;text-align:right;"></td>
      <td><input id="lgArMinimo" inputmode="decimal" value="${a.minimo == null ? '' : lgDin(a.minimo)}" placeholder="geral" style="width:70px;text-align:right;"></td>
      <td colspan="2" style="white-space:nowrap;"><button type="button" class="preset-btn active" onclick="lgAreaSalvar(${a.id == null ? 'null' : a.id})">Gravar</button> <button type="button" class="preset-btn" onclick="LG.areaEd=null;lgRender()">Voltar</button></td></tr>`; };
  const linha = (a) => LG.areaEd === a.id ? editor(a) : `<tr><td>${trEscH(a.canal)}</td><td style="white-space:normal;">${trEscH(a.cidade)}</td><td>${a.bairro ? trEscH(a.bairro) : 'cidade toda'}</td>
      <td style="text-align:right;">${orcR(a.frete)}</td><td style="text-align:right;">${a.minimo == null ? geral : orcR(a.minimo)}</td>
      <td style="white-space:nowrap;"><b style="color:${a.ativa ? 'var(--farol-ok)' : 'var(--tx-3)'};">${a.ativa ? 'Entrega' : 'Desligada'}</b>
        <button type="button" class="preset-btn" onclick="LG.areaEd=${a.id};lgRender()">Editar</button> <button type="button" class="preset-btn" onclick="lgAreaLigar(${a.id},${!a.ativa})">${a.ativa ? 'Desligar' : 'Ligar'}</button></td>
      <td style="white-space:normal;color:var(--tx-3);">${trEscH(a.origem || '')}</td></tr>`;
  return `<div style="margin:0 0 10px;"><button type="button" class="preset-btn active" onclick="LG.areaEd='novo';lgRender()">Nova área</button></div>
    <div id="tabelaLgAreas" style="overflow-x:auto;"><table><thead><tr><th>Canal</th><th>Cidade</th><th>Bairro</th><th style="text-align:right;">Frete</th><th style="text-align:right;">Pedido mínimo</th><th>Situação</th><th>Origem</th></tr></thead><tbody>
    ${LG.areaEd === 'novo' ? editor(null) : ''}${LG.areas.map(linha).join('') || (LG.areaEd === 'novo' ? '' : '<tr><td colspan="7">Nenhuma área cadastrada.</td></tr>')}</tbody></table></div>`;
}
async function lgAreaGravar(id, campos, feito) {
  avisoAcao('enviando', 'Gravando a área…');
  const r = await trRpcSeguro('loja_area_salvar', Object.assign({ p_id: id }, campos));
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}.`, () => lgAreaGravar(id, campos, feito));
  LG.areaEd = null;
  await lgLerAreas();
  lgRender();
  avisoAcao('ok', `✓ ${feito}: ${campos.p_cidade}${campos.p_bairro ? ' · ' + campos.p_bairro : ''} — às ${avisoHora()}.`);
}
function lgAreaSalvar(id) {
  const val = (k) => String((document.getElementById(k) || {}).value || '').trim();
  const a = id == null ? null : (LG.areas || []).find((x) => x.id === id);
  const tf = val('lgArFrete'), tm = val('lgArMinimo'), frete = lgNum(tf), minimo = tm === '' ? null : lgNum(tm);
  if (!val('lgArCidade')) return avisoAcao('erro', '✗ Não gravou: digite a cidade.');
  if (!tf || !Number.isFinite(frete) || frete < 0) return avisoAcao('erro', '✗ Não gravou: digite o frete (0 = grátis).');
  if (minimo !== null && !(Number.isFinite(minimo) && minimo >= 0)) return avisoAcao('erro', '✗ Não gravou: o pedido mínimo é um valor, ou vazio para o geral.');
  return lgAreaGravar(id, { p_canal: val('lgArCanal'), p_cidade: val('lgArCidade'), p_bairro: val('lgArBairro') || null, p_frete: frete, p_minimo: minimo,
    p_ativa: a ? a.ativa : true, p_unidade: a ? a.unidade : null }, id == null ? 'Área criada' : 'Área gravada');
}
function lgAreaLigar(id, ativa) {
  const a = (LG.areas || []).find((x) => x.id === id); if (!a) return;
  return lgAreaGravar(id, { p_canal: a.canal, p_cidade: a.cidade, p_bairro: a.bairro, p_frete: Number(a.frete), p_minimo: a.minimo == null ? null : Number(a.minimo), p_ativa: ativa, p_unidade: a.unidade },
    ativa ? 'Área ligada' : 'Área desligada');
}
function lgPrecosHtml() {
  const id = Number(LG.empresa), b = orcNorm(LG.bprod);
  const sel = `<select id="lgEmpresa" style="min-width:280px;" onchange="LG.empresa=this.value;lgRender()"><option value="">Escolha a empresa</option>${LG.emp.map((e) => `<option value="${e.id}"${id === e.id ? ' selected' : ''}>${trEscH(e.nome)}</option>`).join('')}</select>`;
  if (!id) return sel;
  const P = new Map(LG.preco.filter((x) => x.empresa_id === id).map((x) => [x.produto_id, x.preco]));
  // 12/11 (etapa 1b da lojinha): empresa ligada a uma tabela vê o preço dela onde não tem o próprio (loja_preco_vigente: próprio, senão o da tabela)
  const emp = LG.emp.find((e) => e.id === id) || {}, tabNome = emp.tabela_id ? ((LG.modelos.find((m) => m.id === emp.tabela_id) || {}).nome || 'tabela') : null;
  const PT = new Map(emp.tabela_id ? LG.preco.filter((x) => x.empresa_id === emp.tabela_id).map((x) => [x.produto_id, x.preco]) : []);
  const L = LG.prod.filter((p) => !b || orcNorm(p.nome_vitrine).includes(b));
  return `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;">${sel}<input id="lgBprod" type="search" placeholder="Buscar produto" value="${trEscH(LG.bprod)}" style="width:220px;" oninput="LG.bprod=this.value;lgRender();const i=document.getElementById('lgBprod');i.focus();i.setSelectionRange(i.value.length,i.value.length)"></div>
    ${tabNome ? `<div class="caption-label" style="text-align:left;margin:-4px 0 8px;">Segue a tabela <b>${trEscH(tabNome)}</b>: o preço próprio, quando gravado, vale no lugar do da tabela.</div>` : ''}
    <div id="tabelaLgPrecos" style="overflow-x:auto;"><table><thead><tr><th>Produto</th><th>Un</th><th>Preço próprio</th>${tabNome ? `<th>Preço da tabela</th>` : ''}<th>Na loja desta empresa</th></tr></thead><tbody>
    ${L.map((p) => { const v = P.get(p.id), tem = v != null, vt = PT.get(p.id), temT = vt != null;
      return `<tr><td style="white-space:normal;">${trEscH(p.nome_vitrine)}</td><td>${trEscH(p.un_vitrine || p.un || '')}</td>
        <td style="white-space:nowrap;"><input id="lgPreco${p.id}" type="text" inputmode="decimal" value="${tem ? lgDin(v) : ''}" style="width:80px;text-align:right;"> <button type="button" class="preset-btn" onclick="lgGravarPreco(${id},${p.id})">Gravar</button></td>
        ${tabNome ? `<td style="white-space:nowrap;color:${tem ? 'var(--tx-4)' : 'var(--tx-1)'};${tem && temT ? 'text-decoration:line-through;' : ''}">${temT ? 'R$ ' + lgDin(vt) : '–'}</td>` : ''}
        <td style="color:${!p.ativo ? 'var(--farol-perto)' : tem || temT ? 'var(--farol-ok)' : 'var(--tx-3)'};font-weight:700;">${!p.ativo ? 'Produto pausado' : tem ? 'Aparece' + (tabNome ? ' · preço próprio' : '') : temT ? 'Aparece · preço da tabela' : 'Não aparece'}</td></tr>`; }).join('')}
    </tbody></table></div>`;
}
async function lgGravarPreco(emp, prod) {
  const t = String((document.getElementById('lgPreco' + prod) || {}).value || '').trim(), v = t === '' ? null : lgNum(t);
  if (v !== null && !(v > 0)) return avisoAcao('erro', '✗ Não gravou: digite o preço, ou deixe vazio para tirar o produto desta empresa.');
  avisoAcao('enviando', 'Gravando o preço…');
  const r = await trRpcSeguro('loja_preco_salvar', { p_empresa: emp, p_produto: prod, p_preco: v });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}.`, () => lgGravarPreco(emp, prod));
  const d = await r.json();
  LG.preco = LG.preco.filter((x) => !(x.empresa_id === emp && x.produto_id === prod));
  if (d.preco != null) LG.preco.push({ empresa_id: emp, produto_id: prod, preco: d.preco });
  const nome = (LG.prod.find((p) => p.id === prod) || {}).nome_vitrine || '';
  lgRender();
  avisoAcao('ok', `${d.preco != null ? `✓ Preço gravado: ${nome}, ${orcR(d.preco)}` : `✓ Produto tirado desta empresa: ${nome}`} — às ${avisoHora()}.`);
}
function lgProdutosHtml() {
  const n = (id) => LG.preco.filter((x) => x.produto_id === id).length;
  return `<div id="tabelaLgProdutos" style="overflow-x:auto;"><table><thead><tr><th>Produto</th><th>Un</th><th style="text-align:right;">Empresas com preço</th><th>Situação</th></tr></thead><tbody>
    ${LG.prod.map((p) => `<tr><td style="white-space:normal;">${trEscH(p.nome_vitrine)}</td><td>${trEscH(p.un_vitrine || p.un || '')}</td><td style="text-align:right;">${n(p.id)}</td>
      <td style="white-space:nowrap;"><b style="color:${p.ativo ? 'var(--farol-ok)' : 'var(--farol-perto)'};">${p.ativo ? 'Ativo' : 'Pausado'}</b> <button type="button" class="preset-btn" onclick="lgProdutoAtivar(${p.id},${!p.ativo})">${p.ativo ? 'Pausar' : 'Ativar'}</button></td></tr>`).join('')}
    </tbody></table></div>`;
}
async function lgProdutoAtivar(id, ativo) {
  avisoAcao('enviando', 'Gravando…');
  const r = await trRpcSeguro('loja_produto_ativar', { p_produto: id, p_ativo: ativo });
  if (!r.ok) return avisoAcao('erro', `✗ Não gravou: ${await trErroDe(r)}.`, () => lgProdutoAtivar(id, ativo));
  const p = LG.prod.find((x) => x.id === id); if (p) p.ativo = ativo;
  lgRender();
  avisoAcao('ok', `✓ ${ativo ? 'Ativado' : 'Pausado para todas as empresas'}: ${p ? p.nome_vitrine : ''} — às ${avisoHora()}.`);
}
