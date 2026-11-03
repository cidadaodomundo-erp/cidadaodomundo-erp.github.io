// Fechamento de Caixas do painel Cidadão do Mundo (cofre de cada loja, contagem, SB → AV, cartão/vale × Rede, PIX ×
// banco e o mergulho do dia). Saiu de docs/dashboard.html em 26/10/2026 (bloco 3 do painel em módulos): MOVIDO, não
// copiado, em dois trechos que aqui ficam em sequência. Carregado pelo dashboard.html e por docs/caixa/index.html, depois
// do nucleo.js (consultarTudo, fmt, pct, rmbSessao, rmbHeaders, trEscH, carregarEmailDono, souODono). MODULO_ATUAL é de
// cada página. Quem mexe aqui: o chat "Telas do painel"; os dados são do chat Financeiro.

// ===================== CONCILIAÇÃO DE CARTÃO (fluxo da Arissa) =============
// Saipos (o que o PDV registrou de cartão e vale) × Rede (o que passou nas
// maquininhas), dia a dia, por loja. Método validado pelo dono em 28/08/2026:
// a régua é o SALDO ACUMULADO — diferença que aparece num dia e desaparece no
// outro é desencontro de horário (madrugada, comanda fechada depois); a que
// aparece e FICA é venda sem par, dinheiro para caçar. O vale-refeição
// (VR/Ticket/Alelo/Pluxee) também passa na maquininha da Rede, então entra.
// entrarConcartao/renderConcartao/renderConcartaoMotoboy sairam em 09/09/2026: a
// tabela diaria virou a linha do dia do Fechamento de Caixas e as pendencias
// (inclusive por motoboy) vivem no mergulho do dia, abrirDiaConcartao.

// Transações de um dia, lado a lado, com pareamento simples por valor + hora
// mais próxima (até 3 h — relógio de maquininha e comanda de salão atrasam).
// O que importa para a Arissa é o que SOBRA sem par: aparece primeiro, em cima.
// Filtro por CAIXA no mergulho (dono, 10/09/2026: "os caixas sao fechados separados;
// a pessoa escolhe o caixa que esta fechando e ve so as pendencias dele"). Linha sem
// caixa (transacao da maquininha sem venda) aparece nos dois.
let CAIXA_DRILL_CX = '';
let CAIXA_DRILL_DADOS = null;
// DINHEIRO = CONTAGEM, por caixa (dono, 10/09/2026 noite: "aparece la em cima o valor
// informado e la embaixo ainda aparece a pendencia"). O que o fechamento do Saipos lancou
// no cofre deixou de ser regua: a Arissa conta a gaveta e digita (enviado + troco); o
// painel compara vendido em dinheiro x enviado, caixa a caixa. Sem contagem = falta contar.
// Nome da forma como o Saipos mostra, para os dois lados baterem linha a linha (10/09/2026
// noite): Rede "crédito Visa" -> "Visa Crédito", "vale Alelo" -> "Alelo"; Saipos com e sem
// acento ("Master Credito") -> "Master Crédito"; "Pago Online" = "Pago iFood Online" (dono).
function formaPadrao(t) {
  const s0 = String(t || '').replace(/\s*\(hora da entrega\)/, '').replace(/\s*·\s*entrega$/, '').trim();
  const low = s0.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const band = b => ({ master: 'Master', visa: 'Visa', elo: 'Elo', amex: 'Amex', alelo: 'Alelo', pluxee: 'Pluxee (Sodexo)', sodexo: 'Pluxee (Sodexo)', vr: 'Vr', ticket: 'Ticket' })[b];
  let m;
  if ((m = low.match(/^(credito|debito)\s+([a-z]+)/))) { const b = band(m[2]); return !b ? s0 : b === 'Amex' ? 'Amex' : b + (m[1] === 'credito' ? ' Crédito' : ' Débito'); }
  if ((m = low.match(/^vale\s+([a-z]+)/))) return band(m[1]) || s0;
  if (/^pix qr no banco/.test(low)) return 'Pix QRCode Rede';
  if ((m = low.match(/^(master|visa|elo)\s+(credito|debito)/))) return band(m[1]) + (m[2] === 'credito' ? ' Crédito' : ' Débito');
  if (/^amex/.test(low)) return 'Amex';
  if (/^vr$/.test(low)) return 'Vr';
  if (/^(pluxee|sodexo)/.test(low)) return 'Pluxee (Sodexo)';
  if (/^pago (ifood )?online$/.test(low)) return 'Pago iFood Online';
  if (/^pix qrcode rede/.test(low)) return 'Pix QRCode Rede';
  if (/^pendente|nao cadastrado/.test(low)) return 'Pendente';
  return s0;
}
// TROCO DE ABERTURA (21/10/2026, erro provado com as contagens da Arissa): a gaveta abre com o
// troco que ficou na contagem anterior. Conta certa: enviado = abriu + vendido − ficou, ou seja,
// a venda que chegou = contado (enviado + ficou) − abriu. Sem isso 10, 11 e 12/10 da AV davam
// quebra falsa (+28, +37, −38) e fecham no centavo. Dia sem contagem entre duas contagens é
// "contado junto" com a seguinte (o vendido soma). Contagem anterior a mais de 3 dias não vale
// como abertura (ninguém sabe o que a gaveta tinha): aí a conta continua a antiga.
const CAIXA_ABRIU_MAX_DIAS = 3;
function caixaContagemVizinha(unidade, cx, dia, depois) {
  const lim = new Date(dia + 'T12:00:00'); lim.setDate(lim.getDate() + (depois ? CAIXA_ABRIU_MAX_DIAS : -CAIXA_ABRIU_MAX_DIAS));
  const limIso = lim.toLocaleDateString('en-CA');
  const cand = (CAIXA_CONTAGENS || []).filter(c => c.unidade === unidade && (c.caixa || 'SALÃO') === cx && c.troco !== null &&
    (depois ? c.data > dia && c.data <= limIso : c.data < dia && c.data >= limIso));
  return cand.sort((a, b) => (a.data < b.data ? (depois ? -1 : 1) : (depois ? 1 : -1)))[0] || null;
}
const CAIXA_DINHEIRO_ATE = '2026-10-21';   // depois disso o dinheiro se confere no cofre (gaveta + cofre x Saipos)
function caixaDinheiroDia(unidade, dia) {
  if (dia > CAIXA_DINHEIRO_ATE) return [];
  const rows = (CAIXA_DIAS_CX || []).filter(r => r.unidade === unidade && r.data === dia);
  const conts = (CAIXA_CONTAGENS || []).filter(c => c.unidade === unidade && c.data === dia);
  const caixas = [...new Set([...rows.map(r => r.caixa), ...conts.map(c => c.caixa || 'SALÃO')])].sort();
  return caixas.map(cx => {
    const r = rows.find(x => x.caixa === cx) || {};
    const c = conts.find(x => (x.caixa || 'SALÃO') === cx) || null;
    const vendido = +(r.dinheiro_pdv || 0), saidas = +(r.saidas || 0);
    const enviado = c ? (c.troco === null || c.troco === undefined ? +c.contado : Math.round((+c.contado - +c.troco) * 100) / 100) : null;
    const ant = c && c.troco !== null ? caixaContagemVizinha(unidade, cx, dia, false) : null;
    const abriu = ant ? +ant.troco : null, ficou = c && c.troco !== null ? +c.troco : null;
    const diasJuntos = ant ? (CAIXA_DIAS_CX || []).filter(x => x.unidade === unidade && x.caixa === cx && x.data > ant.data && x.data < dia && +x.dinheiro_pdv >= 0.01) : [];
    const vendidoConta = Math.round((vendido + diasJuntos.reduce((a, x) => a + +x.dinheiro_pdv, 0)) * 100) / 100;
    const chegou = c ? (ant ? Math.round((+c.contado - abriu) * 100) / 100 : enviado) : null;
    const dif = c ? Math.round((chegou - vendidoConta) * 100) / 100 : null;
    const porSaidas = !!c && saidas > 0 && Math.abs(chegou - (vendidoConta - saidas)) < 0.01;
    const bateu = !!c && (Math.abs(dif) < 0.01 || porSaidas);
    const junto = !c && vendido >= 0.01 ? caixaContagemVizinha(unidade, cx, dia, true) : null;
    return { caixa: cx, rot: cx === 'SALÃO' ? 'Salão' : 'Delivery', vendido, vendidoConta, diasJuntos, saidas, contagem: c, enviado, abriu, ficou, chegou, dif, porSaidas,
      bateu: bateu || !!junto, contadoJunto: junto ? junto.data : null,
      faltaContar: !c && !junto && vendido >= 0.01, aberto: !!r.caixa_aberto };
  });
}
function caixaDrillFiltro(cx) {
  CAIXA_DRILL_CX = cx;
  const d = CAIXA_DRILL_DADOS;
  if (d) renderDiaConcartao(d.unidade, d.dia, d.trs, d.pix, d.cobr, d.forma, d.descs, d.onl);
}
async function abrirDiaConcartao(unidade, dia) {
  const cont = document.getElementById('concartao-dia');
  if (!cont) return;
  CAIXA_DRILL_CX = (CAIXA_FILTRO && CAIXA_FILTRO.caixa) || '';   // o filtro do alto manda no clique do dia
  cont.innerHTML = '<div class="contexto">Carregando transações do dia...</div>';
  // vespera e dia seguinte entram como CANDIDATOS ao par (cartao passado 23:50 e
  // comanda fechada 00:29 nao pode aparecer sem par nos dois dias — dono, 09/09/2026);
  // so as linhas do proprio dia sao mostradas.
  const diaMais = k => { const x = new Date(dia + 'T12:00:00'); x.setDate(x.getDate() + k); return x.toLocaleDateString('en-CA'); };
  const [trs, pix, cobr, forma, descs, onl, robo] = await Promise.all([
    consultarTudo('vw_cartao_transacoes?select=*&dia=in.(' + [diaMais(-1), dia, diaMais(1)].join(',') + ')' +
      '&unidade=eq.' + encodeURIComponent(unidade) + '&order=dia,hora'),
    // PIX do dia (09/09/2026): QR da maquininha e chave, com o credito do banco que casou
    consultarTudo('vw_pix_conciliacao?select=id_sale,numero,numero_pedido,mesa,data_venda,caixa,tipo,valor,entrega,entregador,subgrupo,recebido,aguardando,memo_banco,data_banco,conta_banco&dia=eq.' + dia +
      '&unidade=eq.' + encodeURIComponent(unidade) + '&order=entrega'),
    // quem entregou cada venda de cartao/vale (para dizer "confirmar com o motoboy X")
    consultarTudo('vw_cartao_entrega_cobranca?select=id_sale,entregador&dia=eq.' + dia +
      '&unidade=eq.' + encodeURIComponent(unidade)),
    // forma registrada no PDV diferente da que passou (absorvida pela base; aqui so informa)
    consultarTudo('vw_cartao_bandeira_divergente?select=hora,registrado,passou,valor,nivel,numero,mesa,caixa,id_sale&dia=eq.' + dia +
      '&unidade=eq.' + encodeURIComponent(unidade) + '&order=hora'),
    // descontos MANUAIS do turno (salao e balcao) — a API diz valor e motivo, nao quem liberou (10/09/2026)
    consultarTudo('vw_descontos_dia?select=*&dia=eq.' + dia + '&unidade=eq.' + encodeURIComponent(unidade) + '&order=hora'),
    // online por caixa (10/09/2026 noite): a conferencia e "forma bate com o canal do pedido"
    consultarTudo('vw_caixa_online_dia?select=*&dia=eq.' + dia + '&unidade=eq.' + encodeURIComponent(unidade) + '&order=hora'),
    // troca de bandeira provada que o robô faz no Saipos (dono, 03/11/2026: "que vá pra diferença do caixa apenas diferenças de valores")
    consultarTudo('vw_caixa_troca_bandeira_robo?select=id_sale,valor,caixa,hora_venda,numero,mesa,forma_no_saipos,forma_nova,acao,feito_em&dia=eq.' + dia +
      '&unidade=eq.' + encodeURIComponent(unidade) + '&acao=in.(TROCAR,FEITO_AGUARDA_CARGA)').catch(() => []),
  ]);
  CAIXA_DRILL_DADOS = { unidade, dia, trs, pix, cobr, forma, descs, onl, robo };
  renderDiaConcartao(unidade, dia, trs, pix, cobr, forma, descs, onl);
}
// calc = { robo } (03/11/2026, lista da Hellen): faz o mesmo cruzamento sem desenhar e devolve as pendências do dia
function renderDiaConcartao(unidade, dia, trs, pix, cobr, forma, descs, onl, calc) {
  const cont = calc ? null : document.getElementById('concartao-dia');
  if (!cont && !calc) return;
  const reaisCc = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const min = h => { const p = (h || '0:0:0').split(':'); return (+p[0]) * 60 + (+p[1]); };
  // minutos contados a partir da meia-noite do dia aberto (vespera negativa, seguinte > 1440)
  // hora antes das 10h pertence ao FIM do turno (dia = turno; corte 06:00 de 10/09/2026, 10:00 desde 03/11/2026 — dono: "o dia vai das 10:00 até o fechamento do caixa")
  const CORTE_TURNO = 600;
  trs.forEach(x => { const m0 = min(x.hora); x.t = m0 + (m0 < CORTE_TURNO ? 1440 : 0) + Math.round((new Date(x.dia + 'T12:00:00') - new Date(dia + 'T12:00:00')) / 864e5) * 1440; });
  const doDia = x => x.dia === dia;

  const saipos = trs.filter(t => t.origem === 'SAIPOS').map(t => ({ ...t, par: null }));
  const rede = trs.filter(t => t.origem === 'REDE').map(t => ({ ...t, usado: false }));
  saipos.forEach(s => {
    let melhor = null, dist = Infinity;
    rede.forEach(r => {
      if (r.usado || Math.abs(+r.valor - +s.valor) > 0.005) return;
      const dt = Math.abs(r.t - s.t);
      if (dt > 180) return;                              // tolerância: 3 h
      // mesmo valor em dois caixas: prefere a maquininha do caixa da venda (SD = salao — dono, 10/09/2026)
      const d = dt + (r.caixa && s.caixa && r.caixa !== s.caixa ? 60 : 0);
      if (d < dist) { dist = d; melhor = r; }
    });
    if (melhor) { melhor.usado = true; melhor.parDe = s; s.par = melhor; s.dist = dist; }
  });
  let semParS = saipos.filter(s => !s.par);
  let semParR = rede.filter(r => !r.usado);
  let casados = saipos.filter(s => s.par);

  // Conta dividida (regra do dono, 28/08/2026): uma transação de um lado
  // composta pela soma de 2–3 do outro, componentes até 45 min entre si.
  // Medido em 01–07/08 AV: o caso real foi a maquininha cheia = soma de
  // partes do PDV (mesa dividida no PDV, um cartão pagou tudo); o inverso
  // não apareceu mas custa o mesmo — os dois sentidos rodam.
  const combina = (alvo, pool) => {
    for (const n of [2, 3]) {
      const combos = [];
      (function gera(ini, atual) {
        if (atual.length === n) { combos.push([...atual]); return; }
        for (let i = ini; i < pool.length; i++) { atual.push(pool[i]); gera(i + 1, atual); atual.pop(); }
      })(0, []);
      for (const itens of combos) {
        const soma = itens.reduce((a, t) => a + +t.valor, 0);
        const ms = itens.map(t => t.t);
        if (Math.abs(soma - +alvo.valor) < 0.005 && Math.max(...ms) - Math.min(...ms) <= 45
            && ms.some(m => Math.abs(m - alvo.t) <= 180)) return itens;
      }
    }
    return null;
  };
  const compostos = [];
  [{alvos: semParS, pool: () => semParR, rotulo: 'PDV cheio = soma na maquininha'},
   {alvos: semParR, pool: () => semParS, rotulo: 'maquininha cheia = soma no PDV'}].forEach(p => {
    [...p.alvos].forEach(alvo => {
      if (alvo._composto) return;
      const itens = combina(alvo, p.pool().filter(t => !t._composto));
      if (itens) {
        itens.forEach(t => t._composto = true);
        alvo._composto = true;
        compostos.push({ alvo, itens, rotulo: p.rotulo });
      }
    });
  });
  semParS = semParS.filter(t => !t._composto);
  semParR = semParR.filter(t => !t._composto);

  // Quase-par: mesmo horário (30 min), valor até R$ 2,00 diferente.
  // 28/08/2026: até R$ 0,10 era "arredondamento" e ia para "absorvido".
  // REVOGADO pelo dono em 14/09/2026: "trazer toda diferença a partir de 0,01 entre
  // venda registrada e valor passado na maquininha; está dando como conciliado valores
  // com diferença de centavos". Agora TODO quase-par vai para "2º conferir" — o array
  // arredond fica vazio de propósito (outras partes da tela ainda o leem).
  const arredond = [], conferir = [];
  [...semParS].forEach(s => {
    let melhor = null, nota = Infinity;
    semParR.filter(r => !r._quase).forEach(r => {
      const dv = Math.abs(+r.valor - +s.valor), dt = Math.abs(r.t - s.t);
      if (dv > 0 && dv <= 2.00 && dt <= 30 && dv * 1000 + dt < nota) { nota = dv * 1000 + dt; melhor = r; }
    });
    if (melhor) {
      melhor._quase = s._quase = true;
      const dv = +melhor.valor - +s.valor;
      conferir.push({ s, r: melhor, dv });   // a partir de R$ 0,01 (dono, 14/09/2026)
    }
  });
  semParS = semParS.filter(t => !t._quase);
  semParR = semParR.filter(t => !t._quase);
  // o total soma as mesmas transações que o par usou (dono, 03/11/2026, via Financeiro): a maquininha casada conta
  // no caixa da venda — o TOTEM do delivery passa em terminal SD, que a base chama de Salão (AV 31/10: R$ 105,97 de "sobra")
  const caixaDoPar = (r, s) => { if (s && s.caixa) r.caixa = s.caixa; };
  rede.forEach(r => caixaDoPar(r, r.parDe));
  compostos.forEach(c => { if (c.alvo.origem === 'REDE') caixaDoPar(c.alvo, c.itens[0]); else c.itens.forEach(it => caixaDoPar(it, c.alvo)); });
  conferir.forEach(q => caixaDoPar(q.r, q.s));
  // troca de bandeira que o robô faz no Saipos: a venda já conta na forma em que passou e sai da diferença
  const roboDe = {};
  ((calc ? calc.robo : (CAIXA_DRILL_DADOS || {}).robo) || []).forEach(x => { roboDe[String(x.id_sale) + '|' + (+x.valor).toFixed(2)] = x; });
  const roboT = x => roboDe[String(x.referencia || x.id_sale) + '|' + (+x.valor).toFixed(2)];
  const formaDe = x => roboT(x) ? formaPadrao(roboT(x).forma_nova) : formaPadrao(x.detalhe);
  // vespera/dia seguinte serviram so de candidatos: daqui em diante, so o dia aberto
  semParS = semParS.filter(doDia); semParR = semParR.filter(doDia); casados = casados.filter(doDia);
  compostos.splice(0, compostos.length, ...compostos.filter(c => c.alvo.dia === dia));
  arredond.splice(0, arredond.length, ...arredond.filter(q => q.s.dia === dia));
  conferir.splice(0, conferir.length, ...conferir.filter(q => q.s.dia === dia));

  // ---- Mergulho do dia, versao transparente (dono, 09/09/2026: "a tela mais
  // transparente e funcional possivel"). UMA lista do que falta conferir, em
  // palavras de operador — hora, o que o Saipos diz, o que a maquininha/banco diz,
  // o que parece e o que fazer. O que o painel resolveu sozinho (conta dividida,
  // centavos) e o que bateu ficam recolhidos. Nada de "NSU"/"sem par" sem explicar.
  const hhmm = h => (h || '').slice(0, 5);
  const limpa = d => String(d || '').replace(' (hora da entrega)', ' · entrega');
  // numero como a equipe ve no Saipos: "8517 (3391)" = venda + pedido no parceiro;
  // o id interno so aparece nos dias que a reimportacao ainda nao cobriu.
  // sem numero e sem mesa (o Saipos nao gravou a referencia da mesa): 'salao' — o id interno nao ajuda ninguem
  const numVenda = x => x.numero ? String(x.numero) + (x.numero_pedido ? ' (' + x.numero_pedido + ')' : '') : x.mesa ? 'mesa ' + x.mesa : (x.caixa === 'SALÃO' || /SAL|BALC/.test(x.canal || '')) ? 'salão' : 'sem nº';
  // venda de outro dia (ex.: pagamento residual lancado dias depois): mostra "de DD/MM"
  const deOutroDia = x => x.data_venda && x.data_venda !== dia ? ' · de ' + String(x.data_venda).slice(8, 10) + '/' + String(x.data_venda).slice(5, 7) : '';
  const rotVenda = x => (x.numero ? 'venda ' : '') + numVenda(x) + deOutroDia(x);
  const moto = {};
  (cobr || []).forEach(c => { if (c.entregador) moto[String(c.id_sale)] = c.entregador; });
  const quem = t => moto[t.referencia] ? ' · motoboy ' + moto[t.referencia] : '';
  const eVale = t => /^vr\b|ticket|alelo|pluxee|sodexo|^vale/i.test(t.detalhe || '');
  const turnos = (CAIXA_TURNOS || []).filter(t => t.unidade === unidade && t.dia === dia).sort((a, b) => +b.total - +a.total);
  const hhmmTs = ts => ts ? String(ts).slice(11, 16) + (String(ts).slice(0, 10) !== dia ? ' (' + String(ts).slice(8, 10) + '/' + String(ts).slice(5, 7) + ')' : '') : '';
  const rotuloCaixa = t => t.caixa === 'SALÃO' ? 'Caixa Salão' : t.caixa === 'DELIVERY' ? 'Caixa Delivery' : t.caixa + (t.canal_dominante ? ' (' + (['SALÃO', 'BALCÃO'].includes(t.canal_dominante) ? 'salão' : 'delivery') + ')' : '');
  // Cada pendencia leva uma CHAVE estavel (memoria de validacao, 09/09/2026), o
  // BLOCO da linha do dia que ela afeta e o EFEITO assinado na diferenca do bloco.
  const pend = [];
  const restoR = [...semParR];
  semParS.forEach(s => {
    const i = restoR.findIndex(r => Math.abs(+r.valor - +s.valor) < 0.005);
    if (i < 0) return;
    const r = restoR.splice(i, 1)[0];
    s._explicado = true;
    pend.push({ forma: formaPadrao(s.detalhe), caixa: s.caixa || null, chave: 'par:' + s.referencia + ':' + r.referencia, bloco: 'maquininha', efeito: 0,
      p: 3, cor: '#9aa4af', hora: hhmm(s.hora), saipos: limpa(s.detalhe) + ' · ' + rotVenda(s) + quem(s), real: limpa(r.detalhe) + ' às ' + hhmm(r.hora), valor: +s.valor,
      leitura: 'mesmo valor dos dois lados, horários mais de 3 h distantes — provavelmente a mesma venda',
      acao: 'nada a fazer se a hora explicar (madrugada, comanda fechada depois)' });
  });
  // "Pendente" / "Pagamento nao cadastrado": o Saipos nao disse a forma (dono, 09/09/2026:
  // eram 22 com mais de 14 dias fora de tudo). Quando a maquininha tem, a base ja
  // reclassifica; o que sobra aqui e venda sem forma E sem transacao.
  const semForma = t => /pendente|n[aã]o cadastrado/i.test(t.detalhe || '');
  // Rede ainda nao entregou a madrugada deste turno? (a linha do dia sabe: rede_completa)
  const redeIncompleta = (CAIXA_CARTAO || []).some(r => r.unidade === unidade && r.dia === dia && r.rede_completa === false);
  const madrugadaSemRede = s => redeIncompleta && min(s.hora) < CORTE_TURNO;
  // Mesma forma, mesmo caixa, poucos minutos de distancia, valores DIFERENTES: e a mesma
  // venda com valor diferente (dono, 10/09/2026 noite: "tratar a diferenca por bandeira na
  // linha da venda"). Vira UMA linha com a diferenca, em vez de duas soltas que nao se explicam.
  const distMin = (a, b) => Math.abs(min(a.hora) - min(b.hora));
  semParS.filter(s => !s._explicado && !semForma(s)).forEach(s => {
    const fs = formaPadrao(s.detalhe);
    const cands = restoR.map((r, i) => ({ r, i })).filter(({ r }) => formaPadrao(r.detalhe) === fs && (!s.caixa || !r.caixa || s.caixa === r.caixa) && distMin(s, r) <= 15)
      .sort((a, b) => distMin(s, a.r) - distMin(s, b.r));
    if (!cands.length) return;
    const r = restoR.splice(cands[0].i, 1)[0];
    s._explicado = true;
    const dv = Math.round((+s.valor - +r.valor) * 100) / 100;
    pend.push({ forma: fs, caixa: s.caixa || r.caixa || null, chave: 'dif:' + s.referencia + ':' + r.referencia, bloco: 'maquininha', efeito: dv, p: 1, cor: '#ff6b6b', hora: hhmm(s.hora),
      saipos: limpa(s.detalhe) + ' ' + reaisCc(s.valor) + ' · ' + rotVenda(s) + quem(s), real: limpa(r.detalhe) + ' ' + reaisCc(r.valor) + ' às ' + hhmm(r.hora), valor: dv,
      leitura: 'mesma forma, mesmo caixa, ' + distMin(s, r) + ' min de distância: provavelmente a mesma venda com valor diferente',
      acao: dv > 0 ? 'faltam ' + reaisCc(dv) + ': o resto foi pago de outro jeito (dinheiro, PIX, outro cartão)? ou o valor registrado está errado?' : 'passou ' + reaisCc(-dv) + ' a mais na máquina: valor digitado errado na maquininha? gorjeta?' });
  });
  semParS.filter(s => !s._explicado).forEach(s => pend.push({ forma: formaPadrao(s.detalhe), caixa: s.caixa || null, chave: 'pdv:' + s.referencia + ':' + (+s.valor).toFixed(2), bloco: semForma(s) ? 'dinheiro' : 'maquininha', efeito: semForma(s) ? 0 : +s.valor,
    p: madrugadaSemRede(s) ? 3 : eVale(s) ? 2 : 1, cor: madrugadaSemRede(s) ? '#9aa4af' : eVale(s) ? '#f5a623' : '#ff6b6b', hora: hhmm(s.hora),
    saipos: limpa(s.detalhe) + ' · ' + rotVenda(s) + quem(s), real: madrugadaSemRede(s) ? 'a Rede ainda não entregou a madrugada' : semForma(s) ? 'nada desse valor na maquininha nem no banco' : 'nada desse valor na maquininha', valor: +s.valor,
    leitura: madrugadaSemRede(s) ? 'pagamento depois da meia-noite: a maquininha só entrega amanhã' : semForma(s) ? 'o Saipos não diz como foi pago (venda ficou "Pendente")' : eVale(s) ? 'vale pode levar até uma semana para aparecer na Rede' : 'registrado no Saipos, mas não passou na maquininha',
    acao: madrugadaSemRede(s) ? 'esperar' : semForma(s) ? 'fechar a venda no Saipos com a forma certa, ou confirmar se foi paga' : moto[s.referencia] ? 'confirmar com o motoboy se cobrou' : 'confirmar no caixa se cobrou, ou se passou em outra forma' }));
  restoR.forEach(r => pend.push({ forma: formaPadrao(r.detalhe), caixa: r.caixa || null, chave: 'rede:' + r.referencia, bloco: 'maquininha', efeito: -(+r.valor),
    p: 2, cor: '#f5a623', hora: hhmm(r.hora), saipos: 'nada desse valor no Saipos', real: limpa(r.detalhe), valor: +r.valor,
    leitura: 'passou na maquininha, mas não está registrado no Saipos', acao: 'achar a venda no Saipos (lançada em outra forma ou não lançada)' }));
  conferir.forEach(q => pend.push({ forma: formaPadrao(q.s.detalhe), caixa: q.s.caixa || null, chave: 'quase:' + q.s.referencia + ':' + q.r.referencia, bloco: 'maquininha', efeito: +q.s.valor - +q.r.valor,
    p: 2, cor: '#f5a623', hora: hhmm(q.s.hora), saipos: limpa(q.s.detalhe) + ' ' + reaisCc(q.s.valor) + ' · ' + rotVenda(q.s) + quem(q.s), real: limpa(q.r.detalhe) + ' ' + reaisCc(q.r.valor) + ' às ' + hhmm(q.r.hora),
    valor: q.dv, leitura: (Math.abs(q.dv) <= 0.10 ? 'diferença de centavos' : 'quase o mesmo valor') + ' no mesmo horário: registrado ' + reaisCc(Math.abs(q.dv)) + (q.dv < 0 ? ' a mais' : ' a menos') + ' que a maquininha',
    acao: Math.abs(q.dv) <= 0.10 ? 'valor digitado na maquininha diferente do registrado: conferir qual está certo e acertar no Saipos' : 'conferir se é a mesma venda (gorjeta? digitação?)' }));
  pix.filter(x => !x.recebido).forEach(x => pend.push({ forma: formaPadrao(x.tipo), caixa: x.caixa || null, chave: 'pix:' + x.id_sale + ':' + (+x.valor).toFixed(2), bloco: x.subgrupo === 'CHAVE' ? 'pix_chave' : 'maquininha', efeito: +x.valor,
    p: x.aguardando ? 3 : 1, cor: x.aguardando ? '#9aa4af' : '#ff6b6b', hora: hhmm(String(x.entrega || '').slice(11)),
    saipos: x.tipo + (x.subgrupo === 'CHAVE' ? ' (chave CNPJ)' : ' (QR da maquininha)') + ' · ' + rotVenda(x) + (x.entregador ? ' · motoboy ' + x.entregador : ''),
    real: x.aguardando ? 'banco ainda não mostrou' : 'nenhum PIX desse valor no banco até 5 dias depois', valor: +x.valor,
    leitura: x.aguardando ? 'sábado cai na segunda, domingo na segunda, feriado empurra mais — até 5 dias é normal' : 'registrado como PIX, o dinheiro não entrou',
    acao: x.aguardando ? 'esperar' : (x.entregador ? 'confirmar com o motoboy se o cliente pagou' : 'confirmar no caixa') }));
  // DINHEIRO = CONTAGEM, por caixa (10/09/2026 noite). Bateu: nada. Sem contagem: "falta
  // contar". Faltou/sobrou: pendencia explicavel. O cofre do Saipos nao entra mais aqui.
  const hojeIso = new Date().toLocaleDateString('en-CA');
  if (dia < hojeIso) caixaDinheiroDia(unidade, dia).forEach(d => {
    if (d.bateu) return;
    if (d.faltaContar) pend.push({ forma: 'Dinheiro', caixa: d.caixa, chave: 'dinheiro:' + dia + ':' + d.caixa, bloco: 'dinheiro', efeito: d.vendido, p: 1, cor: '#f5a623', hora: 'turno',
      saipos: d.rot + ' vendeu em dinheiro ' + reaisCc(d.vendido), real: d.aberto ? 'caixa ainda aberto no Saipos · gaveta não contada' : 'gaveta ainda não contada', valor: d.vendido,
      leitura: 'sem a contagem não dá para saber se o dinheiro chegou',
      acao: 'registrar a contagem aqui embaixo (dinheiro enviado e troco que ficou)' });
    else if (d.contagem) pend.push({ forma: 'Dinheiro', caixa: d.caixa, chave: 'dinheiro:' + dia + ':' + d.caixa, bloco: 'dinheiro', efeito: d.dif, p: 1, cor: d.dif < 0 ? '#ff6b6b' : '#f5a623', hora: 'turno',
      saipos: d.rot + ' vendeu em dinheiro ' + reaisCc(d.vendidoConta), real: 'contado (enviado) ' + reaisCc(d.enviado) + (d.abriu !== null ? ' + ficou ' + reaisCc(d.ficou) + ' − abriu ' + reaisCc(d.abriu) + ' = ' + reaisCc(d.chegou) : '') + (d.saidas > 0 ? ' · saídas do dia ' + reaisCc(d.saidas) : ''), valor: d.dif,
      leitura: (d.dif < 0 ? 'faltou ' : 'sobrou ') + reaisCc(Math.abs(d.dif)) + ' na contagem' + (d.contagem.observacao ? ' — obs: ' + d.contagem.observacao : ''),
      acao: d.dif < 0 ? 'perguntar ao turno: saída paga pela gaveta sem lançar no Saipos? troco digitado errado?' : 'conferir o troco digitado e se alguma venda em dinheiro ficou fora do Saipos' });
  });
  // o casamento do PIX nao e 1 para 1: dois PIX do mesmo valor podem apontar para o
  // MESMO credito do banco. Quando isso acontece, avisa em vez de esconder.
  const usoBanco = {};
  pix.filter(x => x.recebido).forEach(x => { const k = String(x.data_banco) + '|' + String(x.memo_banco) + '|' + (+x.valor).toFixed(2); usoBanco[k] = (usoBanco[k] || 0) + 1; });
  const pixRepetidos = pix.filter(x => x.recebido && usoBanco[String(x.data_banco) + '|' + String(x.memo_banco) + '|' + (+x.valor).toFixed(2)] > 1);
  pixRepetidos.forEach(x => pend.push({ forma: formaPadrao(x.tipo), caixa: x.caixa || null, chave: 'pixdup:' + x.id_sale + ':' + (+x.valor).toFixed(2), bloco: x.subgrupo === 'CHAVE' ? 'pix_chave' : 'maquininha', efeito: 0,
    p: 2, cor: '#f5a623', hora: hhmm(String(x.entrega || '').slice(11)), saipos: x.tipo + ' · ' + rotVenda(x) + (x.entregador ? ' · motoboy ' + x.entregador : ''),
    real: 'crédito de ' + reaisCc(x.valor) + ' em ' + String(x.data_banco || '').split('-').reverse().slice(0, 2).join('/') + ' usado por mais de um PIX',
    valor: +x.valor, leitura: 'mesmo valor repetido: o painel não sabe qual PIX entrou e qual não', acao: 'conferir no extrato se há um crédito para cada' }));
  pend.sort((a, b) => a.p - b.p || (a.hora < b.hora ? -1 : 1));
  pend.forEach((x, i) => { x.i = i; });
  // memoria de validacao: o que ja foi explicado sai da lista e vai para "Explicadas"
  const valDe = {};
  (CAIXA_VALID || []).filter(v => v.unidade === unidade && v.dia === dia).forEach(v => { valDe[v.chave] = v; });
  const noCaixa = x => calc || !CAIXA_DRILL_CX || !x.caixa || x.caixa === CAIXA_DRILL_CX;
  const abertas = pend.filter(x => !valDe[x.chave] && noCaixa(x));
  const explicadas = pend.filter(x => valDe[x.chave] && noCaixa(x)).map(x => ({ ...x, v: valDe[x.chave] }));
  if (!calc) CAIXA_DRILL = { unidade, dia, rows: pend };
  const eu = ((rmbSessao() || {}).email || '').toLowerCase();
  const podeExplicar = (CAIXA_RESP || []).some(r => r.unidade === unidade && String(r.email).toLowerCase() === eu)
    || (typeof souODono === 'function' && souODono());
  const resolvidos = [
    ...compostos.map(c => ({ hora: hhmm(c.alvo.hora), tipo: 'conta dividida', texto: `${c.rotulo}: ${reaisCc(c.alvo.valor)} (${limpa(c.alvo.detalhe)}) = ${c.itens.map(t => reaisCc(t.valor) + ' às ' + hhmm(t.hora)).join(' + ')}` })),
    ...arredond.map(q => ({ hora: hhmm(q.s.hora), tipo: 'centavos', texto: `${limpa(q.s.detalhe)} ${reaisCc(q.s.valor)} × maquininha ${reaisCc(q.r.valor)}` })),
    // forma diferente da registrada: o Saipos diz X, passou Y — a base ja usa o Y
    // (decisao do dono, 09/09/2026: nada se corrige no Saipos). Fica so o registro.
    ...(forma || []).map(f => ({ hora: hhmm(String(f.hora || '').slice(11)), tipo: 'forma diferente (' + String(f.nivel).toLowerCase() + ')', texto: `registrado ${f.registrado}, passou ${f.passou} — ${reaisCc(f.valor)}; o painel já usa o que passou` })),
  ];
  // totais do cabecalho respeitam o filtro de caixa (10/09/2026 noite): linha sem caixa entra nos dois
  const noCxT = t => !CAIXA_DRILL_CX || !t.caixa || t.caixa === CAIXA_DRILL_CX;
  const somaS = saipos.filter(doDia).filter(noCxT).reduce((a, t) => a + +t.valor, 0), somaR = rede.filter(doDia).filter(noCxT).reduce((a, t) => a + +t.valor, 0);
  const pixPdv = pix.filter(noCxT).reduce((a, x) => a + +x.valor, 0), pixNoBanco = pix.filter(noCxT).filter(x => x.recebido).reduce((a, x) => a + +x.valor, 0);
  const bateram = casados.length + compostos.reduce((a, c) => a + c.itens.length + 1, 0) + arredond.length * 2 + pix.filter(x => x.recebido).length;
  const num = (v, cor) => `<b style="color:${cor || '#e8e6dc'};">${reaisCc(v)}</b>`;
  const difMaq = somaS - somaR;
  // o que casou atravessando a meia-noite explica parte da diferenca crua do dia
  const viradaSaipos = casados.filter(x => x.par && !doDia(x.par)).reduce((a, x) => a + +x.valor, 0);
  const viradaRede = rede.filter(r => doDia(r) && r.parDe && !doDia(r.parDe)).reduce((a, r) => a + +r.valor, 0);

  // O que cada CAIXA do Saipos fechou no turno (dono, 09/09/2026): Salao e
  // Delivery, forma a forma — para bater com a tela de fechamento de cada
  // turno. Turno = shift_date; a lista abaixo e por hora da maquina, entao a
  // madrugada pode cair no dia seguinte.
  // 09/09/2026 (dono): o caixa do Saipos (cashier da venda) diz se o turno fechou.
  // Uma caixinha por caixa, com abertura/fechamento; dia sem esse dado cai na
  // aproximacao antiga por canal (SALAO / DELIVERY).
  // Caixas do Saipos como TABELA com linhas verticais (dono, 10/09/2026: "separar cada
  // info por blocos; o bloco dos caixas como tabela").
  const tdC = 'padding:4px 10px; text-align:right; white-space:nowrap; border-right:1px solid rgba(154,164,175,.25);';
  const thC = 'padding:3px 10px; font-weight:normal; color:#a5a49a; font-size:11px; text-transform:uppercase; text-align:right; border-right:1px solid rgba(154,164,175,.25); border-bottom:1px solid rgba(154,164,175,.25);';
  const celC = v => +v > 0 ? reaisCc(v) : '<span style="color:#5a5850;">—</span>';
  const turnoHtml = !turnos.length ? '' : `<div style="font-size:11px; color:#a5a49a; text-transform:uppercase; margin:8px 0 2px;">Caixas do Saipos — turno de ${dia.split('-').reverse().slice(0, 2).join('/')}</div>
    <div style="overflow-x:auto;"><table style="border-collapse:collapse; font-size:12px; border:1px solid rgba(154,164,175,.25);">
      <tr><th style="${thC} text-align:left;">caixa</th><th style="${thC} text-align:left;">estado</th><th style="${thC}">dinheiro</th><th style="${thC}">cartão</th><th style="${thC}">vale</th><th style="${thC}">PIX</th><th style="${thC}">online</th><th style="${thC}">outros</th><th style="${thC} border-right:0;">total</th></tr>
      ${turnos.map(t => {
        const estado = t.fechado === false ? '<b style="color:#ff6b6b;">ABERTO</b> desde ' + hhmmTs(t.aberto_em)
          : t.fechado === true ? '<span style="color:#3f9c5a;">fechado ' + hhmmTs(t.fechado_em) + '</span>' : '<span style="color:#9aa4af;">—</span>';
        return `<tr style="border-top:1px solid rgba(154,164,175,.12);">
          <td style="${tdC} text-align:left;"><b>${rotuloCaixa(t)}</b></td><td style="${tdC} text-align:left;">${estado}</td>
          <td style="${tdC}">${celC(t.dinheiro)}</td><td style="${tdC}">${celC(t.cartao)}</td><td style="${tdC}">${celC(t.voucher)}</td>
          <td style="${tdC}">${celC(t.pix)}</td><td style="${tdC}">${celC(t.online)}</td><td style="${tdC}">${celC(t.outros)}</td>
          <td style="${tdC} border-right:0;"><b>${reaisCc(t.total)}</b></td></tr>`;
      }).join('')}</table></div>`;

  // Blocos por ACAO (dono, 10/09/2026: "a pessoa nao consegue identificar cada coluna;
  // separar melhor o PARA CONFERIR do restante"): duas caixas com moldura — "Para
  // conferir" (pede acao) e "Ja tratado ou aguardando" (explicadas, resolve sozinho,
  // absorvido, bateram) — e TODAS as tabelas com linhas verticais entre as colunas.
  const GRUPOS_PEND = [
    { id: 'saipos', cor: '#ff6b6b', titulo: 'O Saipos registrou, mas a maquininha ou o banco não tem', sub: 'dinheiro que pode não ter entrado, ou vale ainda por aparecer' },
    { id: 'maquina', cor: '#f5a623', titulo: 'A maquininha tem, mas o Saipos não registrou', sub: 'venda sem registro no Saipos, ou lançada em outra forma' },
    { id: 'quase', cor: '#f5a623', titulo: 'Quase bate — conferir', sub: 'valor quase igual no mesmo horário, ou o mesmo crédito do banco servindo a mais de um PIX' },
    { id: 'auto', cor: '#9aa4af', titulo: 'Deve se resolver sozinho', sub: 'madrugada que a maquininha entrega amanhã, PIX de fim de semana, mesmo valor dos dois lados em horários distantes' },
  ];
  const grupoDe = x => x.cor === '#9aa4af' ? 'auto' : x.chave.startsWith('rede:') ? 'maquina' : (x.chave.startsWith('quase:') || x.chave.startsWith('pixdup:')) ? 'quase' : 'saipos';
  // o texto "o Saipos diz" carrega venda/mesa e motoboy; aqui vira coluna
  const partes = p => {
    const pecas = String(p.saipos || '').split(' · ').map(x => x.trim()).filter(Boolean);
    const ehVenda = x => /^(venda|mesa) /.test(x) || x === 'salão' || x === 'sem nº';
    const venda = pecas.find(ehVenda) || '';
    const deDia = pecas.find(x => /^de \d\d\/\d\d$/.test(x)) || '';
    const motoN = (pecas.find(x => /^motoboy /.test(x)) || '').replace(/^motoboy /, '');
    const entrega = pecas.includes('entrega') || !!motoN;
    const forma = pecas.filter(x => !ehVenda(x) && !/^(motoboy|de) /.test(x) && x !== 'entrega').join(' · ');
    return { venda, moto: motoN, forma, entrega, deDia };
  };
  const btnExp = x => podeExplicar ? `<button onclick="caixaExplicar(${x.i})" style="font:inherit; font-size:11px; padding:2px 8px; cursor:pointer;">explicar</button>` : '';
  // celulas com linha vertical a direita (a ultima sem)
  const thL = 'padding:4px 8px; font-weight:normal; color:#a5a49a; font-size:11px; text-transform:uppercase; text-align:left; border-right:1px solid rgba(154,164,175,.25); border-bottom:1px solid rgba(154,164,175,.25); white-space:nowrap;';
  const tdL = 'padding:6px 8px; text-align:left; vertical-align:top; border-right:1px solid rgba(154,164,175,.25);';
  const tabelaCss = 'border-collapse:collapse; font-size:12px; width:100%; text-align:left; border:1px solid rgba(154,164,175,.25);';
  const caixa = (titulo, cor, corpo, destaque, extra) => `<div style="border:1px solid rgba(154,164,175,.25); border-radius:6px; padding:8px 10px; margin-top:12px;">
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px 14px; margin-bottom:6px;">
      <div style="font-size:13px; text-transform:uppercase; font-weight:700; ${destaque ? 'background:#f2efe6; color:#111110; padding:4px 12px; border-radius:4px;' : 'color:' + cor + ';'}">${titulo}</div>${extra || ''}</div>${corpo}</div>`;
  const btnCx = (ativo, cx, rot) => `<button class="navbtn ${ativo ? 'active' : ''}" onclick="caixaDrillFiltro('${cx}')">${rot}</button>`;
  const filtroCx = `<span style="font-size:12px; color:#a5a49a;">caixa:</span>${btnCx(!CAIXA_DRILL_CX, '', 'Todos')}${btnCx(CAIXA_DRILL_CX === 'SALÃO', 'SALÃO', 'Salão')}${btnCx(CAIXA_DRILL_CX === 'DELIVERY', 'DELIVERY', 'Delivery')}`;
  const vendaCel = q => `${q.venda || '—'}${q.deDia ? `<div style="font-size:11px; color:#f5a623;" title="a venda é de outro dia; o pagamento foi lançado neste">venda ${q.deDia}</div>` : ''}${q.moto ? `<div style="font-size:11px;">🛵 ${q.moto}</div>` : (q.entrega ? '<div style="font-size:11px;">entrega</div>' : '')}`;
  const linhaP = (p, g) => { const q = partes(p); return `<tr style="border-top:1px solid rgba(154,164,175,.12);">
    <td style="${tdL} white-space:nowrap; border-left:3px solid ${g.cor};">${p.hora}</td>
    <td style="${tdL} white-space:nowrap; color:#a5a49a;">${vendaCel(q)}</td>
    <td style="${tdL}">${q.forma}</td>
    <td style="${tdL}">${p.real}</td>
    <td style="${tdL} text-align:right; white-space:nowrap; font-weight:600;">${reaisCc(p.valor)}</td>
    <td style="${tdL}">${p.acao}<div style="font-size:11px; color:#8a897e;">${p.leitura}</div></td>
    <td style="${tdL} border-right:0; white-space:nowrap;">${btnExp(p)}</td></tr>`; };
  const secao = (g, n) => `<tr><td colspan="7" style="padding:10px 8px 4px; text-align:left; font-weight:600; color:${g.cor}; background:rgba(154,164,175,.06);">${g.titulo} (${n}) <span style="font-weight:normal; color:#8a897e; font-size:11px;">— ${g.sub}</span></td></tr>`;
  const cabP = `<tr><th style="${thL}">hora</th><th style="${thL}">venda</th><th style="${thL}">o Saipos diz</th><th style="${thL}">a maquininha / o banco diz</th><th style="${thL} text-align:right;">valor</th><th style="${thL}">o que fazer</th><th style="${thL} border-right:0;"></th></tr>`;
  const tabela = lst => `<div style="overflow-x:auto;"><table style="${tabelaCss} min-width:820px;">${cabP}
        ${GRUPOS_PEND.map(g => { const l = lst.filter(x => grupoDe(x) === g.id); return !l.length ? '' : secao(g, l.length) + l.map(x => linhaP(x, g)).join(''); }).join('')}</table></div>`;
  const acionaveis = abertas.filter(x => grupoDe(x) !== 'auto'), autos = abertas.filter(x => grupoDe(x) === 'auto');
  // Carimbo "conferido" por caixa (dono, 10/09/2026): so com o caixa fechado no Saipos e
  // sem pendencia acionavel (explicada conta como resolvida). Quem carimba: responsavel
  // da loja ou dono. A linha do dia mostra "Salao ✔ · Delivery ✔".
  const abertasTodas = pend.filter(x => !valDe[x.chave] && grupoDe(x) !== 'auto');
  const pendCx = cx => abertasTodas.filter(x => !x.caixa || x.caixa === cx).length;
  const caixasDia = (turnos.length ? [...new Set(turnos.map(t => t.caixa === 'SALÃO' || t.caixa === 'DELIVERY' ? t.caixa : (['SALÃO', 'BALCÃO'].includes(t.canal_dominante) ? 'SALÃO' : 'DELIVERY')))] : ['SALÃO', 'DELIVERY']).sort();
  const abertoCx = cx => turnos.some(t => t.fechado === false && ((t.caixa === cx) || (['SALÃO', 'BALCÃO'].includes(t.canal_dominante) ? 'SALÃO' : 'DELIVERY') === cx));
  const confs = (CAIXA_CONF || []).filter(c => c.unidade === unidade && c.dia === dia);
  const hojeStr = new Date().toLocaleDateString('en-CA');
  const carimboCx = cx => { const rot = cx === 'SALÃO' ? 'Salão' : 'Delivery'; const c = confs.find(x => x.caixa === cx); const n = pendCx(cx);
      if (c) return `<span><b style="color:#3f9c5a;">${rot} ✔ conferido</b> <span style="color:#a5a49a;">por ${String(c.quem || '').split('@')[0]} em ${String(c.conferido_em || '').slice(0, 16).replace('T', ' ')}</span>${podeExplicar ? ` <button onclick="caixaDesconferir('${cx}')" style="font:inherit; font-size:11px; padding:1px 7px; cursor:pointer;">desfazer</button>` : ''}</span>`;
      if (dia >= hojeStr) return `<span style="color:#9aa4af;">${rot}: turno em aberto</span>`;
      if (abertoCx(cx)) return `<span style="color:#ff6b6b;">${rot}: caixa ainda aberto no Saipos</span>`;
      if (n > 0) return `<span style="color:#f5a623;">${rot}: ${n} pendência(s) antes de conferir</span>`;
      return podeExplicar ? `<button onclick="caixaConferir('${cx}')" style="font:inherit; font-size:12px; padding:3px 10px; cursor:pointer; font-weight:600;">Marcar ${rot} como conferido</button>` : `<span style="color:#7bc47f;">${rot}: sem pendência (o responsável carimba)</span>`; };
  const linhaE = p => { const q = partes(p); return `<tr style="border-top:1px solid rgba(154,164,175,.12); color:#a5a49a;">
    <td style="${tdL} white-space:nowrap;">${p.hora}</td>
    <td style="${tdL} white-space:nowrap;">${vendaCel(q)}</td>
    <td style="${tdL}">${q.forma}</td>
    <td style="${tdL}">${p.real}</td>
    <td style="${tdL} text-align:right; white-space:nowrap;">${reaisCc(p.valor)}</td>
    <td style="${tdL} color:#e8e6dc;">${p.v.tipo ? '<b>' + caixaRotTipo(p.v.tipo) + '</b>' + (p.v.quebra > 0 ? ' · quebra R$ ' + fmt(+p.v.quebra) + (p.v.responsavel ? ' (' + p.v.responsavel + ')' : '') : '') + ' · ' : ''}${p.v.motivo}</td>
    <td style="${tdL} white-space:nowrap;">${String(p.v.quem || '').split('@')[0]} · ${String(p.v.validado_em || '').slice(0, 10).split('-').reverse().slice(0, 2).join('/')}</td>
    <td style="${tdL} border-right:0; white-space:nowrap;">${podeExplicar ? `<button onclick="caixaDesfazer(${p.i})" style="font:inherit; font-size:11px; padding:2px 8px; cursor:pointer;">desfazer</button>` : ''}</td></tr>`; };
  const cabE = `<tr><th style="${thL}">hora</th><th style="${thL}">venda</th><th style="${thL}">o Saipos diz</th><th style="${thL}">a maquininha / o banco diz</th><th style="${thL} text-align:right;">valor</th><th style="${thL}">motivo</th><th style="${thL}">quem</th><th style="${thL} border-right:0;"></th></tr>`;
  const resumoDet = (n, rotulo) => `<summary style="cursor:pointer; font-size:12px; color:#a5a49a; padding:4px 0;">${rotulo} <b style="color:#e8e6dc;">(${n})</b></summary>`;
  const blocoResto = [
    explicadas.length ? `<details open style="margin-top:4px;">${resumoDet(explicadas.length, 'Explicadas')}
      <div style="overflow-x:auto;"><table style="${tabelaCss} min-width:820px;">${cabE}${explicadas.map(linhaE).join('')}</table></div></details>` : '',
    resolvidos.length ? `<details style="margin-top:4px;">${resumoDet(resolvidos.length, 'Absorvido pelo painel — conta dividida, centavos e forma diferente da registrada')}
      <div style="overflow-x:auto;"><table style="${tabelaCss}"><tr><th style="${thL}">hora</th><th style="${thL}">o que</th><th style="${thL} border-right:0;">detalhe</th></tr>
        ${resolvidos.map(r => `<tr style="border-top:1px solid rgba(154,164,175,.12); color:#a5a49a;"><td style="${tdL} white-space:nowrap;">${r.hora}</td><td style="${tdL} white-space:nowrap;">${r.tipo}</td><td style="${tdL} border-right:0;">${r.texto}</td></tr>`).join('')}</table></div></details>` : '',
    casados.length ? `<details style="margin-top:4px;">${resumoDet(casados.length, 'Pagamentos de cartão/vale que bateram')}
      <div style="overflow-x:auto;"><table style="${tabelaCss}"><tr><th style="${thL}">hora</th><th style="${thL}">venda</th><th style="${thL}">o Saipos diz</th><th style="${thL}">a maquininha diz</th><th style="${thL} border-right:0; text-align:right;">valor</th></tr>
        ${casados.map(s => `<tr style="border-top:1px solid rgba(154,164,175,.12); color:#8a897e;"><td style="${tdL} white-space:nowrap;">${hhmm(s.hora)}</td><td style="${tdL} white-space:nowrap;">${rotVenda(s)}</td><td style="${tdL}">${limpa(s.detalhe)}</td><td style="${tdL}">${limpa(s.par.detalhe)} às ${hhmm(s.par.hora)}</td><td style="${tdL} border-right:0; text-align:right; white-space:nowrap;">${reaisCc(s.valor)}</td></tr>`).join('')}</table></div></details>` : '',
  ].filter(Boolean).join('');
  // Trocas de bandeira vindas do PROPRIO cruzamento (par exato, conta dividida, centavos)
  // — nao dependem da varredura materializada; a varredura entra so no que faltar (PIX etc.)
  const trocas = [];
  const ehPendenteTxt = t => /pendente|n[aã]o cadastrado/i.test(t || '');
  const addTroca = (sRow, rRow, valor, venda) => { const de = formaPadrao(sRow.detalhe), para = formaPadrao(rRow.detalhe); if (de === para || roboT(sRow)) return;
    trocas.push({ hora: hhmm(sRow.hora), venda, valor: +valor, de, para, pd: ehPendenteTxt(sRow.detalhe), caixa: sRow.caixa || rRow.caixa || null, ref: String(sRow.referencia) }); };
  casados.forEach(sRow => { if (sRow.par) addTroca(sRow, sRow.par, sRow.valor, rotVenda(sRow)); });
  arredond.forEach(q => addTroca(q.s, q.r, q.s.valor, rotVenda(q.s)));
  compostos.forEach(c => { if (c.alvo.origem === 'REDE') c.itens.forEach(it => addTroca(it, c.alvo, it.valor, rotVenda(it))); else c.itens.forEach(it => addTroca(c.alvo, it, it.valor, rotVenda(c.alvo))); });
  const trocasRefs = new Set(trocas.map(t => t.ref));
  (forma || []).forEach(f => { if (trocasRefs.has(String(f.id_sale)) || roboT(f)) return; const de = formaPadrao(f.registrado), para = formaPadrao(f.passou);
    trocas.push({ hora: hhmm(String(f.hora || '').slice(11)), venda: f.numero ? 'venda ' + f.numero : f.mesa ? 'mesa ' + f.mesa : 'salão', valor: +f.valor, de, para, pd: ehPendenteTxt(f.registrado), caixa: f.caixa || null, ref: String(f.id_sale) }); });
  if (calc) return { abertas: abertas.filter(x => grupoDe(x) !== 'auto'), trocas, turnos };
  // virada do dia: casou com a maquininha de outro dia (entra na diferenca da forma, com valor)
  const viradas = [];
  casados.forEach(sRow => { if (sRow.par && !doDia(sRow.par)) viradas.push({ forma: formaPadrao(sRow.detalhe), caixa: sRow.caixa || null, contrib: +sRow.valor, texto: `${rotVenda(sRow)} ${reaisCc(sRow.valor)}: a maquininha registrou em ${String(sRow.par.dia).split('-').reverse().slice(0, 2).join('/')} às ${hhmm(sRow.par.hora)} (virada do dia)` }); });
  rede.filter(r => doDia(r) && r.parDe && !doDia(r.parDe)).forEach(r => viradas.push({ forma: formaPadrao(r.detalhe), caixa: r.caixa || null, contrib: -(+r.valor), texto: `${reaisCc(r.valor)} às ${hhmm(r.hora)}: a venda no Saipos é de ${String(r.parDe.dia).split('-').reverse().slice(0, 2).join('/')} (virada do dia)` }));
  // ===== FORMATO DO FECHAMENTO DO SAIPOS (dono, 10/09/2026 noite: "compara com a tela do
  // Saipos, ainda acho que da pra simplificar") — uma tabela por caixa, uma linha por forma:
  // registrado no Saipos | passou de verdade (maquininha / banco / contagem) | diferenca |
  // o que fazer. As acoes ficam embaixo da forma a que pertencem: 1º ajustar no Saipos
  // (varredura de bandeira), 2º conferir (pendencia aberta), aguardando (resolve sozinho).
  const cxDeT = t => (t.caixa === 'SALÃO' || t.caixa === 'DELIVERY') ? t.caixa : (['SALÃO', 'BALCÃO'].includes(t.canal_dominante) ? 'SALÃO' : 'DELIVERY');
  const caixasMostrar = caixasDia.filter(cx => !CAIXA_DRILL_CX || cx === CAIXA_DRILL_CX).sort((a, b) => a === 'SALÃO' ? -1 : b === 'SALÃO' ? 1 : 0);   // Salao primeiro, como no Saipos
  const noCxItem = (x, cx) => !x.caixa || x.caixa === cx;
  const rotVx = x => x.numero ? 'venda ' + x.numero : x.mesa ? 'mesa ' + x.mesa : 'salão';
  const ehPendente = t => /pendente|n[aã]o cadastrado/i.test(t || '');
  const tdF = 'padding:5px 10px; text-align:right; white-space:nowrap; border-right:1px solid rgba(154,164,175,.25); vertical-align:top;';
  const tdS = 'padding:3px 10px 5px 22px; font-size:12px; border-right:1px solid rgba(154,164,175,.25); vertical-align:top;';
  // cabecalho em fundo claro e letra preta (dono, 11/09/2026: "se confunde com o restante")
  const thW = 'padding:5px 10px; font-weight:700; background:#f2efe6; color:#111110; font-size:11px; text-transform:uppercase; text-align:right; border-right:1px solid rgba(0,0,0,.15); white-space:nowrap;';
  // pendencia por venda (para o detalhe venda a venda): forma|referencia -> pendencia
  const pendPorRef = {};
  pend.forEach(x => { const pz = String(x.chave).split(':'); if (pz[0] !== 'rede') pendPorRef[(x.forma || '') + '|' + pz[1]] = x; });
  const contribDe = x => String(x.chave).startsWith('dinheiro:') ? -x.efeito : (String(x.chave).startsWith('par:') || String(x.chave).startsWith('pixdup:')) ? 0 : x.efeito;
  let totAjustar = 0, totConferir = 0, totEsperar = 0;
  const blocoCaixa = cx => {
    const rot = cx === 'SALÃO' ? 'Caixa Salão' : 'Caixa Delivery';
    const t = turnos.find(x => cxDeT(x) === cx);
    const estado = !t ? '' : t.fechado === false ? `<b style="color:#ff6b6b;">ABERTO no Saipos</b> desde ${hhmmTs(t.aberto_em)}` : t.fechado === true ? `<span style="color:#3f9c5a;">fechado ${hhmmTs(t.fechado_em)}</span>` : '';
    const linhas = {};
    const L = f => linhas[f] || (linhas[f] = { forma: f, saipos: 0, real: 0, nS: 0, nR: 0, ordem: 1, ajustar: [], conferir: [], esperar: [], notas: [], explicadas: 0 });
    // DINHEIRO x contagem
    caixaDinheiroDia(unidade, dia).filter(d => d.caixa === cx && (d.vendido >= 0.01 || d.contagem)).forEach(d => {
      const l = L('Dinheiro'); l.ordem = 0; l.saipos = d.vendido; l.nS = 1;
      if (d.contagem) {
        l.saipos = d.vendidoConta; l.real = d.chegou; l.nR = 1; l.bateu = d.bateu;
        if (d.abriu !== null) l.notas.push({ texto: `enviado ${reaisCc(d.enviado)} + ficou na gaveta ${reaisCc(d.ficou)} − abriu com ${reaisCc(d.abriu)} = ${reaisCc(d.chegou)} da venda` +
          (d.diasJuntos.length ? ` · o vendido inclui ${d.diasJuntos.map(x => x.data.slice(8, 10) + '/' + x.data.slice(5, 7) + ' (' + reaisCc(+x.dinheiro_pdv) + ')').join(', ')}, contado junto` : ''), contrib: 0 });
        if (d.porSaidas) l.notas.push({ texto: `bateu descontando ${reaisCc(d.saidas)} de saídas pagas pela gaveta`, contrib: 0 });
      } else if (d.contadoJunto) { l.real = d.vendido; l.nR = 1; l.bateu = true; l.notas.push({ texto: `contado junto com ${d.contadoJunto.slice(8, 10)}/${d.contadoJunto.slice(5, 7)}`, contrib: 0 }); }
      else { l.realTxt = dia >= hojeStr ? 'turno em aberto' : '<span style="color:#f5a623;">não contado</span>'; l.semReal = true; }
    });
    // CARTAO / VALE / PENDENTE: registrado no Saipos x passou na Rede (so o proprio dia)
    saipos.filter(doDia).filter(x => noCxItem(x, cx)).forEach(x => { const l = L(formaDe(x)); l.saipos += +x.valor; l.nS++; if (ehPendente(x.detalhe)) l.ordem = 4; });
    rede.filter(doDia).filter(x => noCxItem(x, cx)).forEach(x => { const l = L(formaPadrao(x.detalhe)); l.real += +x.valor; l.nR++; });
    // PIX x banco
    pix.filter(x => noCxItem(x, cx)).forEach(x => { const l = L(formaPadrao(x.tipo)); l.ordem = 2; l.pix = true; l.saipos += +x.valor; l.nS++; if (x.recebido) { l.real += +x.valor; l.nR++; } });
    // ONLINE: forma x canal do pedido
    (onl || []).filter(x => noCxItem(x, cx)).forEach(x => { const l = L(formaPadrao(x.tipo)); l.ordem = 3; l.online = true; l.saipos += +x.valor; l.nS++;
      if (x.canal_ok === true) { l.real += +x.valor; l.nR++; }
      else l.conferir.push({ contrib: +x.valor, hora: hhmm(String(x.hora || '').slice(11)), venda: x.numero ? 'venda ' + x.numero + (x.numero_pedido ? ' (' + x.numero_pedido + ')' : '') : 'venda', diz: `${x.tipo} · pedido do canal ${x.canal}`, real: '—', valor: +x.valor,
        acao: x.canal_ok === false ? 'canal do pedido não bate com a forma: trocar a forma no Saipos' : 'forma online sem regra cadastrada: conferir' }); });
    // 1º AJUSTAR NO SAIPOS: registrado numa forma, passou em outra (do cruzamento + varredura)
    trocas.filter(x => noCxItem(x, cx)).forEach(x => {
      L(x.de).ajustar.push({ contrib: x.valor, hora: x.hora, venda: x.venda, valor: x.valor, texto: x.pd ? `fechar a venda com a forma <b>${x.para}</b>` : `trocar de ${x.de} para <b>${x.para}</b>`, porque: 'foi assim que passou na maquininha' });
      if (!x.pd) L(x.para).notas.push({ texto: `inclui ${reaisCc(x.valor)} de ${x.venda}, registrada no Saipos como ${x.de} (some quando corrigir lá)`, contrib: -x.valor }); });
    viradas.filter(x => noCxItem(x, cx)).forEach(x => L(x.forma).notas.push({ texto: x.texto, contrib: x.contrib }));
    // 2º CONFERIR / AGUARDANDO: pendencias abertas deste caixa, por forma
    // com que sinal cada pendencia entra na diferenca da forma (registrado − passou)
    abertas.filter(x => noCxItem(x, cx)).forEach(x => { const l = L(x.forma || 'Outros'); x.contrib = contribDe(x); (grupoDe(x) === 'auto' ? l.esperar : l.conferir).push(x); });
    explicadas.filter(x => noCxItem(x, cx)).forEach(x => { L(x.forma || 'Outros').explicadas++; });
    const lista = Object.values(linhas).sort((a, b) => a.ordem - b.ordem || a.forma.localeCompare(b.forma, 'pt'));
    let nA = 0, nC = 0, nE = 0;
    lista.forEach(l => { nA += l.ajustar.length; nC += l.conferir.length; nE += l.esperar.length; });
    if (t && t.fechado === false) nA++;
    totAjustar += nA; totConferir += nC; totEsperar += nE;
    const uid = (cx === 'SALÃO' ? 'S' : 'D') + '_' + dia.replace(/-/g, '');
    const linhaForma = (l, idx) => {
      const dif = l.semReal ? null : Math.round((l.saipos - l.real) * 100) / 100;
      const ok = dif !== null && Math.abs(dif) < 0.01 || l.bateu;
      const temAcao = l.ajustar.length || l.conferir.length || l.esperar.length;
      const corDif = ok ? '#7bc47f' : dif > 0 ? '#ff6b6b' : '#f5a623';
      const difTxt = l.semReal ? '<span style="color:#9aa4af;">—</span>' : ok ? '<span style="color:#7bc47f;">✔</span>' : `<b style="color:${corDif};">${reaisCc(dif)}</b>`;
      const realTxt = l.realTxt ? l.realTxt : l.online ? (ok ? '<span style="color:#7bc47f;">canal certo</span>' : reaisCc(l.real) + ' <span style="color:#9aa4af;">no canal certo</span>') : reaisCc(l.real);
      const resumo = [l.ajustar.length ? `<span style="color:#f5a623;">${l.ajustar.length} ajustar no Saipos</span>` : '', l.conferir.length ? `<span style="color:#ff6b6b;">${l.conferir.length} conferir</span>` : '',
        l.esperar.length ? `<span style="color:#9aa4af;">${l.esperar.length} aguardando</span>` : '', l.explicadas ? `<span style="color:#9aa4af;">${l.explicadas} explicada(s)</span>` : ''].filter(Boolean).join(' · ');
      const leitura = l.forma === 'Dinheiro' ? (ok ? '' : l.semReal ? 'registrar a contagem na linha abaixo' : dif > 0 ? 'faltou na gaveta' : 'sobrou na gaveta')
        : l.online ? '' : (!ok && !temAcao && dif !== null ? (dif > 0 ? 'registrado a mais no Saipos' : 'passou a mais na maquininha') : '');
      const fid = uid + '_' + idx, cls = 'det-' + fid;
      const abertoDet = !!(temAcao || l.notas.length || (dif !== null && !ok));
      const hid = abertoDet ? '' : 'display:none;';
      const tr = bg => `<tr class="${cls}" style="${hid}${bg || ''}">`;
      const sinal = v => Math.abs(v) < 0.005 ? '<span style="color:#6f6e64;">0</span>' : `<span style="color:${v > 0 ? '#ff6b6b' : '#f5a623'};">${v > 0 ? '+' : '−'} ${reaisCc(Math.abs(v))}</span>`;
      const dinheiroLinha = l.forma === 'Dinheiro';
      const ddmm = d => String(d || '').split('-').reverse().slice(0, 2).join('/');
      const sub = [];
      // Registro da contagem DENTRO da tabela (dono, 10/09/2026 noite)
      const formContagem = x => {
        const idF = 'cxdia' + (cx === 'SALÃO' ? 'S' : 'D');
        if (!podeExplicar || dia >= hojeStr) return `${tr('background:rgba(255,107,107,.05);')}<td style="${tdS} white-space:nowrap;"><span style="color:#ff6b6b; font-weight:700;">2º</span> contar a gaveta</td><td style="${tdS}" colspan="4">${x.real} — ${x.acao.replace('aqui embaixo', 'pelo responsável da loja')}</td></tr>`;
        const ultTroco = cx === 'DELIVERY' ? '0.01' : ((CAIXA_CONTAGENS || []).filter(c => c.unidade === unidade && (c.caixa || 'SALÃO') === cx && c.data < dia && c.troco !== null).sort((a, b) => (a.data < b.data ? 1 : -1))[0] || {}).troco;
        return `${tr('background:rgba(255,107,107,.05);')}<td style="${tdS} white-space:nowrap;"><span style="color:#ff6b6b; font-weight:700;">2º</span> registrar a contagem</td>
          <td style="${tdS} border-right:0;" colspan="4"><div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center;">
            <input type="number" step="0.01" min="0" id="${idF}Valor" placeholder="dinheiro enviado (R$)" title="o dinheiro que este caixa mandou para você, contado" style="padding:4px; width:160px; font:inherit;">
            <input type="number" step="0.01" min="0" id="${idF}Troco" value="${ultTroco === undefined || ultTroco === null ? '' : ultTroco}" placeholder="troco que ficou (R$)" title="o troco que ficou na gaveta deste caixa" style="padding:4px; width:150px; font:inherit;">
            <input type="text" id="${idF}Obs" placeholder="observação (se deu diferença, o que achou)" style="padding:4px; flex:1; min-width:180px; font:inherit;">
            <button id="${idF}Btn" onclick="caixaRegistrarNoDia('${unidade.replace(/'/g, "\\'")}', '${dia}', '${cx}', '${idF}')" style="font:inherit; font-size:12px; padding:4px 10px; cursor:pointer; font-weight:600;">Registrar</button>
          </div><div style="font-size:11px; color:#8a897e; margin-top:2px;">enviado = o que você contou; troco = o que ficou na gaveta${cx === 'DELIVERY' ? ' (o delivery abre com R$ 0,01)' : ''}. O painel compara com o vendido em dinheiro deste caixa e trava o dia.</div></td></tr>`;
      };
      const statusPend = px => { const ex = valDe[px.chave];
        if (ex) return { status: `<span style="color:#9aa4af;">explicada${ex.tipo ? ' · <b>' + caixaRotTipo(ex.tipo) + '</b>' : ''}${ex.quebra > 0 ? ' · quebra R$ ' + fmt(+ex.quebra) + (ex.responsavel ? ' (' + ex.responsavel + ')' : '') : ''}: ${ex.motivo}</span>${podeExplicar ? ` <button onclick="caixaDesfazer(${px.i})" style="font:inherit; font-size:11px; padding:1px 7px; cursor:pointer;">desfazer</button>` : ''}`, cor: '#8a897e', bg: '' };
        if (grupoDe(px) === 'auto') return { status: `<span style="color:#9aa4af;">⏳ ${px.acao} <span style="font-size:11px;">— ${px.leitura}</span></span>`, cor: '#8a897e', bg: '' };
        return { status: `<span style="color:#ff6b6b; font-weight:700;">2º</span> ${px.acao}<div style="font-size:11px; color:#8a897e;">${px.leitura}</div>${btnExp(px)}`, cor: '#e8e6dc', bg: 'background:rgba(255,107,107,.05);' }; };
      if (dinheiroLinha) {
        l.conferir.forEach(x => { if (x.chave && x.chave.startsWith('dinheiro:') && l.semReal) { sub.push(formContagem(x)); return; }
          sub.push(`${tr('background:rgba(255,107,107,.05);')}<td style="${tdS} white-space:nowrap;"><span style="color:#ff6b6b; font-weight:700;">2º</span> ${x.hora}</td><td style="${tdS}">${x.saipos}</td><td style="${tdS}">${x.real}</td><td style="${tdS} text-align:right; white-space:nowrap; font-weight:600;">${sinal(x.contrib)}</td><td style="${tdS} border-right:0;">${x.acao}<div style="font-size:11px; color:#8a897e;">${x.leitura}</div> ${btnExp(x)}</td></tr>`); });
        l.notas.forEach(n => sub.push(`${tr()}<td style="${tdS} color:#8a897e; font-size:11px;" colspan="3">↳ ${n.texto}</td><td style="${tdS} text-align:right; white-space:nowrap;">${sinal(n.contrib)}</td><td style="${tdS} border-right:0;"></td></tr>`));
      } else {
        // DETALHE VENDA A VENDA (dono, 11/09/2026: "agrupado por forma; quando clicar, abrir no
        // detalhe por venda, comparando com o que esta no banco") — TODAS as vendas da forma,
        // cada uma com o par na maquininha / banco / canal, o sinal na diferenca e a acao.
        const det = [];
        saipos.filter(doDia).filter(x => noCxItem(x, cx) && formaDe(x) === l.forma).forEach(x => {
          const px = pendPorRef[l.forma + '|' + String(x.referencia)];
          let passou = '—', contrib = 0, status = '<span style="color:#9aa4af;">—</span>', cor = '#8a897e', bg = '';
          if (px) { passou = px.real; contrib = contribDe(px); ({ status, cor, bg } = statusPend(px)); }
          else {
            let r = x.par, extra = '';
            if (!r) { const c = compostos.find(c => c.alvo === x || c.itens.includes(x)); if (c) { if (c.alvo === x) { r = c.itens[0]; extra = ` = ${c.itens.map(t => reaisCc(t.valor) + ' às ' + hhmm(t.hora)).join(' + ')} (conta dividida)`; } else { r = c.alvo; extra = ' (parte de ' + reaisCc(c.alvo.valor) + ', conta dividida)'; } } }
            if (!r) { const q = arredond.find(q => q.s === x); if (q) { r = q.r; extra = ' (centavos)'; } }
            if (r) {
              const fr = formaPadrao(r.detalhe);
              passou = `${limpa(r.detalhe)} ${reaisCc(r.valor)} às ${hhmm(r.hora)}${!doDia(r) ? ` <span style="color:#f5a623;">(${ddmm(r.dia)})</span>` : ''}${extra}`;
              if (fr !== l.forma) { contrib = +x.valor; cor = '#e8e6dc'; bg = 'background:rgba(245,166,35,.05);';
                status = ehPendenteTxt(x.detalhe) ? `<span style="color:#f5a623; font-weight:700;">1º</span> fechar a venda com a forma <b>${fr}</b>` : `<span style="color:#f5a623; font-weight:700;">1º</span> trocar de ${l.forma} para <b>${fr}</b> <span style="color:#8a897e;">— no Saipos: caixa do dia → Ver → ${rotVenda(x)} → mudar a forma → salvar ajustes</span>`; }
              else if (!doDia(r)) { contrib = +x.valor; status = '<span style="color:#9aa4af;">✔ bateu · virada do dia: a maquininha registrou em outro dia</span>'; }
              else status = '<span style="color:#7bc47f;">✔ bateu</span>';
            }
            const rb = roboT(x);
            if (rb) { contrib = 0; cor = '#8a897e'; bg = ''; status = `<span style="color:#9aa4af;">🤖 o robô ${rb.acao === 'FEITO_AGUARDA_CARGA' ? 'trocou' : 'troca'} no Saipos: ${formaPadrao(rb.forma_no_saipos)} → ${formaPadrao(rb.forma_nova)} · não entra na diferença</span>`; }
          }
          det.push({ ord: min(x.hora), hora: hhmm(x.hora), venda: rotVenda(x) + (moto[x.referencia] ? ' · 🛵 ' + moto[x.referencia] : ''), reg: `${limpa(x.detalhe)} ${reaisCc(x.valor)}`, passou, contrib, status, cor, bg });
        });
        pend.filter(px => String(px.chave).startsWith('rede:') && px.forma === l.forma && noCxItem(px, cx)).forEach(px => { const st = statusPend(px);
          det.push({ ord: min(px.hora + ':00'), hora: px.hora, venda: '—', reg: '<span style="color:#9aa4af;">nada no Saipos</span>', passou: px.real, contrib: contribDe(px), status: st.status, cor: st.cor, bg: st.bg }); });
        pix.filter(x => noCxItem(x, cx) && formaPadrao(x.tipo) === l.forma).forEach(x => {
          const px = pendPorRef[l.forma + '|' + String(x.id_sale)];
          const st = px ? statusPend(px) : { status: '<span style="color:#7bc47f;">✔ bateu</span>', cor: '#8a897e', bg: '' };
          det.push({ ord: min(String(x.entrega || '').slice(11)), hora: hhmm(String(x.entrega || '').slice(11)), venda: rotVenda(x) + (x.entregador ? ' · 🛵 ' + x.entregador : ''), reg: `${x.tipo} ${reaisCc(x.valor)}`,
            passou: px ? px.real : `banco: ${reaisCc(x.valor)} em ${ddmm(x.data_banco)}${x.memo_banco ? ' · ' + String(x.memo_banco).slice(0, 40) : ''}`, contrib: px ? contribDe(px) : 0, status: st.status, cor: st.cor, bg: st.bg });
        });
        (onl || []).filter(x => noCxItem(x, cx) && formaPadrao(x.tipo) === l.forma).forEach(x => { const okC = x.canal_ok === true;
          det.push({ ord: min(String(x.hora || '').slice(11)), hora: hhmm(String(x.hora || '').slice(11)), venda: x.numero ? 'venda ' + x.numero + (x.numero_pedido ? ' (' + x.numero_pedido + ')' : '') : 'venda', reg: `${x.tipo} ${reaisCc(x.valor)}`,
            passou: `pedido do canal ${x.canal}`, contrib: okC ? 0 : +x.valor, cor: okC ? '#8a897e' : '#e8e6dc', bg: okC ? '' : 'background:rgba(255,107,107,.05);',
            status: okC ? '<span style="color:#7bc47f;">✔ canal certo</span>' : `<span style="color:#ff6b6b; font-weight:700;">2º</span> ${x.canal_ok === false ? 'canal do pedido não bate com a forma: trocar a forma no Saipos' : 'forma online sem regra cadastrada: conferir'}` }); });
        l.notas.forEach(n => det.push({ ord: 9e9, hora: '', venda: '', reg: `<span style="color:#8a897e;">↳ ${n.texto}</span>`, passou: '', contrib: n.contrib, status: '', cor: '#8a897e', bg: '' }));
        det.sort((a, b) => a.ord - b.ord);
        det.forEach(d => sub.push(`${tr(d.bg)}<td style="${tdS} white-space:nowrap; color:${d.cor};">${d.hora}${d.venda ? ' · ' + d.venda : ''}</td><td style="${tdS} color:${d.cor};">${d.reg}</td><td style="${tdS} color:${d.cor};">${d.passou}</td><td style="${tdS} text-align:right; white-space:nowrap;">${sinal(d.contrib)}</td><td style="${tdS} border-right:0; color:${d.cor};">${d.status}</td></tr>`));
      }
      // a conta fecha na tela: soma das linhas = diferenca da forma (dono, 10/09/2026 noite)
      const contribs = [...l.ajustar, ...l.conferir, ...l.esperar, ...l.notas].map(x => +x.contrib || 0).filter(v => Math.abs(v) >= 0.005);
      const somaC = Math.round(contribs.reduce((a, v) => a + v, 0) * 100) / 100, restoC = Math.round((dif - somaC) * 100) / 100;
      if (!l.semReal && !ok && (contribs.length >= 2 || Math.abs(restoC) >= 0.01)) {
        sub.push(`${tr('background:rgba(154,164,175,.05);')}<td style="${tdS} font-size:11px; color:#a5a49a;" colspan="3">${contribs.length ? `↳ soma das linhas: ${contribs.map(v => (v > 0 ? '+' : '−') + reaisCc(Math.abs(v))).join(' ')}` : '↳ nenhuma linha explica esta diferença'}${Math.abs(restoC) >= 0.01 ? ` · <span style="color:#f5a623;">sobram ${reaisCc(restoC)} sem linha</span> — conta dividida, centavos ou pagamento de outro dia: veja "Já tratado" embaixo` : ''}</td><td style="${tdS} text-align:right; white-space:nowrap;"><b style="color:${corDif};">= ${reaisCc(dif)}</b>${Math.abs(restoC) < 0.01 ? ' <span style="color:#7bc47f;">✔</span>' : ''}</td><td style="${tdS} border-right:0;"></td></tr>`);
      }
      const nDet = sub.length;
      return `<tr style="border-top:1px solid rgba(154,164,175,.18); ${nDet ? 'cursor:pointer;' : ''}" ${nDet ? `onclick="caixaToggleForma('${fid}')" title="clique para ${abertoDet ? 'recolher' : 'ver venda a venda'}"` : ''}>
        <td style="${tdF} text-align:left;"><span id="seta-${fid}" style="display:inline-block; width:12px; color:#9aa4af;">${nDet ? (abertoDet ? '▾' : '▸') : ''}</span><b>${l.forma}</b>${l.nS && l.forma !== 'Dinheiro' ? ` <span style="color:#6f6e64; font-size:11px;" title="pagamentos registrados no Saipos nesta forma">${l.nS}×</span>` : ''}</td>
        <td style="${tdF}">${l.saipos >= 0.005 || l.nS ? reaisCc(l.saipos) : '<span style="color:#5a5850;">—</span>'}</td>
        <td style="${tdF}">${realTxt}</td>
        <td style="${tdF}">${difTxt}</td>
        <td style="${tdF} text-align:left; border-right:0; white-space:normal;">${resumo || (ok ? '' : leitura ? `<span style="color:${corDif};">${leitura}</span>` : '')}${resumo && leitura ? ` <span style="color:#8a897e;">· ${leitura}</span>` : ''}</td></tr>${sub.join('')}`;
    };
    const somaS = lista.reduce((a, l) => a + l.saipos, 0), somaR = lista.reduce((a, l) => a + (l.semReal ? 0 : l.real), 0);
    const roboCx = ((CAIXA_DRILL_DADOS || {}).robo || []).filter(x => saipos.some(s => doDia(s) && noCxItem(s, cx) && roboT(s) === x));
    const roboHtml = !roboCx.length ? '' : `<div style="margin-top:4px; font-size:12px; color:#9aa4af;">🤖 o robô troca no Saipos (não entra na diferença): ${roboCx.map(x => `${x.numero ? 'nº ' + x.numero : x.mesa ? 'mesa ' + x.mesa : 'salão'} ${reaisCc(x.valor)} ${formaPadrao(x.forma_no_saipos)} → ${formaPadrao(x.forma_nova)}${x.acao === 'FEITO_AGUARDA_CARGA' ? ' (feito)' : ''}`).join(' · ')}</div>`;
    const descsCx = (descs || []).filter(x => !x.caixa || x.caixa === cx);
    const semMotivo = descsCx.filter(x => !x.motivo && !x.cupom).length;
    const descHtml = !descsCx.length ? '' : `<details style="margin-top:4px; font-size:12px;"><summary style="cursor:pointer; color:#a5a49a;">Descontos manuais: ${descsCx.length}, ${reaisCc(descsCx.reduce((a, x) => a + +x.desconto, 0))}${semMotivo ? ` · <span style="color:#f5a623;">${semMotivo} sem motivo</span>` : ''} <span style="color:#6f6e64;">(informação; não entra na conferência)</span></summary>
      <div style="overflow-x:auto;"><table style="border-collapse:collapse; font-size:12px; border:1px solid rgba(154,164,175,.25); margin-top:4px;">
        <tr><th style="${thC} text-align:left;">hora</th><th style="${thC} text-align:left;">venda</th><th style="${thC}">conta</th><th style="${thC}">desconto</th><th style="${thC}">%</th><th style="${thC} text-align:left; border-right:0;">motivo no Saipos</th></tr>
        ${descsCx.map(x => `<tr style="border-top:1px solid rgba(154,164,175,.12);"><td style="${tdC} text-align:left;">${String(x.hora || '').slice(11, 16)}</td><td style="${tdC} text-align:left;">${x.numero ? 'venda ' + x.numero : x.mesa ? 'mesa ' + x.mesa : 'salão'}</td><td style="${tdC}">${reaisCc(+x.total + +x.desconto)}</td><td style="${tdC}"><b>${reaisCc(x.desconto)}</b></td><td style="${tdC}">${x.pct === null ? '—' : String(x.pct).replace('.', ',') + '%'}</td><td style="${tdC} text-align:left; border-right:0; ${x.motivo || x.cupom ? '' : 'color:#f5a623;'}">${x.motivo || (x.cupom ? 'cupom ' + x.cupom : 'sem motivo — perguntar ao turno quem liberou')}</td></tr>`).join('')}</table></div></details>`;
    const abertoLinha = t && t.fechado === false ? `<tr style="background:rgba(245,166,35,.05);"><td style="${tdS}" colspan="5"><span style="color:#f5a623; font-weight:700;">1º</span> <b>fechar este caixa no Saipos</b> — aberto desde ${hhmmTs(t.aberto_em)}; enquanto estiver aberto, vendas novas ainda entram aqui</td></tr>` : '';
    return `<div style="border:1px solid rgba(154,164,175,.25); border-radius:6px; padding:8px 10px; margin-top:12px;">
      <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px 16px; margin-bottom:6px; font-size:12px;">
        <div style="font-size:13px; text-transform:uppercase; font-weight:700; background:#f2efe6; color:#111110; padding:4px 12px; border-radius:4px;">${rot}</div>
        ${estado ? `<span>${estado}</span>` : ''}
        ${cx === 'DELIVERY' && !Object.keys(moto).length && saipos.some(x => doDia(x) && x.caixa === 'DELIVERY')
          ? '<span style="color:#9aa4af;" title="o motoboy vem do sistema de entrega — Foody no Boqueirão, TrackEat na Água Verde, Ahú e São Braz (lido toda manhã, então o dia de hoje ainda não aparece)">🛵 motoboy ainda não registrado para este caixa</span>' : ''}
        <span>${nA ? `<b style="color:#f5a623;">1º ajustar no Saipos: ${nA}</b>` : '<span style="color:#7bc47f;">1º nada a ajustar no Saipos</span>'} · ${nC ? `<b style="color:#ff6b6b;">2º conferir: ${nC}</b>` : '<span style="color:#7bc47f;">2º nada a conferir</span>'}${nE ? ` · <span style="color:#9aa4af;">aguardando: ${nE}</span>` : ''}</span>
        <span style="margin-left:auto;">${carimboCx(cx)}</span>
      </div>
      <div style="overflow-x:auto;"><table style="border-collapse:collapse; font-size:12px; width:100%; border:1px solid rgba(154,164,175,.25);">
        <tr><th style="${thW} text-align:left;">forma <span style="font-weight:normal; text-transform:none;">(clique para ver venda a venda)</span></th><th style="${thW}">registrado no Saipos</th><th style="${thW}" title="maquininha (Rede), banco (PIX), contagem (dinheiro), canal do pedido (online)">passou de verdade</th><th style="${thW}">diferença</th><th style="${thW} text-align:left; border-right:0;">o que fazer</th></tr>
        ${abertoLinha}
        ${lista.map((l, i) => linhaForma(l, i)).join('')}
        <tr style="border-top:2px solid rgba(154,164,175,.35);"><td style="${tdF} text-align:left;"><b>Total</b></td><td style="${tdF}"><b>${reaisCc(somaS)}</b></td><td style="${tdF}"><b>${reaisCc(somaR)}</b></td><td style="${tdF}"><b style="color:${Math.abs(somaS - somaR) < 0.01 ? '#7bc47f' : '#f5a623'};">${reaisCc(somaS - somaR)}</b></td><td style="${tdF} border-right:0;"></td></tr>
      </table></div>
      ${roboHtml}
      ${descHtml}
    </div>`;
  };
  const blocosCaixa = caixasMostrar.map(blocoCaixa).join('');
  cont.innerHTML = `<div class="card" style="margin:14px 0; text-align:left;">
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px 16px; margin-bottom:4px;">
      <div style="font-size:15px; font-weight:700;">${unidade} — ${dia.split('-').reverse().join('/')}</div>
      ${filtroCx}
      ${podeExplicar ? `<button onclick="caixaAtualizarDia(this)" title="relê este dia no Saipos (1 a 2 min) e refaz a conferência — use depois de corrigir lá" style="font:inherit; font-size:12px; padding:3px 10px; cursor:pointer; margin-left:auto;">↻ Já corrigi no Saipos — atualizar este dia</button>` : ''}
    </div>
    <div style="font-size:12px; color:#a5a49a;">Mesma leitura do fechamento do Saipos, preenchida sozinha: <b style="color:#e8e6dc;">registrado</b> é o que o turno lançou; <b style="color:#e8e6dc;">passou de verdade</b> é a maquininha, o banco e a contagem. Primeiro o <span style="color:#f5a623;">1º</span> (corrigir no Saipos e clicar atualizar), depois o <span style="color:#ff6b6b;">2º</span>. ${bateram} pagamento(s) bateram sozinhos${viradaSaipos || viradaRede ? ` · na virada do dia: ${viradaSaipos ? reaisCc(viradaSaipos) + ' do Saipos veio da véspera' : ''}${viradaSaipos && viradaRede ? ', ' : ''}${viradaRede ? reaisCc(viradaRede) + ' da maquininha caiu na madrugada seguinte' : ''}` : ''}.</div>
    ${blocosCaixa || '<div style="margin-top:10px; color:#9aa4af;">Nenhum caixa neste dia.</div>'}
    ${blocoResto ? caixa('Já tratado', '#9aa4af', blocoResto) : ''}
  </div>`;
  cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Memoria de validacao (dono, 09/09/2026). "explicar" grava motivo + quem na
// caixa_pendencia_validada (policy: responsavel da loja ou dono); a linha sai
// do "para conferir" e o dia vira "fechou · N explicadas". "desfazer" apaga.
let CAIXA_DRILL = null;
const CAIXA_VALID_DESDE = () => new Date(Date.now() - 60 * 864e5).toLocaleDateString('en-CA');
async function caixaRecarregarValidadas() {
  CAIXA_VALID = await consultarTudo('caixa_pendencia_validada?select=*&dia=gte.' + CAIXA_VALID_DESDE());
  renderModuloCaixa();
  if (CAIXA_DRILL) await abrirDiaConcartao(CAIXA_DRILL.unidade, CAIXA_DRILL.dia);
}
// Tipos de explicacao (dono, 11/09/2026): "vao existir vendas nao cobradas e vendas com
// diferenca; qual a melhor forma de acertarmos e tratarmos essas quebras?" Regras dele:
// delivery nao cobrado = desconto do motoboy (o atendente confere o comprovante na
// maquininha); quebra do salao acumula e e descontada, todo mes, do rateio dos 10%.
const CAIXA_TIPOS_EXPL = [
  { id: 'REGISTRO', rot: 'Erro de registro', desc: 'o dinheiro entrou certo; o Saipos é que está errado (bandeira, valor digitado) — corrigido lá, sem perda', quebra: false },
  { id: 'PERDA_SALAO', rot: 'Quebra do salão', desc: 'não cobrado ou cobrado a menor no salão/balcão — acumula e é descontado do rateio dos 10% no mês', quebra: true },
  { id: 'PERDA_MOTOBOY', rot: 'Não cobrado na entrega', desc: 'sem comprovante na maquininha — desconto do motoboy', quebra: true },
  { id: 'REPOSICAO', rot: 'Reposição', desc: 'este dinheiro repõe uma quebra anterior (escolha qual) — explica a sobra de hoje', quebra: false },
  { id: 'FIADO', rot: 'Cliente paga depois', desc: 'a venda existe, o pagamento vem depois — conferir quando entrar', quebra: false },
  { id: 'SOBRA', rot: 'Sobra', desc: 'troco digitado errado, venda em dinheiro fora do Saipos, gorjeta', quebra: false },
  { id: 'OUTRO', rot: 'Outro', desc: 'nenhum dos anteriores — descreva no motivo', quebra: false },
];
const caixaRotTipo = t => (CAIXA_TIPOS_EXPL.find(x => x.id === t) || {}).rot || '';
// quebras ainda sem reposicao, da loja (para o campo "repõe qual?")
function caixaQuebrasAbertas(unidade) {
  const vals = (CAIXA_VALID || []).filter(v => v.unidade === unidade);
  const repostas = new Set(vals.filter(v => v.tipo === 'REPOSICAO' && v.reposicao_de).map(v => v.reposicao_de));
  return vals.filter(v => (v.tipo === 'PERDA_SALAO' || v.tipo === 'PERDA_MOTOBOY') && +v.quebra > 0 && !repostas.has(v.chave))
    .sort((a, b) => (a.dia < b.dia ? 1 : -1));
}
function caixaModalExplicar(x, d) {
  return new Promise(resolve => {
    const moto = (String(x.saipos || '').match(/motoboy ([^·]+)/) || [])[1];
    const contrib = String(x.chave).startsWith('dinheiro:') ? -x.efeito : x.efeito;
    const tipo0 = moto ? 'PERDA_MOTOBOY' : String(x.chave).startsWith('rede:') ? 'REGISTRO' : contrib < 0 ? 'SOBRA' : 'PERDA_SALAO';
    const resp0 = moto ? moto.trim() : (x.caixa === 'DELIVERY' ? 'Delivery' : 'Salão') + ' · turno';
    const abertas = caixaQuebrasAbertas(d.unidade);
    const ddmm = v => String(v || '').split('-').reverse().slice(0, 2).join('/');
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';
    ov.innerHTML = `<div style="background:#1a1a19; color:#e8e6dc; border:1px solid rgba(154,164,175,.35); border-radius:8px; max-width:640px; width:100%; padding:16px 18px; font-size:13px; max-height:92vh; overflow:auto;">
      <div style="font-size:14px; font-weight:700; margin-bottom:4px;">Explicar a diferença</div>
      <div style="color:#a5a49a; font-size:12px; margin-bottom:10px;">${x.hora} · ${String(x.saipos || '').replace(/<[^>]+>/g, '')} × ${x.real} — <b style="color:#e8e6dc;">R$ ${fmt(Math.abs(x.valor))}</b></div>
      <div style="display:grid; gap:4px; margin-bottom:10px;">
        ${CAIXA_TIPOS_EXPL.map(t => `<label style="display:flex; gap:8px; align-items:flex-start; padding:5px 8px; border:1px solid rgba(154,164,175,.2); border-radius:5px; cursor:pointer;"><input type="radio" name="cxTipo" value="${t.id}" ${t.id === tipo0 ? 'checked' : ''} style="margin-top:3px;"><span><b>${t.rot}</b><br><span style="color:#a5a49a; font-size:11px;">${t.desc}</span></span></label>`).join('')}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
        <label style="flex:1; min-width:140px;">valor da diferença (R$)<br><input type="number" step="0.01" min="0" id="cxValor" value="${Math.abs(x.valor).toFixed(2)}" style="width:100%; padding:4px; font:inherit;"></label>
        <label style="flex:2; min-width:200px;">responsável (motoboy ou turno)<br><input type="text" id="cxResp" value="${resp0.replace(/"/g, '&quot;')}" style="width:100%; padding:4px; font:inherit;"></label>
      </div>
      <div id="cxRepBox" style="display:none; margin-bottom:8px;"><label>repõe qual quebra?<br><select id="cxRep" style="width:100%; padding:4px; font:inherit;">${abertas.length ? abertas.map(v => `<option value="${v.chave}">${ddmm(v.dia)} · R$ ${fmt(+v.quebra)} · ${v.responsavel || ''} · ${String(v.motivo || '').slice(0, 50)}</option>`).join('') : '<option value="">nenhuma quebra em aberto nesta loja</option>'}</select></label></div>
      <label>motivo (fica registrado)<br><textarea id="cxMotivo" rows="2" style="width:100%; padding:4px; font:inherit;"></textarea></label>
      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
        <button id="cxCancelar" style="font:inherit; padding:5px 12px; cursor:pointer;">cancelar</button>
        <button id="cxSalvar" style="font:inherit; padding:5px 14px; cursor:pointer; font-weight:700;">Salvar</button>
      </div></div>`;
    document.body.appendChild(ov);
    const repBox = ov.querySelector('#cxRepBox');
    const syncRep = () => { const t = ov.querySelector('input[name=cxTipo]:checked').value; repBox.style.display = t === 'REPOSICAO' ? 'block' : 'none'; };
    ov.querySelectorAll('input[name=cxTipo]').forEach(r => r.addEventListener('change', syncRep)); syncRep();
    const fechar = v => { ov.remove(); resolve(v); };
    ov.querySelector('#cxCancelar').onclick = () => fechar(null);
    ov.addEventListener('click', e => { if (e.target === ov) fechar(null); });
    ov.querySelector('#cxSalvar').onclick = () => {
      const tipo = ov.querySelector('input[name=cxTipo]:checked').value;
      const valor = Number(ov.querySelector('#cxValor').value);
      const motivo = ov.querySelector('#cxMotivo').value.trim();
      const responsavel = ov.querySelector('#cxResp').value.trim();
      const rep = tipo === 'REPOSICAO' ? ov.querySelector('#cxRep').value : null;
      if (!motivo) { avisoAcao('atencao', '! Escreva o motivo — é o que fica registrado.'); return; }
      if (!(valor >= 0)) { avisoAcao('atencao', '! Valor inválido.'); return; }
      if (tipo === 'REPOSICAO' && !rep) { avisoAcao('atencao', '! Escolha qual quebra este dinheiro repõe.'); return; }
      const def = CAIXA_TIPOS_EXPL.find(t => t.id === tipo);
      fechar({ tipo, motivo, responsavel: responsavel || null, quebra: def.quebra ? Math.round(valor * 100) / 100 : null, reposicao_de: rep });
    };
    setTimeout(() => { const m = ov.querySelector('#cxMotivo'); if (m) m.focus(); }, 50);
  });
}
async function caixaExplicar(i) {
  const d = CAIXA_DRILL, x = d && d.rows[i];
  if (!x) return;
  await caixaExplicarItem(d, x);
}
// o miolo do explicar serve ao detalhe do dia e à lista "Para você resolver" (03/11/2026)
async function caixaExplicarItem(d, x) {
  const s = rmbSessao();
  if (!s || !s.email) { avisoAcao('atencao', '! Sessão expirada — faça login de novo para registrar.'); return; }
  const r0 = await caixaModalExplicar(x, d);
  if (!r0) return;
  avisoAcao('enviando', 'Gravando a explicação…');
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/caixa_pendencia_validada?on_conflict=unidade,dia,chave`, {
      method: 'POST', headers: rmbHeaders({ Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify({ unidade: d.unidade, dia: d.dia, chave: x.chave, bloco: x.bloco, caixa: x.caixa || null,
        descricao: (x.hora + ' · ' + x.saipos.replace(/<[^>]+>/g, '') + ' × ' + x.real).slice(0, 240),
        valor: Math.round(x.valor * 100) / 100, efeito: Math.round(x.efeito * 100) / 100,
        tipo: r0.tipo, responsavel: r0.responsavel, quebra: r0.quebra, reposicao_de: r0.reposicao_de,
        motivo: r0.motivo, quem: s.email, validado_em: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    avisoAcao('ok', `✓ Explicação gravada — às ${avisoHora()}.`);
    await caixaRecarregarValidadas();
  } catch (e) { avisoAcao('erro', '✗ Não consegui gravar a explicação: ' + e.message + '. Tente de novo.'); }
}
// Botao "Ja corrigi no Saipos — atualizar este dia" (dono, 10/09/2026 noite): o painel
// so le o banco; o pedido vai para caixa_atualizacao_pedido e o atendente
// (script/atender_caixa.py, tarefa "Painel - Atender caixa") rele o dia no Saipos e
// recalcula as mvs da conciliacao. Mesmo desenho do botao da Hellen na conciliacao.
async function caixaAtualizarDia(bt) {
  const d = CAIXA_DRILL_DADOS;
  if (!d) return;
  const s = rmbSessao();
  if (!s || !s.email) { avisoAcao('atencao', '! Sessão expirada — faça login de novo.'); return; }
  const texto = bt.textContent;
  bt.disabled = true; bt.textContent = 'pedindo...';
  avisoAcao('enviando', 'Pedindo para reler o dia no Saipos (leva 1 a 2 min)…');
  try {
    await rmbGarantirTokenValido();
    const pede = () => fetch(`${SUPABASE_URL}/rest/v1/caixa_atualizacao_pedido`, {
      method: 'POST', headers: rmbHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({ unidade: d.unidade, dia: d.dia, quem: s.email }),
    });
    let r = await pede();
    if (r.status === 401) { await rmbRenovarSeExpirado(r); r = await pede(); }
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    const pedido = (await r.json())[0];
    const t0 = Date.now(), limite = t0 + 300000;
    let estado = 'PENDENTE', resumo = '';
    while (Date.now() < limite && (estado === 'PENDENTE' || estado === 'RODANDO')) {
      await new Promise(x => setTimeout(x, 3000));
      const q = await fetch(`${SUPABASE_URL}/rest/v1/caixa_atualizacao_pedido?id=eq.${pedido.id}&select=status,resumo`, { headers: rmbHeaders() });
      if (!q.ok) break;
      const l = (await q.json())[0];
      if (l) { estado = l.status; resumo = l.resumo || ''; }
      const seg = Math.round((Date.now() - t0) / 1000);
      bt.textContent = estado === 'RODANDO' ? `relendo o Saipos... ${seg}s (leva 1 a 2 min)` : `na fila... ${seg}s`;
      if (estado === 'PENDENTE' && seg >= 90) estado = 'NINGUEM';
    }
    if (estado === 'OK') {
      avisoAcao('ok', `✓ Dia ${d.dia.split('-').reverse().join('/')} relido do Saipos — às ${avisoHora()}.`);
      bt.textContent = 'refazendo a conferência...';
      CAIXA_DIAS = null;              // recarrega tudo do banco
      await entrarCaixa();
      await abrirDiaConcartao(d.unidade, d.dia);
      return;
    }
    if (estado === 'ERRO') avisoAcao('erro', '✗ A atualização falhou: ' + resumo + '. Tente de novo.');
    else avisoAcao('erro', '✗ ' + 'O pedido entrou na fila mas ninguém atendeu em 90 segundos. O computador que relê o Saipos pode estar desligado — a importação das 08h de amanhã pega isso de qualquer jeito.');
  } catch (e) { avisoAcao('erro', '✗ Não consegui pedir a atualização: ' + e.message + '. Tente de novo.'); }
  bt.textContent = texto; bt.disabled = false;
}
async function caixaRecarregarConf() {
  CAIXA_CONF = await consultarTudo('caixa_conferencia?select=*&dia=gte.' + CAIXA_VALID_DESDE());
  renderModuloCaixa();
  const d = CAIXA_DRILL_DADOS;
  if (d) renderDiaConcartao(d.unidade, d.dia, d.trs, d.pix, d.cobr, d.forma, d.descs, d.onl);
}
async function caixaConferir(cx) {
  const d = CAIXA_DRILL_DADOS;
  if (!d) return;
  const s = rmbSessao();
  if (!s || !s.email) { avisoAcao('atencao', '! Sessão expirada — faça login de novo para registrar.'); return; }
  avisoAcao('enviando', `Marcando ${cx} como conferido…`);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/caixa_conferencia?on_conflict=unidade,dia,caixa`, {
      method: 'POST', headers: rmbHeaders({ Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify({ unidade: d.unidade, dia: d.dia, caixa: cx, quem: s.email, conferido_em: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    avisoAcao('ok', `✓ ${cx} de ${d.dia.split('-').reverse().join('/')} marcado como conferido — às ${avisoHora()}.`);
    await caixaRecarregarConf();
  } catch (e) { avisoAcao('erro', '✗ Não consegui registrar a conferência: ' + e.message + '. Tente de novo.'); }
}
async function caixaDesconferir(cx) {
  const d = CAIXA_DRILL_DADOS;
  if (!d || !confirm('Desfazer a conferência deste caixa?')) return;
  avisoAcao('enviando', 'Desfazendo a conferência…');
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/caixa_conferencia?unidade=eq.${encodeURIComponent(d.unidade)}&dia=eq.${d.dia}&caixa=eq.${encodeURIComponent(cx)}`,
      { method: 'DELETE', headers: rmbHeaders({ Prefer: 'return=representation' }) });
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    avisoAcao('ok', `✓ Conferência de ${cx} desfeita — às ${avisoHora()}.`);
    if (!(await r.json()).length) throw new Error('o banco não desfez nada (talvez você não tenha permissão para desfazer o que outra pessoa gravou)');
    await caixaRecarregarConf();
  } catch (e) { avisoAcao('erro', '✗ Não consegui desfazer: ' + e.message + '. Tente de novo.'); }
}
async function caixaDesfazer(i) {
  const d = CAIXA_DRILL, x = d && d.rows[i];
  if (!x || !confirm('Reabrir esta pendência? A explicação gravada será apagada.')) return;
  avisoAcao('enviando', 'Reabrindo a pendência…');
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/caixa_pendencia_validada?unidade=eq.${encodeURIComponent(d.unidade)}&dia=eq.${d.dia}&chave=eq.${encodeURIComponent(x.chave)}`,
      { method: 'DELETE', headers: rmbHeaders({ Prefer: 'return=representation' }) });
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    avisoAcao('ok', `✓ Pendência reaberta; a explicação foi apagada — às ${avisoHora()}.`);
    if (!(await r.json()).length) throw new Error('o banco não desfez nada (talvez você não tenha permissão para desfazer o que outra pessoa gravou)');
    await caixaRecarregarValidadas();
  } catch (e) { avisoAcao('erro', '✗ Não consegui desfazer: ' + e.message + '. Tente de novo.'); }
}


// ------------------------------------------------------------------
// Modulo Fechamento de caixa (28/08/2026) — o cofre e' um caixa operacional
// paralelo: dinheiro de venda entra ali e paga despesa direto, sem passar
// pelo banco. Diagnostico de julho (medido): 17 dias sem lancamento de frente
// de caixa, R$ 3.810 sem registro, e ninguem percebeu por semanas — um dia
// esquecido era indistinguivel de um dia sem venda em dinheiro. Este modulo
// e' o passo 1 do plano (so leitura): compara o dinheiro VENDIDO no PDV
// (vendas_saipos.dinheiro, capturado do payments[] da API desde 28/08) com o
// que foi LANCADO no cofre (fin_lancamentos, RECEITAS DINHEIRO), dia a dia.
// Passos 2 e 3 (digitar o valor contado e lancar a diferenca via robo do mini
// PC) vem depois. Serie comeca em 01/08/2026 (antes nao ha coluna dinheiro).
// ------------------------------------------------------------------
let CAIXA_DIAS = null, CAIXA_CONTAGENS = null, CAIXA_RESP = null;
let CAIXA_CARTAO = null, CAIXA_PIX = null, CAIXA_TURNOS = null, CAIXA_VALID = null, CAIXA_DIAS_CX = null, CAIXA_CONF = null, CAIXA_CARTAO_CX = null, CAIXA_PIX_CX = null, CAIXA_AVISOS = null;

// FECHAMENTO DE CAIXAS (09/09/2026) — modulo unico, decisao do dono: absorveu
// "Cartao & maquininha" (taxas/aluguel, secao no fim da tela) e "Conciliacao de
// cartao" (colunas de cartao/vale/PIX na linha do dia, mergulho do dia e
// cobrancas sem par por motoboy). O Saipos deixa de ser ferramenta de
// conciliacao: cada turno so fecha o caixa la (sem digitar bandeira); a
// conferencia inteira — dinheiro x gaveta, cartao/vale x Rede, PIX x banco —
// e feita aqui, pela Arissa (AV e Ahu) e pelo Diego (SB), sobre o dia anterior.
// 28/10/2026 (seletor de loja único): as lojas vêm de nucleo/loja.js — a do topo da casca, ou as do login fora dela.
// Rede = as três lado a lado. Sem o loja.js ou sem resposta do banco: as lojas que aparecem nos dados (a segurança é das views).
let CAIXA_OUVE_LOJA = false;
function caixaLojaVisao() { return typeof lojaAtual === 'function' && typeof LOJA_INFO !== 'undefined' && LOJA_INFO ? lojaAtual() : undefined; }
function caixaLojas() {
  const v = caixaLojaVisao();
  const nome = (u) => (typeof lojaNome === 'function' ? lojaNome(u) : u);
  if (v === null) return [];                                                     // login sem loja cadastrada
  if (v && v !== LOJA_REDE) return [[v, nome(v)]];
  const todas = v ? LOJA_INFO.lojas.filter((u) => u !== LOJA_REDE)
    : [...new Set((CAIXA_DIAS || []).map((r) => r.unidade))].sort();
  return todas.map((u) => [u, nome(u)]);
}
function caixaTrocarLoja(u) { if (typeof lojaEscolher === 'function' && lojaEscolher(u)) renderModuloCaixa(); }
async function entrarCaixa() {
  const alvo = document.getElementById('view-caixa');
  if (typeof lojaCarregar === 'function') {
    await lojaCarregar();
    if (!CAIXA_OUVE_LOJA) { CAIXA_OUVE_LOJA = true; aoMudarLoja(() => { if (CAIXA_DIAS) renderModuloCaixa(); }); }
  }
  await cofreCarregar();   // 22/10/2026: o cofre de cada loja, no topo
  const listaHellen = CAIXA_HELLEN === null;
  if (CAIXA_DIAS === null) {
    alvo.innerHTML = '<div class="contexto">Carregando fechamento de caixas (PDV × gaveta × maquininhas × banco)...</div>';
    await carregarEmailDono();   // o dono tambem pode explicar pendencias
    [CAIXA_DIAS, CAIXA_CONTAGENS, CAIXA_RESP, CAIXA_CARTAO, CAIXA_PIX, CAIXA_TURNOS, CAIXA_VALID, CAIXA_DIAS_CX, CAIXA_CONF, CAIXA_CARTAO_CX, CAIXA_PIX_CX, CAIXA_AVISOS] = await Promise.all([
      consultarTudo('vw_caixa_fechamento_dia?select=*&order=data.desc'),
      consultarTudo('caixa_contagem?select=*&order=data.desc'),
      consultarTudo('caixa_responsaveis?select=email,unidade'),
      // o saldo acumulado da view vem desde 19/02 mesmo filtrando o dia (a janela
      // e por loja+grupo, o filtro nao entra nela) — e o que se quer: a deriva inteira
      consultarTudo('vw_cartao_conciliacao_dia?select=*&dia=gte.2026-08-01&order=dia'),
      consultarTudo('vw_pix_conciliacao_dia?select=*&dia=gte.2026-08-01&order=dia'),
      consultarTudo('vw_fechamento_caixa_turno?select=*&dia=gte.2026-08-01&order=dia'),
      // memoria de validacao (09/09/2026): pendencias explicadas por quem confere
      consultarTudo('caixa_pendencia_validada?select=*&dia=gte.' + CAIXA_VALID_DESDE()),
      // dinheiro por CAIXA do Saipos (Salao / Delivery) e dia: alimenta o esperado de cada gaveta (10/09/2026)
      consultarTudo('vw_caixa_fechamento_caixa_dia?select=*&order=data.desc'),
      // carimbo "conferido" por caixa e turno (10/09/2026): quem olhou e quando
      consultarTudo('caixa_conferencia?select=*&dia=gte.' + CAIXA_VALID_DESDE()),
      // filtro por CAIXA no modulo inteiro (dono, 10/09/2026 noite): as mesmas reguas de
      // cartao e PIX, quebradas por caixa (Saipos pelo cashier, Rede pela maquininha SD)
      consultarTudo('vw_cartao_conciliacao_caixa_dia?select=*&dia=gte.2026-08-01&order=dia'),
      consultarTudo('vw_pix_conciliacao_caixa_dia?select=*&dia=gte.2026-08-01&order=dia'),
      // recados da equipe para o dono (15/09/2026): o botao "Avisar o Neto"
      consultarTudo('painel_aviso?select=*&order=criado_em.desc&limit=40'),
    ]);
    CAIXA_DIAS_CX.forEach(r => { ['dinheiro_pdv', 'lancado_cofre', 'movimento_book', 'diferenca'].forEach(k => { r[k] = Number(r[k]); }); });
    CAIXA_DIAS.forEach(r => {
      r.dinheiro_pdv = Number(r.dinheiro_pdv); r.lancado_cofre = Number(r.lancado_cofre);
      r.diferenca = Number(r.diferenca); r.quebra_registrada = Number(r.quebra_registrada);
      r.saidas_cofre = Number(r.saidas_cofre); r.movimento_book = Number(r.movimento_book);
    });
    CAIXA_CONTAGENS.forEach(c => { c.contado = Number(c.contado); c.troco = (c.troco === null || c.troco === undefined) ? null : Number(c.troco); c.caixa = c.caixa || 'SALÃO'; });
    CAIXA_CARTAO_CX.forEach(r => { ['saipos', 'rede', 'diferenca', 'saipos_madrugada'].forEach(k => { r[k] = Number(r[k]); }); });
    CAIXA_PIX_CX.forEach(r => { Object.keys(r).forEach(k => { if (!['unidade', 'dia', 'caixa'].includes(k)) r[k] = Number(r[k]); }); });
    CAIXA_CARTAO.forEach(r => { ['saipos', 'rede', 'diferenca', 'saldo_acumulado', 'saipos_madrugada'].forEach(k => { r[k] = Number(r[k]); }); });
    CAIXA_PIX.forEach(r => { ['pdv', 'recebido', 'sem_par', 'aguardando', 'pdv_qr', 'recebido_qr', 'sem_par_qr', 'aguardando_qr',
                              'pdv_chave', 'recebido_chave', 'sem_par_chave', 'aguardando_chave'].forEach(k => { r[k] = Number(r[k]); }); });
  }
  renderModuloCaixa();
  if (listaHellen) caixaHellenCarregar();
}

// Salva (ou corrige) a contagem do dia. Upsert por (unidade, data): contagem
// errada se corrige por cima, nunca se apaga. A policy do banco confere o
// e-mail do JWT contra caixa_responsaveis — o painel só esconde o formulário,
// quem manda é o banco.
// 10/09/2026 (dono: "os caixas sobem separados"): uma contagem por CAIXA do Saipos —
// SALÃO e DELIVERY — cada uma com seu enviado + troco. O delivery abre com R$ 0,01
// (o Saipos nao deixa abrir zerado), por isso o troco dele vem preenchido com 0,01.
// "Avisar o Neto" (dono, 15/09/2026: "tem como colocar um botão no painel da Arissa, pra
// ela conseguir te avisar direto?"). Nasceu depois de 15/09, quando a Arissa abriu o
// módulo de manhã e o dia anterior estava pela metade (a importação do Saipos só terminou
// às 11:12) — o aviso foi parar no WhatsApp e não no sistema. O recado leva a loja e o dia
// que a pessoa está vendo, fica em `painel_aviso` e aparece: como faixa no painel do dono,
// e no resumo da importação diária da manhã seguinte.
const CAIXA_AVISO_ASSUNTOS = [
  'Os dados de ontem não apareceram',
  'Um valor não bate com o Saipos',
  'Não consigo registrar a contagem',
  'A tela travou ou deu erro',
  'Outro',
];
async function caixaRecarregarAvisos() {
  CAIXA_AVISOS = await consultarTudo('painel_aviso?select=*&order=criado_em.desc&limit=40');
  if (MODULO_ATUAL === 'caixa') renderModuloCaixa();
}

// 24/10/2026 (dono): aviso à equipe só pelo WhatsApp do robô — a faixa de recados saiu das telas. Os recados seguem
// gravados em painel_aviso (é de lá que o robô monta a mensagem) e o "Avisar o Neto" continua gravando.
function caixaAvisar() {
  const s = rmbSessao();
  if (!s || !s.email) { avisoAcao('atencao', '! Sessão expirada — faça login de novo.'); return; }
  const F = CAIXA_FILTRO;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:16px;';
  ov.innerHTML = `<div style="background:var(--surface); color:#e8e6dc; border:1px solid rgba(154,164,175,.35); border-radius:8px; max-width:560px; width:100%; padding:16px 18px; font-size:13px;">
    <div style="font-size:14px; font-weight:700;">Avisar o Neto</div>
    <div style="color:#a5a49a; font-size:12px; margin:2px 0 10px;">Ele recebe isto pelo resumo do robô. Não é urgência: se a loja estiver parada, ligue.</div>
    <label>o que houve<br><select id="avAssunto" style="width:100%; padding:4px; font:inherit;">${CAIXA_AVISO_ASSUNTOS.map(a => `<option>${a}</option>`).join('')}</select></label>
    <div style="display:flex; gap:8px; margin-top:8px;">
      <label style="flex:1;">loja<br><select id="avLoja" style="width:100%; padding:4px; font:inherit;"><option value="">todas</option>${['AGUA VERDE', 'AHU', 'SÃO BRAZ'].map(u => `<option ${F.loja === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      <label style="flex:1;">dia (se for de um dia)<br><input type="date" id="avDia" style="width:100%; padding:4px; font:inherit;"></label>
    </div>
    <label style="display:block; margin-top:8px;">conte o que você está vendo<br><textarea id="avTexto" rows="3" style="width:100%; padding:4px; font:inherit;" placeholder="ex.: abri agora e o dia de ontem da Água Verde está quase vazio"></textarea></label>
    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:10px;">
      <button id="avCancelar" style="font:inherit; padding:5px 12px; cursor:pointer;">cancelar</button>
      <button id="avEnviar" style="font:inherit; padding:5px 14px; cursor:pointer; font-weight:700;">Enviar</button>
    </div></div>`;
  document.body.appendChild(ov);
  const fechar = () => ov.remove();
  ov.querySelector('#avCancelar').onclick = fechar;
  ov.addEventListener('click', e => { if (e.target === ov) fechar(); });
  ov.querySelector('#avEnviar').onclick = async () => {
    const texto = ov.querySelector('#avTexto').value.trim();
    if (!texto) { avisoAcao('atencao', '! Escreva o que está acontecendo — é o que o Neto vai ler.'); return; }
    const corpo = { quem: s.email, modulo: 'caixa', assunto: ov.querySelector('#avAssunto').value,
      unidade: ov.querySelector('#avLoja').value || null, dia: ov.querySelector('#avDia').value || null, texto };
    const bt = ov.querySelector('#avEnviar'); bt.disabled = true; bt.textContent = 'enviando...';
    avisoAcao('enviando', 'Enviando o recado…');
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/painel_aviso`, { method: 'POST', headers: rmbHeaders(), body: JSON.stringify(corpo) });
      if (!r.ok) throw new Error((await r.text()).slice(0, 160));
      fechar();
      await caixaRecarregarAvisos();
      avisoAcao('ok', `✓ Recado enviado ao Neto — às ${avisoHora()}. Ele lê pelo resumo do robô.`);
    } catch (e) { avisoAcao('erro', '✗ Não consegui enviar: ' + e.message + '. Tente de novo.'); bt.disabled = false; bt.textContent = 'Enviar'; }
  };
  setTimeout(() => { const t = ov.querySelector('#avTexto'); if (t) t.focus(); }, 50);
}

// Abre/recolhe o detalhe venda a venda de uma forma no fechamento (11/09/2026)
function caixaToggleForma(fid) {
  const rows = document.querySelectorAll('.det-' + fid);
  if (!rows.length) return;
  const mostrar = rows[0].style.display === 'none';
  rows.forEach(tr => { tr.style.display = mostrar ? '' : 'none'; });
  const seta = document.getElementById('seta-' + fid);
  if (seta) seta.textContent = mostrar ? '▾' : '▸';
}
// Registro da contagem de dentro do dia (10/09/2026 noite): grava, recarrega tudo e reabre o dia.
async function caixaRegistrarNoDia(unidade, dia, caixa, idF) {
  const valor = document.getElementById(idF + 'Valor').value;
  const troco = document.getElementById(idF + 'Troco').value;
  const obs = document.getElementById(idF + 'Obs').value.trim();
  const s = rmbSessao();
  if (!s || !s.email) { avisoAcao('atencao', '! Sessão expirada — faça login de novo para registrar.'); return; }
  if (valor === '' || Number(valor) < 0) { avisoAcao('atencao', '! Digite o dinheiro enviado (0 vale, se não veio dinheiro).'); return; }
  if (troco === '' || Number(troco) < 0) { avisoAcao('atencao', '! Digite o troco que ficou na gaveta (0 vale, se ficou sem troco).'); return; }
  const bt = document.getElementById(idF + 'Btn');
  bt.disabled = true; bt.textContent = 'salvando...';
  avisoAcao('enviando', `Gravando a contagem do ${caixa}…`);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/caixa_contagem?on_conflict=unidade,data,caixa`, {
      method: 'POST', headers: rmbHeaders({ Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify({ unidade, data: dia, caixa, contado: Math.round((Number(valor) + Number(troco)) * 100) / 100, troco: Number(troco),
                             observacao: obs || null, quem: s.email, atualizado_em: new Date().toISOString() }),
    });
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    avisoAcao('ok', `✓ Contagem do ${caixa} de ${dia.split('-').reverse().join('/')} gravada — às ${avisoHora()}.`);
    CAIXA_DIAS = null;
    await entrarCaixa();
    await abrirDiaConcartao(unidade, dia);
  } catch (e) {
    avisoAcao('erro', '✗ Não consegui salvar a contagem: ' + e.message + '. Tente de novo.');
    bt.disabled = false; bt.textContent = 'Registrar';
  }
}
// Filtros do modulo (dono, 09/09/2026: "mais enxuto, com mais filtros"): loja,
// janela de dias e "so pendencias". Ficam no navegador da pessoa.
let CAIXA_FILTRO = (() => {
  const padrao = { loja: '', dias: 15, soPend: false, naoConf: false, caixa: '' };
  try { return Object.assign(padrao, JSON.parse(localStorage.getItem('caixaFiltro') || '{}')); } catch (e) { return padrao; }
})();
function caixaFiltrar(campo, valor) {
  CAIXA_FILTRO[campo] = valor;
  try { localStorage.setItem('caixaFiltro', JSON.stringify(CAIXA_FILTRO)); } catch (e) {}
  renderModuloCaixa();
}

// Tres blocos por dia (dono, 09/09/2026): DINHEIRO (PDV x gaveta contada, por caixa —
// desde 10/09 a noite o cofre do Saipos nao e mais regua), MAQUININHA (tudo que passa na maquina da Rede: cartao + vale +
// PIX QR — o QR nao vem na API da Rede, mas cai no banco linha a linha) e PIX
// CHAVE (avulso na chave CNPJ x transferencia no banco).
// ------------------------------------------------------------------
// O COFRE DE CADA LOJA (22/10/2026). Saldo = o da tela do Saipos (cofre + gaveta), partindo do corte travado de cada
// loja (SB 159,54 em 20/10; Ahú 430,75 e AV 11.585,71 em 21/10). O contado só vira diferença quando a contagem cobrir
// cofre + gaveta (contagem_cobre_cofre); hoje caixa_contagem é a da gaveta do salão, então mostra e não acusa.
// ------------------------------------------------------------------
let COFRE_DIA = null, COFRE_ENVIOS = null;
async function cofreCarregar() {
  try {
    const [d, e] = await Promise.all([
      consultarTudo('vw_caixa_cofre_dia?select=*&order=unidade,dia'),
      consultarTudo('vw_caixa_cofre_sb_envios?select=*&order=data_envio.desc,saida_id_titulo'),
    ]);
    COFRE_DIA = d; COFRE_ENVIOS = e;
  } catch (err) { COFRE_DIA = []; COFRE_ENVIOS = []; console.warn('cofre:', err.message); }
}
function cofreHtml() {
  if (!COFRE_DIA) return '';
  const dm = (s) => s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : '—';
  const LOJAS = caixaLojas();
  // CONTAGEM ÀS CEGAS (dono, 22/10/2026: "Pode seguir com os campos em branco: a Arissa digita o contado e a tela mostra
  // o esperado e a diferença depois de gravar"). Quem confere a loja vê gaveta e cofre em branco; o saldo do Saipos só
  // aparece depois de gravar a contagem do dia. O dono vê o saldo direto. Os campos só aparecem quando o banco tiver a
  // coluna caixa_contagem.cofre (vw_caixa_cofre_dia.cofre_contado).
  const email = String((rmbSessao() || {}).email || '').toLowerCase();
  const dono = typeof souODono === 'function' && souODono();
  const confere = (u) => (CAIXA_RESP || []).some((r) => String(r.email).toLowerCase() === email && r.unidade === u);
  const temCampoCofre = COFRE_DIA.some((r) => 'cofre_contado' in r);
  const cards = LOJAS.map(([u, rot]) => {
    const L = COFRE_DIA.filter((r) => r.unidade === u);
    if (!L.length) return '';
    const hoje = L[L.length - 1];
    const contouHoje = hoje.cofre_contado != null;
    if (temCampoCofre && !dono && confere(u) && !contouHoje) {
      const sel = 'width:130px; text-align:right; background:var(--surface-2); border:1px solid var(--line); border-radius:8px; color:var(--tx-1); padding:8px;';
      const k = u.replace(/[^A-Z]/g, '');
      return `<div class="card neutral" style="text-align:left;">
        <div class="card-lbl">${rot} · contagem de ${dm(hoje.dia)}</div>
        <div class="card-pct">Conte o dinheiro e digite. O saldo do sistema aparece depois de gravar.</div>
        <label style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">gaveta R$ <input type="number" step="0.01" min="0" inputmode="decimal" id="cfG_${k}" style="${sel}"></label>
        <label style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">cofre R$ <input type="number" step="0.01" min="0" inputmode="decimal" id="cfC_${k}" style="${sel}"></label>
        <button class="preset-btn" style="margin-top:8px;" onclick="cofreGravarContagem('${u}', '${hoje.dia}', '${k}')">Gravar a contagem</button></div>`;
    }
    const corte = L.find((r) => r.tem_corte);
    const cobre = hoje.contagem_cobre_cofre === true;
    const dif = cobre && hoje.diferenca != null ? Number(hoje.diferenca) : null;
    const difTxt = dif == null ? '' : Math.abs(dif) < 0.005
      ? `<div style="color:var(--farol-ok); font-weight:700;">bateu</div>`
      : `<div style="color:var(--farol-fora); font-weight:700;">diferença R$ ${fmt(dif)}</div>`;
    const contadoTxt = hoje.contado == null ? '<span style="color:var(--tx-5);">sem contagem hoje</span>'
      : cobre ? `contado R$ ${fmt(Number(hoje.contado))}${hoje.gaveta_contada != null ? ` <span class="caption-label">(gaveta ${fmt(Number(hoje.gaveta_contada))} + cofre ${fmt(Number(hoje.cofre_contado))})</span>` : ''}`
      : `gaveta contada R$ ${fmt(Number(hoje.contado))} <span class="caption-label">(só a gaveta: não compara com o cofre)</span>`;
    return `<div class="card neutral" style="text-align:left;">
      <div class="card-lbl">${rot} · cofre ${dm(hoje.dia)}</div>
      <div class="card-val">R$ ${fmt(Number(hoje.saldo_fim_dia))}</div>
      <div class="card-pct">de ontem para hoje: entrou R$ ${fmt(Number(hoje.entrou || 0))} · saiu R$ ${fmt(Number(hoje.saiu || 0))}</div>
      <div class="card-pct">${contadoTxt}</div>${difTxt}
      <div class="caption-label">${corte ? `parte do corte de ${dm(corte.dia)}` : 'sem corte travado'}</div></div>`;
  }).join('');
  // dinheiro do SB para a AV: o robô lança a entrada na AV sozinho; a Arissa só marca o que NÃO chegou
  // 28/10/2026: o envio SB → AV só é assunto dessas duas lojas (e da Rede); no Ahú o quadro não aparece
  const vSB = caixaLojaVisao();
  const E = !vSB || vSB === LOJA_REDE || vSB === 'SÃO BRAZ' || vSB === 'AGUA VERDE' ? (COFRE_ENVIOS || []) : [];
  const entrou = E.filter((x) => x.situacao === 'ENTROU NA AV');
  const robo = E.filter((x) => x.situacao === 'ROBO VAI LANCAR');
  const naoChegou = E.filter((x) => String(x.situacao).startsWith('MARCADO'));
  const soma = (A) => A.reduce((s, x) => s + Number(x.valor || 0), 0);
  // 03/11/2026 (dono, "pode aplicar"): o banco só aceita o "Não chegou" da Hellen e do dono; para os outros, o botão nem aparece
  const marcaNaoChegou = ['hellen@cidadaodomundo.com.br', 'neto@cidadaodomundo.com.br'].includes(((rmbSessao() || {}).email || '').toLowerCase());
  const linha = (x) => {
    const id = Number(x.saida_id_titulo);
    const acao = !marcaNaoChegou ? '' : x.situacao === 'ROBO VAI LANCAR' ? `<button class="preset-btn" onclick="cofreNaoChegou(${id})">Não chegou</button>`
      : String(x.situacao).startsWith('MARCADO') ? `<button class="preset-btn" onclick="cofreDesfazerNaoChegou(${id})">desfazer</button>` : '';
    return `<tr><td>${dm(x.data_envio)}</td><td style="text-align:right;">R$ ${fmt(Number(x.valor))}</td>
      <td>${x.situacao === 'ENTROU NA AV' ? '<span style="color:var(--farol-ok);">entrou na AV</span>'
          : x.situacao === 'ROBO VAI LANCAR' ? 'o robô vai lançar a entrada na AV'
          : `<span style="color:var(--farol-fora);">não chegou</span>${x.nao_recebido_obs ? ' — ' + trEscH(x.nao_recebido_obs) : ''}`}</td><td>${acao}</td></tr>`;
  };
  const pendentes = [...robo, ...naoChegou];
  const blocoSB = E.length ? `<div class="section-label">Dinheiro do São Braz para a Água Verde</div>
    <div class="contexto" style="text-align:left;">${E.length} envios desde ${dm(E[E.length - 1].data_envio)}, R$ ${fmt(soma(E))}:
      <b style="color:var(--farol-ok);">${entrou.length} já entraram na AV (R$ ${fmt(soma(entrou))})</b>${robo.length ? ` · ${robo.length} o robô vai lançar (R$ ${fmt(soma(robo))})` : ''}${naoChegou.length ? ` · <b style="color:var(--farol-fora);">${naoChegou.length} marcados como não chegou</b>` : ''}.
      <div class="caption-label" style="text-align:left;">O robô lança a entrada na AV sozinho. Se o dinheiro de um envio não chegou, ${marcaNaoChegou ? 'marque "Não chegou"' : 'a Hellen marca "Não chegou"'} e o robô não lança.</div></div>
    ${pendentes.length ? `<div id="tabelaCofreSbPend"><table><thead><tr><th>Saiu do SB</th><th style="text-align:right;">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${pendentes.map(linha).join('')}</tbody></table></div>` : ''}
    <details><summary style="cursor:pointer;">ver os ${entrou.length} que já entraram</summary>
      <div id="tabelaCofreSbOk"><table><thead><tr><th>Saiu do SB</th><th style="text-align:right;">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${entrou.map(linha).join('')}</tbody></table></div></details>` : '';
  return `<div class="section-label">O cofre de cada loja</div>
    <div class="cards cards-3">${cards}</div>
    <div class="caption-label" style="text-align:left;">Saldo = o da tela do Saipos (cofre + gaveta), a partir do corte travado de cada loja. A diferença só aparece quando a contagem for do cofre + gaveta.</div>
    ${blocoSB}`;
}
async function cofreGravarContagem(unidade, dia, k) {
  const g = document.getElementById('cfG_' + k).value, c = document.getElementById('cfC_' + k).value;
  if (g === '' || c === '') { avisoAcao('atencao', '! Digite a gaveta e o cofre (0 vale, se estiver vazio).'); return; }
  const s = rmbSessao();
  avisoAcao('enviando', 'Gravando a contagem do cofre…');
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/caixa_contagem?on_conflict=unidade,data,caixa`, { method: 'POST',
      headers: rmbHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify({ unidade, data: dia, caixa: 'SALÃO', contado: Math.round(Number(g) * 100) / 100, troco: null,
        cofre: Math.round(Number(c) * 100) / 100, quem: s && s.email, atualizado_em: new Date().toISOString() }) });
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    avisoAcao('ok', `✓ Contagem do cofre de ${dia.split('-').reverse().join('/')} gravada — às ${avisoHora()}.`);
    await cofreCarregar(); renderModuloCaixa();
  } catch (e) { avisoAcao('erro', '✗ Não consegui gravar: ' + e.message + '. Tente de novo.'); }
}
async function cofreNaoChegou(id) {
  const obs = prompt('O dinheiro deste envio não chegou à Água Verde. Quer deixar uma observação? (opcional)');
  if (obs === null) return;
  const s = rmbSessao();
  avisoAcao('enviando', 'Marcando “não chegou”…');
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/caixa_cofre_nao_recebido`, { method: 'POST', headers: rmbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ saida_id_titulo: id, observacao: obs || null, quem: s && s.email }) });
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    avisoAcao('ok', `✓ Marcado como não chegou — o robô não lança esta entrada. Às ${avisoHora()}.`);
    await cofreCarregar(); renderModuloCaixa();
  } catch (e) { avisoAcao('erro', '✗ Não consegui marcar: ' + e.message + '. Tente de novo.'); }
}
async function cofreDesfazerNaoChegou(id) {
  if (!confirm('Desfazer o "não chegou" deste envio? O robô volta a lançar a entrada na AV.')) return;
  avisoAcao('enviando', 'Desfazendo o “não chegou”…');
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/caixa_cofre_nao_recebido?saida_id_titulo=eq.${id}&cancelado=is.false`, { method: 'PATCH',
      headers: rmbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: JSON.stringify({ cancelado: true }) });
    if (!r.ok) throw new Error((await r.text()).slice(0, 160));
    avisoAcao('ok', `✓ Desfeito — o robô volta a lançar a entrada na AV. Às ${avisoHora()}.`);
    if (!(await r.json()).length) throw new Error('o banco não desfez nada (talvez você não tenha permissão para desfazer o que outra pessoa gravou)');
    await cofreCarregar(); renderModuloCaixa();
  } catch (e) { avisoAcao('erro', '✗ Não consegui desfazer: ' + e.message + '. Tente de novo.'); }
}

// ===== PARA VOCÊ RESOLVER (03/11/2026; dono 29/10 10:48: "mostrar pra ela no caixa somente as pendências que ela
// precisa tomar alguma ação"; proposta contexto/propostas-telas/2026-10-29-fechamento-caixa-hellen.md). Uma lista das
// lojas de quem confere, desde o recomeço de cada loja, mais antiga primeiro. O cruzamento é o mesmo do clique no dia
// (renderDiaConcartao com calc); a troca que o robô faz e o que só espera (madrugada, PIX de fim de semana) não entram.
let CAIXA_HELLEN = null, CAIXA_HELLEN_CALC = null;
function caixaHellenLojas() {
  const eu = String((rmbSessao() || {}).email || '').toLowerCase();
  const dono = typeof souODono === 'function' && souODono();
  return caixaLojas().map(([u]) => u).filter(u => dono || (CAIXA_RESP || []).some(r => r.unidade === u && String(r.email).toLowerCase() === eu));
}
// recomeço limpo de cada loja (21/10/2026): o corte travado do cofre
const caixaHellenCorte = u => ((COFRE_DIA || []).find(r => r.unidade === u && r.tem_corte) || {}).dia || '2026-10-20';
const caixaHellenMais = (d, k) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + k); return x.toLocaleDateString('en-CA'); };
async function caixaHellenCarregar() {
  const lojas = caixaHellenLojas();
  if (!lojas.length) { CAIXA_HELLEN = { lojas: [] }; return; }
  const mais = caixaHellenMais;
  const hoje = new Date().toLocaleDateString('en-CA');
  const ate = mais(hoje, -1), des = lojas.map(caixaHellenCorte).sort()[0];
  const un = 'unidade=in.(' + lojas.map(u => '"' + encodeURIComponent(u) + '"').join(',') + ')';
  const faixa = (a, b) => '&dia=gte.' + a + '&dia=lte.' + b + '&' + un;
  try {
    const [trs, pix, cobr, forma, onl, robo, quebras] = await Promise.all([
      consultarTudo('vw_cartao_transacoes?select=*' + faixa(mais(des, -1), hoje) + '&order=dia,hora'),
      consultarTudo('vw_pix_conciliacao?select=dia,unidade,id_sale,numero,numero_pedido,mesa,data_venda,caixa,tipo,valor,entrega,entregador,subgrupo,recebido,aguardando,memo_banco,data_banco,conta_banco' + faixa(des, ate) + '&order=entrega'),
      consultarTudo('vw_cartao_entrega_cobranca?select=dia,unidade,id_sale,entregador' + faixa(des, ate)),
      consultarTudo('vw_cartao_bandeira_divergente?select=dia,unidade,hora,registrado,passou,valor,nivel,numero,mesa,caixa,id_sale' + faixa(des, ate) + '&order=hora'),
      consultarTudo('vw_caixa_online_dia?select=*&canal_ok=not.is.true' + faixa(des, ate) + '&order=hora'),
      consultarTudo('vw_caixa_troca_bandeira_robo?select=dia,unidade,id_sale,valor,caixa,numero,mesa,forma_no_saipos,forma_nova,acao,feito_em' + faixa(des, hoje) + '&acao=in.(TROCAR,FEITO_AGUARDA_CARGA)').catch(() => []),
      consultarTudo('vw_caixa_quebras?select=*&reposta_em=is.null&' + un).catch(() => []),
    ]);
    CAIXA_HELLEN = { lojas, des, ate, hoje, trs, pix, cobr, forma, onl, robo, quebras };
  } catch (e) { CAIXA_HELLEN = { lojas, erro: e.message }; }
  CAIXA_HELLEN_CALC = null;
  renderModuloCaixa();
}
function caixaHellenItens() {
  const H = CAIXA_HELLEN;
  if (!H || H.erro || !H.lojas.length || !H.trs) return [];
  if (CAIXA_HELLEN_CALC && CAIXA_HELLEN_CALC.valid === CAIXA_VALID && CAIXA_HELLEN_CALC.envios === COFRE_ENVIOS) return CAIXA_HELLEN_CALC.itens;
  const reais = v => 'R$ ' + fmt(Math.abs(+v));
  const mais = caixaHellenMais;
  const dm = d => String(d || '').slice(8, 10) + '/' + String(d || '').slice(5, 7);
  const itens = [];
  const add = o => itens.push({ caixa: '', valor: null, ...o });
  H.lojas.forEach(u => {
    const deLoja = H.trs.filter(x => x.unidade === u), corte = caixaHellenCorte(u);
    for (let dia = corte; dia <= H.ate; dia = mais(dia, 1)) {
      const viz = [mais(dia, -1), dia, mais(dia, 1)];
      const doDia = A => (A || []).filter(x => x.unidade === u && x.dia === dia);
      let r;
      try { r = renderDiaConcartao(u, dia, deLoja.filter(x => viz.includes(String(x.dia))), doDia(H.pix), doDia(H.cobr), doDia(H.forma), [], [], { robo: doDia(H.robo) }); }
      catch (e) { add({ u, dia, ordem: 9, oque: 'não consegui conferir este dia (' + e.message + ')', acao: 'abrir' }); continue; }
      if (!r) continue;
      r.turnos.filter(t => t.fechado === false).forEach(t => add({ u, dia, caixa: t.caixa === 'SALÃO' || t.caixa === 'DELIVERY' ? t.caixa : '', ordem: 0,
        oque: 'caixa ainda aberto no Saipos desde ' + dm(t.aberto_em) + ' ' + String(t.aberto_em || '').slice(11, 16), acao: 'abrir', botao: 'fechar o caixa' }));
      r.trocas.forEach(t => add({ u, dia, caixa: t.caixa || '', ordem: 1, valor: t.valor, oque: `${t.venda} às ${t.hora}: registrada como ${t.de}, passou como ${t.para}`, acao: 'abrir',
        botao: t.pd ? 'fechar a venda com ' + t.para : 'trocar para ' + t.para }));
      r.abertas.forEach(x => add({ u, dia, caixa: x.caixa || '', ordem: 2, valor: x.valor,
        oque: `${x.hora} · ${String(x.saipos || '').replace(/<[^>]+>/g, '')} × ${x.real} — ${x.leitura}`, acao: 'explicar', pend: x }));
    }
    // online pago com a forma errada (canal do pedido ≠ forma registrada)
    (H.onl || []).filter(x => x.unidade === u && x.dia >= corte).forEach(x => add({ u, dia: x.dia, caixa: x.caixa || '', ordem: 2, valor: +x.valor,
      oque: `venda ${x.numero || ''} registrada como ${x.tipo}, mas o pedido é do canal ${x.canal}`, acao: 'abrir', botao: x.canal_ok === false ? 'trocar a forma' : 'conferir' }));
    // cofre: contado diferente do Saipos, e hoje sem contagem
    const cof = (COFRE_DIA || []).filter(r => r.unidade === u && r.dia >= corte);
    cof.filter(r => r.contagem_cobre_cofre === true && r.diferenca != null && Math.abs(+r.diferenca) >= 0.01).forEach(r => add({ u, dia: r.dia, ordem: 3, valor: +r.diferenca,
      oque: `gaveta + cofre contados ${+r.diferenca < 0 ? 'abaixo' : 'acima'} do Saipos`, acao: 'cofre', botao: 'ver o cofre' }));
    const ult = cof[cof.length - 1];
    if (ult && ult.contado == null) {
      const ultC = [...cof].reverse().find(r => r.contado != null);
      add({ u, dia: ult.dia, ordem: 4, oque: 'dinheiro de hoje ainda não contado' + (ultC ? ' (última contagem ' + dm(ultC.dia) + ')' : ' (nenhuma contagem desde o recomeço de ' + dm(corte) + ')'), acao: 'cofre', botao: 'contar' });
    }
    // quebra explicada que ninguém repôs nem descontou
    (H.quebras || []).filter(q => q.unidade === u && q.dia >= corte).forEach(q => add({ u, dia: q.dia, caixa: q.caixa || '', ordem: 5, valor: +q.quebra,
      oque: `quebra (${q.responsavel || 'sem responsável'}): descontar ou repor`, acao: 'abrir' }));
  });
  // dinheiro do SB para a AV parado há mais de 2 dias, ou marcado como não chegou
  const doisDias = mais(H.hoje, -2);
  if (H.lojas.includes('AGUA VERDE') || H.lojas.includes('SÃO BRAZ')) (COFRE_ENVIOS || []).forEach(x => {
    if (x.situacao === 'ROBO VAI LANCAR' && x.data_envio <= doisDias) add({ u: 'SÃO BRAZ', dia: x.data_envio, ordem: 3, valor: +x.valor, oque: 'envio do São Braz para a Água Verde: o dinheiro chegou?', acao: 'naochegou', id: +x.saida_id_titulo });
    else if (String(x.situacao).startsWith('MARCADO')) add({ u: 'SÃO BRAZ', dia: x.data_envio, ordem: 3, valor: +x.valor, oque: 'envio para a Água Verde marcado como não chegou' + (x.nao_recebido_obs ? ' (' + x.nao_recebido_obs + ')' : '') + ': explicar a diferença no São Braz', acao: 'cofre', botao: 'ver o cofre' });
  });
  itens.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0) || a.u.localeCompare(b.u) || a.ordem - b.ordem);
  itens.forEach((x, i) => { x.i = i; });
  CAIXA_HELLEN_CALC = { valid: CAIXA_VALID, envios: COFRE_ENVIOS, itens };
  return itens;
}
function caixaHellenHtml() {
  const H = CAIXA_HELLEN;
  if (H === null) return caixaHellenLojas().length ? '<div class="section-label">Para você resolver</div><div class="contexto">Montando a sua lista…</div>' : '';
  if (!H.lojas.length) return '';
  if (H.erro) return `<div class="section-label">Para você resolver</div><div class="contexto" style="border-color:var(--farol-fora); text-align:left;">✗ Não consegui montar a lista: ${trEscH(H.erro)}. <button class="preset-btn" onclick="caixaHellenDeNovo()">Tentar de novo</button></div>`;
  const itens = caixaHellenItens();
  const dm = d => String(d).slice(8, 10) + '/' + String(d).slice(5, 7);
  const rotCx = cx => cx === 'SALÃO' ? 'Salão' : cx === 'DELIVERY' ? 'Delivery' : '—';
  const nomeLoja = u => typeof lojaNome === 'function' ? lojaNome(u) : u;
  const marca = ['hellen@cidadaodomundo.com.br', 'neto@cidadaodomundo.com.br'].includes(String((rmbSessao() || {}).email || '').toLowerCase());
  const btn = x => x.acao === 'explicar' ? `<button class="preset-btn" onclick="event.stopPropagation(); caixaHellenExplicar(${x.i})">Explicar</button>`
    : x.acao === 'naochegou' ? (marca ? `<button class="preset-btn" onclick="event.stopPropagation(); cofreNaoChegou(${x.id})">Não chegou</button>` : '')
    : x.acao === 'cofre' ? `<button class="preset-btn" onclick="event.stopPropagation(); caixaHellenCofre()">${x.botao}</button>`
    : `<button class="preset-btn" onclick="event.stopPropagation(); caixaHellenAbrir(${x.i})">${x.botao || 'abrir o dia'}</button>`;
  const linhas = itens.map(x => `<tr style="cursor:pointer;" onclick="caixaHellenAbrir(${x.i})" title="abre o dia com as vendas lado a lado">
      <td style="white-space:nowrap;">${nomeLoja(x.u)}</td><td style="white-space:nowrap;">${dm(x.dia)}</td><td>${rotCx(x.caixa)}</td>
      <td style="text-align:left;">${trEscH(x.oque)}</td><td style="text-align:right; white-space:nowrap;">${x.valor == null ? '—' : 'R$ ' + fmt(Math.abs(x.valor))}</td><td style="white-space:nowrap;">${btn(x)}</td></tr>`).join('');
  const rb = H.robo || [], vai = rb.filter(x => x.acao === 'TROCAR'), feito = rb.filter(x => x.acao === 'FEITO_AGUARDA_CARGA');
  const somaRb = A => 'R$ ' + fmt(A.reduce((a, x) => a + +x.valor, 0));
  const rodape = rb.length ? `<div class="caption-label" style="text-align:left; margin-top:6px;">🤖 ${vai.length ? `o robô vai trocar ${vai.length} bandeira(s) no Saipos (${somaRb(vai)})` : ''}${vai.length && feito.length ? ' · ' : ''}${feito.length ? `trocou ${feito.length} (${somaRb(feito)}), esperando a próxima leitura do Saipos` : ''} — não precisa fazer nada.</div>` : '';
  return `<div class="section-label">Para você resolver (${itens.length})</div>
    <div class="contexto" style="text-align:left; border-color:${itens.length ? '#f5a623' : 'var(--farol-ok)'};">
      ${itens.length ? `<div style="overflow-x:auto;"><table><thead><tr><th>Loja</th><th>Dia</th><th>Caixa</th><th style="text-align:left;">O que aconteceu</th><th style="text-align:right;">Valor</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>`
        : `<b style="color:var(--farol-ok);">✓ Nada para você resolver</b> — desde o recomeço de cada loja até ontem, tudo bateu ou já foi explicado.`}
      ${rodape}
    </div>`;
}
function caixaHellenDeNovo() { CAIXA_HELLEN = null; renderModuloCaixa(); caixaHellenCarregar(); }
async function caixaHellenAbrir(i) {
  const x = CAIXA_HELLEN_CALC && CAIXA_HELLEN_CALC.itens[i];
  if (!x) return;
  if (x.acao === 'cofre' || x.acao === 'naochegou') { caixaHellenCofre(); return; }
  await abrirDiaConcartao(x.u, x.dia);
  if (x.caixa) caixaDrillFiltro(x.caixa);
}
function caixaHellenCofre() {
  const el = document.querySelector('#view-caixa .cards') || document.getElementById('tabelaCofreSbPend');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function caixaHellenExplicar(i) {
  const x = CAIXA_HELLEN_CALC && CAIXA_HELLEN_CALC.itens[i];
  if (x && x.pend) await caixaExplicarItem({ unidade: x.u, dia: x.dia }, x.pend);
}

function renderModuloCaixa() {
  const alvo = document.getElementById('view-caixa');
  // data local de verdade (toISOString e' UTC e vira amanha depois das 21h)
  const hoje = new Date().toLocaleDateString('en-CA');
  const LOJAS_CAIXA = caixaLojas();
  const visao = caixaLojaVisao();
  // na casca a loja é a do topo; solta, botões com as lojas do login (as permitidas, mais a Rede quando ela vale)
  const naCasca = window.parent !== window;
  const botoesLoja = naCasca || !visao || typeof LOJA_INFO === 'undefined' || !LOJA_INFO || LOJA_INFO.travado ? ''
    : LOJA_INFO.lojas.map((u) => `<button class="navbtn ${visao === u ? 'active' : ''}" onclick="caixaTrocarLoja('${u}')">${lojaNome(u)}</button>`).join('') + '<span style="width:12px;"></span>';
  const F = CAIXA_FILTRO;
  const dias = [];
  for (let i = 0; i < F.dias; i++) {
    const d = new Date(hoje + 'T12:00:00');
    d.setDate(d.getDate() - i);
    const iso = d.toLocaleDateString('en-CA');
    if (iso < '2026-08-01') break;         // a serie comeca aqui
    dias.push(iso);
  }
  const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const fmtDia = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)} (${DIAS_SEMANA[new Date(iso + 'T12:00:00').getDay()]})`;
  const vazio = '<span style="color:#9aa4af;">—</span>';
  const num = (v) => (v === undefined || v === null || Math.abs(+v) < 0.005) ? vazio : 'R$ ' + fmt(+v);
  const dif = (v) => (v === undefined || v === null || Math.abs(+v) < 0.01) ? vazio : '<b style="color:#f5a623;">R$ ' + fmt(+v) + '</b>';
  const cartaoDe = {}, pixDe = {};
  // com o filtro de caixa, cartao e PIX vem das views por caixa (mesma regua)
  (F.caixa ? (CAIXA_CARTAO_CX || []).filter(r => r.caixa === F.caixa) : CAIXA_CARTAO).forEach(r => { cartaoDe[r.unidade + '|' + r.dia + '|' + r.grupo] = r; });
  (F.caixa ? (CAIXA_PIX_CX || []).filter(r => r.caixa === F.caixa) : CAIXA_PIX).forEach(r => { pixDe[r.unidade + '|' + r.dia] = r; });
  const saldoDe = (u, g) => { const l = CAIXA_CARTAO.filter(r => r.unidade === u && r.grupo === g); return l.length ? l[l.length - 1].saldo_acumulado : null; };
  const corSaldo = s => s === null ? '#9aa4af' : Math.abs(s) < 0.01 ? '#3f9c5a' : '#f5a623';
  const td = 'padding:3px 6px; text-align:right; white-space:nowrap;';
  const sep = ' border-left:1px solid rgba(154,164,175,.25);';
  const th = 'padding:3px 6px; font-weight:normal; text-align:right; white-space:nowrap;';
  // Lista de dias enxuta (dono, 10/09/2026 noite: "toda essa tabela inicial passar a compor
  // a tela abaixo de fechamento"): os numeros por forma vivem no clique do dia; aqui so o
  // dia, o que falta e quem conferiu.
  const cabecalho = `
        <tr style="color:#9aa4af; text-align:left; font-size:11px; text-transform:uppercase;">
          <th style="padding:3px 6px; font-weight:normal;">dia</th>
          <th style="padding:3px 6px; font-weight:normal;">o que falta</th>
          <th style="padding:3px 6px; font-weight:normal;" title="carimbo de quem conferiu cada caixa do turno">conferido</th>
          <th></th></tr>`;
  const btn = (ativo, onclick, rotulo) => `<button class="navbtn ${ativo ? 'active' : ''}" onclick="${onclick}">${rotulo}</button>`;
  const filtros = `<div style="display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin:8px 0 4px;">
    ${botoesLoja}    ${[7, 15, 30, 60].map(n => btn(F.dias === n, `caixaFiltrar('dias',${n})`, n + ' dias')).join('')}
    <span style="width:12px;"></span>
    ${btn(F.soPend, `caixaFiltrar('soPend',${!F.soPend})`, 'só pendências')}
    ${btn(F.naoConf, `caixaFiltrar('naoConf',${!F.naoConf})`, 'não conferidos')}
    <span style="width:12px;"></span>
    <span style="font-size:12px; color:#a5a49a;" title="muda o módulo inteiro para um caixa só: tabela do dia, contagem, conferido e o clique no dia">caixa:</span>${btn(!F.caixa, "caixaFiltrar('caixa','')", 'Os dois')}${btn(F.caixa === 'SALÃO', "caixaFiltrar('caixa','SALÃO')", 'Salão')}${btn(F.caixa === 'DELIVERY', "caixaFiltrar('caixa','DELIVERY')", 'Delivery')}
    <button onclick="caixaAvisar()" title="manda um recado para o Neto com a loja e o dia que você está vendo — ele recebe pelo resumo do robô" style="font:inherit; font-size:12px; padding:3px 12px; cursor:pointer; margin-left:auto; font-weight:600;">✉ Avisar o Neto</button>
  </div>`;

  let blocos = '';
  let pendTotal = 0, semFechTotal = 0;

  for (const [unidade, rotulo] of LOJAS_CAIXA) {
    const porDia = {};
    const diasLoja = CAIXA_DIAS.filter(r => r.unidade === unidade);
    diasLoja.forEach(r => { porDia[r.data] = r; });

    // diasCx aqui so responde UMA pergunta: esta loja tem caixa de SALÃO? A conta da
    // contagem (vendido x enviado, por caixa) mudou de lugar em 10/09/2026 e vive
    // dentro do dia, em abrirDiaConcartao — nao ha mais conta nenhuma nesta lista.
    const diasCx = (CAIXA_DIAS_CX || []).filter(r => r.unidade === unidade);
    const temSalao = diasCx.some(r => r.caixa === 'SALÃO' && (r.dinheiro_pdv > 0 || r.lancado_cofre > 0));
    const caixasDaLoja = (temSalao ? ['SALÃO', 'DELIVERY'] : ['DELIVERY']).filter(cx => !F.caixa || cx === F.caixa);
    const saldoC = saldoDe(unidade, 'CARTAO'), saldoV = saldoDe(unidade, 'VOUCHER');

    let semFech = 0, pend = 0;
    const linhas = dias.map(iso => {
      const r = porDia[iso];
      const aberto = iso === hoje;
      const c = cartaoDe[unidade + '|' + iso + '|CARTAO'] || {};
      const v = cartaoDe[unidade + '|' + iso + '|VOUCHER'] || {};
      const p = pixDe[unidade + '|' + iso] || {};
      // bloco maquininha = cartao + vale + PIX QR (tudo que passa na maquina)
      const maqPdv = (c.saipos || 0) + (v.saipos || 0) + (p.pdv_qr || 0);
      const maqReal = (c.rede || 0) + (v.rede || 0) + (p.recebido_qr || 0);
      // turno de ontem: a Rede so entrega a madrugada (00h-06h) amanha — o que o PDV
      // registrou nessa faixa fica "aguardando", nao pendencia (10/09/2026)
      const redeIncompleta = (c.rede_completa === false) || (v.rede_completa === false);
      const madrugada = redeIncompleta ? (c.saipos_madrugada || 0) + (v.saipos_madrugada || 0) : 0;
      const maqDif = (c.diferenca || 0) + (v.diferenca || 0) + (p.sem_par_qr || 0) - madrugada;
      const maqAguard = (p.aguardando_qr || 0) + madrugada;
      const chavePdv = p.pdv_chave || 0, chaveReal = p.recebido_chave || 0;
      const chaveSem = p.sem_par_chave || 0, chaveAguard = p.aguardando_chave || 0;
      // dinheiro = contagem por caixa (10/09/2026 noite); o cofre do Saipos saiu da regua
      const dinCx = aberto ? [] : caixaDinheiroDia(unidade, iso).filter(d => !F.caixa || d.caixa === F.caixa);
      const temDinheiro = F.caixa ? dinCx.some(d => d.vendido >= 0.01 || d.contagem) : (r && r.situacao !== 'SEM MOVIMENTO');
      const semFechDia = F.caixa ? dinCx.some(d => d.aberto) : (r && r.situacao === 'SEM FECHAMENTO');
      const dinVend = dinCx.reduce((a, d) => a + d.vendido, 0);
      const dinCont = dinCx.filter(d => d.contagem);
      const dinEnv = dinCont.reduce((a, d) => a + d.enviado, 0);
      const dinDif = Math.round(dinCont.reduce((a, d) => a + (d.bateu ? 0 : d.dif), 0) * 100) / 100;
      const faltaContar = dinCx.some(d => d.faltaContar);
      const difDin = v => Math.abs(v) < 0.01 ? vazio : '<b style="color:' + (v < 0 ? '#ff6b6b' : '#f5a623') + ';">R$ ' + fmt(v) + '</b>';
      // memoria de validacao (09/09/2026): o que foi explicado sai da diferenca do
      // bloco; dia com diferenca ja zerada ignora as explicadas (o vale apareceu)
      const vals = (CAIXA_VALID || []).filter(v => v.unidade === unidade && v.dia === iso && (!F.caixa || !v.caixa || v.caixa === F.caixa));
      const efeito = b => vals.filter(v => v.bloco === b).reduce((a, v) => a + +v.efeito, 0);
      const maqResto = Math.abs(maqDif) < 0.01 ? 0 : maqDif - efeito('maquininha');
      const chaveResto = chaveSem <= 0 ? 0 : Math.max(0, chaveSem - efeito('pix_chave'));
      const dinExplicado = vals.some(v => v.bloco === 'dinheiro');
      const badge = vals.length ? ` <span style="color:#9aa4af; font-weight:normal;" title="pendências explicadas por quem conferiu">· ${vals.length} explicada(s)</span>` : '';
      const expl = v => '<span style="color:#9aa4af; text-decoration:line-through;" title="explicada">R$ ' + fmt(v) + '</span>';
      let situacao, cor = '', alerta = false;
      if (aberto) situacao = '<span style="color:#9aa4af;">dia em aberto</span>';
      else if (!temDinheiro && maqPdv === 0 && maqReal === 0 && chavePdv === 0) situacao = '<span style="color:#9aa4af;">sem movimento</span>';
      else if (semFechDia && !dinExplicado) { situacao = '<b style="color:#ff6b6b;">turno não fechou</b>' + badge; cor = 'background:rgba(255,107,107,.07);'; alerta = true; semFech++; }
      else {
        const o = [];
        if (!dinExplicado) { if (faltaContar) o.push('dinheiro (falta contar)'); else if (Math.abs(dinDif) >= 0.01) o.push('dinheiro'); }
        if (Math.abs(maqResto) >= 0.01) o.push('maquininha');
        if (chaveResto > 0) o.push('PIX chave');
        if (o.length) { situacao = `<b style="color:#f5a623;">conferir ${o.join(' + ')}</b>` + badge; cor = 'background:rgba(245,166,35,.07);'; alerta = true; }
        else situacao = '<span style="color:#3f9c5a;">✔ fechou</span>' + badge;
      }
      if (alerta) pend++;
      if (F.soPend && !alerta) return '';
      // carimbo de conferido por caixa (10/09/2026)
      const confs = (CAIXA_CONF || []).filter(c => c.unidade === unidade && c.dia === iso);
      const semMov = !temDinheiro && maqPdv === 0 && maqReal === 0 && chavePdv === 0;
      const faltaConf = !aberto && !semMov && caixasDaLoja.some(cx => !confs.some(c => c.caixa === cx));
      if (F.naoConf && !faltaConf) return '';
      const confHtml = aberto || semMov ? vazio : caixasDaLoja.map(cx => { const c = confs.find(x => x.caixa === cx); const rot = cx === 'SALÃO' ? 'Salão' : 'Delivery';
        return c ? `<span style="color:#3f9c5a;" title="${String(c.quem || '').split('@')[0]} · ${String(c.conferido_em || '').slice(0, 16).replace('T', ' ')}">${rot} ✔</span>` : `<span style="color:#9aa4af;">${rot} —</span>`; }).join(' · ');
      const aguardHtml = '<span style="color:#9aa4af;" title="PIX: até 6 dias (fim de semana e feriado atrasam); maquininha: a madrugada do turno chega amanhã">aguardando</span>';
      return `<tr style="${cor} cursor:pointer;" onclick="abrirDiaConcartao('${unidade.replace(/'/g, "\\'")}', '${iso}')" title="clique para abrir as transações do dia e o que cada caixa fechou">
        <td style="padding:3px 6px; white-space:nowrap;">${fmtDia(iso)}</td>
        <td style="padding:3px 6px; white-space:nowrap;">${situacao}</td>
        <td style="padding:3px 6px; white-space:nowrap;">${confHtml}</td>
        <td style="padding:3px 6px; color:#9aa4af; font-size:11px; white-space:nowrap;">abrir ›</td></tr>`;
    }).join('');
    pendTotal += pend; semFechTotal += semFech;

    const corBorda = semFech ? '#ff6b6b' : (pend ? '#f5a623' : '#3f9c5a');
    const resumo = pend
      ? `<b>${pend}</b> dia(s) para conferir${semFech ? ` (<b class="negativo">${semFech}</b> com turno sem fechamento)` : ''} nos últimos ${dias.length} dias.`
      : `Nenhuma pendência nos últimos ${dias.length} dias.`;
    blocos += `
    <div class="section-label">${rotulo}</div>
    <div class="contexto" style="border-color:${corBorda}; text-align:left;">
      <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:baseline; margin-bottom:6px;">
        <div>${resumo}</div>
        <div style="font-size:12px; color:#9aa4af;" title="PDV − maquininha, acumulado desde 19/02; diferença que aparece e some no dia seguinte é horário, a que fica é venda sem par">saldo desde 19/02:
          cartão <b style="color:${corSaldo(saldoC)};">${saldoC === null ? '—' : 'R$ ' + fmt(saldoC)}</b> ·
          vale <b style="color:${corSaldo(saldoV)};">${saldoV === null ? '—' : 'R$ ' + fmt(saldoV)}</b></div>
      </div>
      <div style="overflow-x:auto;"><table style="border-collapse:collapse; width:100%; font-size:12px;">
        ${cabecalho}${linhas || `<tr><td colspan="4" style="padding:8px 6px; color:#9aa4af;">nenhum dia com pendência na janela</td></tr>`}</table></div>
    </div>`;
  }

  alvo.innerHTML = `
    <div class="section-label">Fechamento de Caixas${visao ? ' · ' + (typeof lojaNome === 'function' ? lojaNome(visao) : visao) : ''}</div>
    ${visao === null ? '<div class="contexto" style="border-color:var(--farol-fora);">Sem loja cadastrada para este login — fale com o Neto.</div>' : ''}
    ${(() => { try { return caixaHellenHtml(); } catch (e) { return '<div class="contexto">✗ Não consegui montar a lista "Para você resolver": ' + trEscH(e.message) + '</div>'; } })()}
    ${cofreHtml()}
    <details style="margin-top:14px;"><summary style="cursor:pointer;"><b>Conferência do dia a dia</b> — PDV × maquininha × banco${pendTotal ? ` · ${pendTotal} dia(s) para conferir` : ' · nada pendente'}</summary>
    <div class="contexto" style="text-align:left;">
      O que o PDV registrou × o que de fato chegou, dia a dia. Cada turno fecha o caixa no Saipos sem digitar
      bandeira; a conferência é aqui. ${pendTotal
        ? `<b class="negativo">${pendTotal} dia(s) para conferir</b>${semFechTotal ? `, ${semFechTotal} com turno sem fechamento` : ''}.`
        : '<b style="color:#3f9c5a;">Nenhuma pendência na janela.</b>'}
      <details style="margin-top:6px; font-size:12px; color:#9aa4af;"><summary style="cursor:pointer;">como ler</summary>
        <b>Turno não fechou</b> = o caixa que fez as vendas ainda está aberto no Saipos (o clique no dia diz qual). <b>Dinheiro</b>: venda em dinheiro no PDV × o que a contagem da gaveta registrou como enviado, caixa a caixa
        (Arissa: Água Verde e Ahú · Diego: São Braz); dia sem contagem aparece como "falta contar" — a contagem se registra dentro do dia, na linha <b>Dinheiro</b>. <b>Maquininha</b>: cartão e vale × transações
        da Rede, mais o PIX QR da maquininha × crédito no banco (cai linha a linha, "PIX QRS"). <b>PIX chave</b>: avulso
        na chave CNPJ × transferência no banco. <b>O dia é o turno</b>: das 10h até o fechamento do caixa (corte às 10h), igual ao caixa do
        Saipos. A Rede só entrega as transações no dia seguinte, então a madrugada do turno de ontem aparece como
        "aguardando" e fecha sozinha amanhã; o vale demora dias para aparecer na Rede. Regra do dono: <b>caixa bom não tem quebra</b> — toda diferença aparece e pede investigação.
        Clique no dia para ver as transações lado a lado e o que cada caixa (Salão / Delivery) fechou. Fora daqui:
        pagamento online (iFood/site) e Boqueirão.</details>
      ${filtros}
    </div>
    ${blocos}
    </details>`;
}

