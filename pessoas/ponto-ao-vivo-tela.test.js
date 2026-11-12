/* Ponto ao Vivo — tela (ponto-ao-vivo.js REAL; só rede, DOM e sessão são ficções; nenhum dado de pessoa real).
   node --test pessoas/ponto-ao-vivo-tela.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAV = require('./ponto-ao-vivo.js');

class FEl {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.ev = {}; this.className = ''; this.value = ''; this._t = ''; }
  set textContent(v) { this.children = []; this._t = String(v); }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(v) { throw new Error('innerHTML proibido'); }
  appendChild(c) { this.children.push(c); return c; }
  replaceChildren() { this.children = []; this._t = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(n, f) { this.ev[n] = f; }
}
const todos = (e, f, o = []) => { if (f(e)) o.push(e); e.children.forEach((c) => todos(c, f, o)); return o; };
const resp = (v, status = 200) => ({ status, ok: status < 400, json: async () => v });
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

const HOJE = '2026-11-12', AGORA_UTC = '2026-11-12T21:00:00.000Z';   // 18:00 em Brasília
const T = (hm, dia = HOJE) => dia + 'T' + hm + ':00';
const P = (o) => Object.assign({ id: 1, nome: 'Ana Teste', unidade: 'AGUA VERDE', admissao: '2020-01-01', desligamento: null, flash_id: 'F1', usa_ponto: true, folga_fixa_dow: null }, o);
const B = (o) => Object.assign({ data: HOJE, flash_id: 'F1', entrada: T('08:00'), saida: T('17:00'), n_batidas: 4, lido_em: '2026-11-12T17:50:00-03:00' }, o);

function mk(o = {}) {
  const raiz = new FEl('div'); const log = []; const rpcs = [];
  const est = { loja: 'AGUA VERDE', sess: 'usuario-ficticio' };
  const doc = { createElement: (t) => new FEl(t), getElementById: (id) => (id === 'view-pao' ? raiz : null) };
  const hoje = o.hoje || HOJE;
  const deps = {
    doc, hoje: () => hoje, agora: () => o.agora || AGORA_UTC, visivel: o.visivel || (() => true),
    rpc: async (fn) => { rpcs.push(fn); return resp(true); },
    consultar: async (c) => {
      log.push(c);
      if (o.consultar) { const r = o.consultar(c); if (r !== undefined) { if (r instanceof Error) throw r; return r; } }
      if (c.startsWith('rh_pessoa')) return o.pessoas || [P()];
      if (c.startsWith('rh_flash_batida?select=lido_em')) return o.ultima || [];
      if (c.startsWith('rh_flash_batida')) { const d = /data=eq\.(\d{4}-\d{2}-\d{2})/.exec(c)[1]; return (o.batidas || []).filter((b) => b.data === d); }
      return [];
    },
    lojaCarregar: async () => ({ lojas: ['AGUA VERDE', 'AHU'], travado: false }),
    lojaAtual: () => est.loja, escolherLoja: () => {}, aoMudarLoja: () => {}, sessaoId: () => est.sess,
  };
  if (o.refeicoes) deps.refeicoes = o.refeicoes;
  if (o.direta) deps.leituraDireta = o.direta;
  if (o.diaOperacional) deps.diaOperacional = o.diaOperacional;
  if (o.temporizador) deps.temporizador = o.temporizador;
  const c = PAV.criar(deps);
  return { c, raiz, log, rpcs, deps };
}
const cabecalhos = (raiz) => todos(raiz, (e) => e.tag === 'th').map((e) => e.textContent);
const linhasTab = (raiz) => todos(raiz, (e) => e.tag === 'tr' && e.children.length > 0 && e.children[0].tag === 'td')
  .map((tr) => Object.fromEntries(tr.children.map((td) => [td.attrs['data-rot'], td.textContent])));
const cards = (raiz) => todos(raiz, (e) => e.className === 'pao-card');
const fonteTxt = (raiz) => todos(raiz, (e) => /^pao-fonte/.test(e.className)).map((e) => e.textContent).join('');
const tudo = (raiz) => raiz.textContent;

test('colunas pedidas, só quem tem batida válida; sem batida, desligado e cargo de confiança não aparecem', async () => {
  const pessoas = [P({ id: 1, nome: 'Ana Teste', flash_id: 'F1' }), P({ id: 2, nome: 'Bia SemBatida', flash_id: 'F2' }),
    P({ id: 3, nome: 'Caio Desligado', flash_id: 'F3', desligamento: '2026-11-01' }), P({ id: 5, nome: 'Edu Confianca', flash_id: 'F5', cargo_confianca: true })];
  const t = mk({ pessoas, batidas: [B({ flash_id: 'F1' }), B({ flash_id: 'F3' }), B({ flash_id: 'F5' })] });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'ok');
  assert.deepEqual(cabecalhos(t.raiz), ['Pessoa', 'Loja', 'Situação', 'Entrada', 'Saiu intervalo', 'Voltou intervalo', 'Saída', 'Refeição', 'Batidas', 'Alertas / conferência']);
  const l = linhasTab(t.raiz);
  assert.equal(l.length, 1);
  assert.equal(l[0]['Pessoa'], 'Ana Teste');
  const tx = tudo(t.raiz);
  ['Bia', 'Caio', 'Edu'].forEach((n) => assert.ok(!tx.includes(n), n + ' não pode aparecer'));
  assert.ok(!/Ainda sem batida|sem batida/i.test(tx.replace(/Todos com batida/, '').replace(/Lista só quem tem batida válida/, '')), 'não existe linha, card nem filtro de "sem batida"');
  assert.deepEqual(PAV.FILTROS.map((f) => f[0]), ['TODOS', 'DENTRO', 'INTERVALO', 'JA_SAIU', 'CONFERIR']);
});

test('fonte atual sem detalhe: intervalo diz "sem detalhe", saída é a última batida, refeição diz "fonte indisponível"', async () => {
  const t = mk({ batidas: [B()] });
  await t.c.entrar(); await settle();
  const l = linhasTab(t.raiz)[0];
  assert.equal(l['Entrada'], '08:00');
  assert.equal(l['Saiu intervalo'], 'sem detalhe');
  assert.equal(l['Voltou intervalo'], 'sem detalhe');
  assert.equal(l['Saída'], '17:00');
  assert.equal(l['Refeição'], 'fonte indisponível');
  assert.match(l['Batidas'], /^4/);
  assert.ok(!/não lançou/.test(tudo(t.raiz)), 'sem fonte de refeição nunca se afirma "não lançou"');
  const f = fonteTxt(t.raiz);
  assert.match(f, /rh_flash_batida/); assert.match(f, /não é leitura ao vivo/);
  assert.match(f, /Última leitura do dia: 12\/11 17:50 \(há 10 min\)/);
  assert.match(f, /não traz o horário do intervalo/);
  assert.match(f, /Refeição: fonte ainda não ligada/);
});

test('com horarios[] na fonte: horários exatos nas quatro colunas', async () => {
  const hs = [T('08:00'), T('12:03'), T('13:01'), T('17:00')];
  const t = mk({ batidas: [B({ horarios: hs })] });
  await t.c.entrar(); await settle();
  const l = linhasTab(t.raiz)[0];
  assert.deepEqual([l['Entrada'], l['Saiu intervalo'], l['Voltou intervalo'], l['Saída']], ['08:00', '12:03', '13:01', '17:00']);
  assert.match(fonteTxt(t.raiz), /Horário exato de todas as batidas disponível/);
});

test('refeição só aparece quando uma fonte real é injetada; sem lançamento da pessoa diz "não lançou"', async () => {
  const pessoas = [P({ id: 1, flash_id: 'F1' }), P({ id: 2, nome: 'Bia', flash_id: 'F2' })];
  const t = mk({ pessoas, batidas: [B({ flash_id: 'F1' }), B({ flash_id: 'F2' })], refeicoes: () => ({ disponivel: true, porPessoa: new Map([[1, [{ tipo: 'almoço', quantidade: 1, hora: '12:00' }]]]) }) });
  await t.c.entrar(); await settle();
  const l = linhasTab(t.raiz);
  assert.equal(l.find((x) => x['Pessoa'] === 'Ana Teste')['Refeição'], 'almoço às 12:00');
  assert.equal(l.find((x) => x['Pessoa'] === 'Bia')['Refeição'], 'não lançou');
  assert.ok(!/Refeição: fonte ainda não ligada/.test(fonteTxt(t.raiz)));
});

test('dia sem leitura: aviso claro de fonte, nenhum card com zero, nenhuma tabela', async () => {
  const t = mk({ batidas: [], ultima: [{ lido_em: '2026-11-12T03:10:00+00:00' }] });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'ok');
  assert.equal(cards(t.raiz).length, 0, 'zero seria falso: "0 na loja" não é "ninguém na loja"');
  assert.equal(linhasTab(t.raiz).length, 0);
  assert.match(fonteTxt(t.raiz), /SEM LEITURA DO DIA/);
  assert.match(fonteTxt(t.raiz), /Última leitura da tabela: 12\/11 00:10/);
  assert.match(fonteTxt(t.raiz), /Isto não significa que ninguém bateu/);
  assert.match(tudo(t.raiz), /Sem leitura do dia: não há como listar quem bateu/);
});

test('dia com leitura: os cards contam só quem está na lista', async () => {
  const pessoas = [P({ id: 1, flash_id: 'F1' }), P({ id: 2, nome: 'Bia', flash_id: 'F2' }), P({ id: 3, nome: 'Caio', flash_id: 'F3' })];
  const t = mk({ pessoas, batidas: [B({ flash_id: 'F1' }), B({ flash_id: 'F2', n_batidas: 1, saida: null })] });
  await t.c.entrar(); await settle();
  const c = Object.fromEntries(cards(t.raiz).map((x) => [x.children[1].textContent, x.children[0].textContent]));
  assert.equal(c['Dentro da loja'], '1'); assert.equal(c['Já saiu'], '1'); assert.equal(c['No intervalo'], '0');
  assert.ok(!('Ainda sem batida' in c));
});

test('cargo_confianca: pede a coluna; se o servidor recusar, volta ao mínimo e AVISA que o filtro de cargo não foi aplicado', async () => {
  const t = mk({
    batidas: [B()],
    consultar: (c) => (c.startsWith('rh_pessoa') && c.includes('cargo_confianca') ? Object.assign(new Error('{"code":"42703","message":"column rh_pessoa.cargo_confianca does not exist"}'), { status: 400 }) : undefined),
  });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'ok');
  assert.ok(t.log.includes(PAV.PESSOAS_PATH_COM_CONFIANCA)); assert.ok(t.log.includes(PAV.PESSOAS_PATH));
  assert.match(tudo(t.raiz), /o cadastro lido não traz esse campo; o filtro por cargo NÃO foi aplicado/);
  assert.equal(linhasTab(t.raiz).length, 1);
});

test('outro erro 400 em rh_pessoa não é engolido: a tela diz que não consultou', async () => {
  const t = mk({ batidas: [B()], consultar: (c) => (c.startsWith('rh_pessoa') ? Object.assign(new Error('{"code":"42501","message":"permission denied"}'), { status: 400 }) : undefined) });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'erro'); assert.equal(linhasTab(t.raiz).length, 0);
});

test('falha na leitura de batidas: erro explícito, sem tabela e sem card', async () => {
  const t = mk({ consultar: (c) => (/data=eq\./.test(c) ? new Error('rede') : undefined) });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'erro'); assert.equal(cards(t.raiz).length, 0); assert.equal(linhasTab(t.raiz).length, 0);
  assert.match(tudo(t.raiz), /Não foi possível consultar agora/);
});

test('madrugada: lê o dia anterior só antes das 06:00 e lista turno aberto de ontem com a marca da data', async () => {
  const ontem = '2026-11-12', hoje = '2026-11-13';
  const aberto = B({ data: ontem, entrada: T('18:00', ontem), saida: null, n_batidas: 1 });
  const t = mk({ hoje, agora: '2026-11-13T04:30:00.000Z', batidas: [aberto] });   // 01:30 em Brasília
  await t.c.entrar(); await settle();
  assert.ok(t.log.some((c) => c.includes('data=eq.' + ontem)), 'pede o dia anterior');
  const l = linhasTab(t.raiz);
  assert.equal(l.length, 1); assert.equal(l[0]['Pessoa'], 'Ana Teste (turno de 12/11)');
  const tarde = mk({ hoje, agora: '2026-11-13T09:30:00.000Z', batidas: [aberto] });   // 06:30 em Brasília
  await tarde.c.entrar(); await settle();
  assert.ok(!tarde.log.some((c) => c.includes('data=eq.' + ontem)), 'depois das 06:00 não pede o dia anterior');
  assert.equal(linhasTab(tarde.raiz).length, 0);
});

test('madrugada com a leitura de ontem indisponível: a tela diz que não conferiu', async () => {
  const hoje = '2026-11-13', ontem = '2026-11-12';
  const t = mk({ hoje, agora: '2026-11-13T04:30:00.000Z', batidas: [], consultar: (c) => (c.includes('data=eq.' + ontem) ? new Error('rede') : undefined) });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'ok');
  assert.match(fonteTxt(t.raiz), /Madrugada: leitura de ontem indisponível/);
});

test('somente leitura: só as 4 tabelas permitidas, só as 2 guardas, nada de refeição/Saipos/robô', async () => {
  const t = mk({ batidas: [B()] });
  await t.c.entrar(); await settle();
  assert.ok(t.log.length > 0);
  assert.ok(t.log.every((c) => /^rh_(pessoa|flash_batida|flash_ausencia|ocorrencia)\?/.test(c)), t.log.join('\n'));
  assert.deepEqual([...new Set(t.rpcs)].sort(), ['pode_cadastrar_pessoal', 'pode_ver_pessoal']);
});

test('guarda recusada não lê tabela nenhuma', async () => {
  const t = mk({}); t.deps.rpc = async () => resp(false);
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'semacesso'); assert.equal(t.log.length, 0);
});

// ---------- modo DIRETO (Edge Function fabio-ponto-leitura) ----------
const HS4 = [T('08:00'), T('12:03'), T('13:01'), T('17:00')];
const RESP = (o = {}) => Object.assign({
  fonte: 'Flash — leitura direta', dia: HOJE, unidade: 'AGUA VERDE', consultadoEm: AGORA_UTC, lidoEm: AGORA_UTC,
  pessoas: [P({ id: 1, nome: 'Ana Teste', flash_id: 'F1' }), P({ id: 2, nome: 'Bia Sem', flash_id: 'F2' }), P({ id: 3, nome: 'Caio Novo', flash_id: 'F3' })],
  batidas: [B({ flash_id: 'F1', horarios: HS4 }), B({ flash_id: 'F3', n_batidas: 1, saida: null, horarios: [T('09:00')], entrada: T('09:00') })],
  batidasAnterior: [], anterior: { pedido: false, ok: false },
  refeicoes: { disponivel: true, porPessoa: { 1: [{ tipo: 'almoço', produto: 'prato', quantidade: 1, hora: '12:10' }] }, identificados: [1] },
  refeicoesAnterior: { disponivel: false, porPessoa: {}, identificados: [] }, avisos: ['1 item(ns) de refeição sem dono identificado (não atribuídos a ninguém).'],
}, o);
const soAuxiliares = (log) => log.every((c) => /^rh_(flash_ausencia|ocorrencia)\?/.test(c));

test('direto: horários exatos, refeição por pessoa, "sem vínculo" não vira "não lançou"; lê só ausência/ocorrência além da função', async () => {
  const t = mk({ direta: async (p) => { assert.equal(p.dia, HOJE); assert.equal(p.unidade, 'AGUA VERDE'); return RESP(); } });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'ok');
  const l = linhasTab(t.raiz); assert.equal(l.length, 2);
  const ana = l.find((x) => x['Pessoa'] === 'Ana Teste'), caio = l.find((x) => x['Pessoa'] === 'Caio Novo');
  assert.deepEqual([ana['Entrada'], ana['Saiu intervalo'], ana['Voltou intervalo'], ana['Saída']], ['08:00', '12:03', '13:01', '17:00']);
  assert.equal(ana['Refeição'], 'almoço prato às 12:10');
  assert.equal(caio['Refeição'], 'sem vínculo de refeição'); assert.deepEqual([caio['Entrada'], caio['Saiu intervalo'], caio['Saída']], ['09:00', '—', '—']);
  assert.ok(!/Bia Sem/.test(tudo(t.raiz)), 'sem batida não aparece');
  const f = fonteTxt(t.raiz);
  assert.match(f, /Fonte: Flash — leitura direta/); assert.ok(!/rh_flash_batida|lotes/.test(f)); assert.match(f, /Horário exato de todas as batidas disponível/);
  assert.match(tudo(t.raiz), /1 item\(ns\) de refeição sem dono/);
  assert.ok(t.log.length > 0 && soAuxiliares(t.log), t.log.join('\n'));
});
test('direto, ninguém bateu: leitura bem-sucedida com lista vazia é "ninguém", não "sem leitura"', async () => {
  const t = mk({ direta: async () => RESP({ batidas: [] }) });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'ok');
  assert.ok(!/SEM LEITURA/.test(fonteTxt(t.raiz))); assert.match(fonteTxt(t.raiz), /Nenhuma batida lida neste dia \(leitura bem-sucedida/);
  assert.equal(cards(t.raiz).length, 5); assert.match(tudo(t.raiz), /Nenhuma pessoa com batida válida/);
});
test('direto, refeição indisponível: coluna diz "fonte indisponível" e a fonte avisa', async () => {
  const t = mk({ direta: async () => RESP({ refeicoes: { disponivel: false, porPessoa: {}, identificados: [] } }) });
  await t.c.entrar(); await settle();
  assert.ok(linhasTab(t.raiz).every((x) => x['Refeição'] === 'fonte indisponível')); assert.match(fonteTxt(t.raiz), /Refeição: leitura indisponível agora/);
});
test('direto, falha da leitura: erro explícito, NENHUM fallback para a tabela em lote nem para o cadastro', async () => {
  const t = mk({ batidas: [B()], direta: async () => { throw Object.assign(new Error('HTTP 502'), { status: 502 }); } });
  await t.c.entrar(); await settle();
  assert.equal(t.c.st.fase, 'erro'); assert.equal(linhasTab(t.raiz).length, 0); assert.equal(cards(t.raiz).length, 0);
  assert.match(tudo(t.raiz), /nenhuma outra fonte foi usada no lugar/);
  assert.ok(!t.log.some((c) => /^rh_(pessoa|flash_batida)/.test(c)));
  const s = mk({ direta: async () => { throw Object.assign(new Error('401'), { status: 401 }); } }); await s.c.entrar(); await settle(); assert.equal(s.c.st.fase, 'sessao');
});
test('direto, resposta fora do contrato ou de outro dia: nada exibido', async () => {
  for (const r of [{}, null, RESP({ dia: '2026-11-11' }), RESP({ batidas: 'x' }), RESP({ consultadoEm: 'ontem' }), RESP({ refeicoes: null }), RESP({ anterior: null })]) {
    const t = mk({ direta: async () => r }); await t.c.entrar(); await settle();
    assert.equal(t.c.st.fase, 'dadosinvalidos'); assert.equal(linhasTab(t.raiz).length, 0);
  }
});
test('direto, dia operacional: às 01:30 de 13/11 a tela abre 12/11 e mostra o turno aberto com a refeição desse dia (sem pedir outro dia)', async () => {
  const op = '2026-11-12', agora = '2026-11-13T04:30:00.000Z';   // 01:30 em Brasília
  let pedido = null;
  const t = mk({ hoje: '2026-11-13', agora, diaOperacional: () => op, direta: async (p) => { pedido = p; return RESP({
    dia: op, consultadoEm: agora, lidoEm: agora, pessoas: [P({ id: 1, flash_id: 'F1' })],
    batidas: [B({ data: op, flash_id: 'F1', entrada: T('18:00', op), saida: null, n_batidas: 1, horarios: [T('18:00', op)] })],
    refeicoes: { disponivel: true, porPessoa: { 1: [{ tipo: 'jantar', produto: 'prato', quantidade: 1, hora: '19:30' }] }, identificados: [1] }, avisos: [] }); } });
  await t.c.entrar(); await settle();
  assert.equal(pedido.dia, op);
  const l = linhasTab(t.raiz); assert.equal(l.length, 1);
  assert.equal(l[0]['Pessoa'], 'Ana Teste'); assert.equal(l[0]['Refeição'], 'jantar prato às 19:30'); assert.equal(l[0]['Entrada'], '18:00'); assert.match(l[0]['Situação'], /Dentro da loja/);
  assert.ok(!/Madrugada/.test(fonteTxt(t.raiz)));
});
test('direto, dia operacional: segue atualizando de madrugada e acompanha a virada das 07:00 se a pessoa não escolheu outra data', async () => {
  let op = '2026-11-12', cb = null, pedidos = [];
  const t = mk({ diaOperacional: () => op, temporizador: (fn) => { cb = fn; return () => { cb = null; }; }, direta: async (p) => { pedidos.push(p.dia); return RESP({ dia: p.dia }); } });
  await t.c.entrar(); await settle();
  assert.ok(cb, 'timer ligado no dia operacional'); cb(); await settle(); assert.deepEqual(pedidos, ['2026-11-12', '2026-11-12']);
  op = '2026-11-13'; cb(); await settle(); assert.equal(pedidos[2], '2026-11-13'); assert.equal(t.c.st.dia, '2026-11-13');
});
test('direto: data escolhida à mão não é arrastada para o novo dia operacional', async () => {
  let op = '2026-11-12', cb = null;
  const t = mk({ diaOperacional: () => op, temporizador: (fn) => { cb = fn; return () => { cb = null; }; }, direta: async (p) => RESP({ dia: p.dia }) });
  await t.c.entrar(); await settle();
  const sel = todos(t.raiz, (e) => e.tag === 'input')[0]; sel.value = '2026-11-12'; sel.ev.change(); await settle();
  op = '2026-11-13'; if (cb) cb(); await settle();
  assert.equal(t.c.st.dia, '2026-11-12'); assert.equal(cb, null, 'dia escolhido que não é mais o operacional: sem atualização automática');
});
test('sair cancela a requisição em andamento e não deixa timer; fora de vista não agenda timer', async () => {
  let sinal = null, agendados = 0, cancelados = 0;
  const t = mk({ temporizador: () => { agendados++; return () => { cancelados++; }; }, direta: ({ signal }) => { sinal = signal; return new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abort')))); } });
  const p = t.c.entrar(); await settle();
  assert.ok(sinal && !sinal.aborted); assert.equal(agendados, 1);
  t.c.sair(); await p;
  assert.equal(sinal.aborted, true); assert.equal(cancelados, 1); assert.equal(t.c.st.cancelar, null);
  assert.notEqual(t.c.st.fase, 'erro', 'cancelar não vira erro na tela');
  let ag2 = 0; const oculto = mk({ visivel: () => false, temporizador: () => { ag2++; return () => {}; }, direta: async () => RESP() });
  await oculto.c.entrar(); await settle(); assert.equal(ag2, 0);
});
test('direto: guarda recusada não chama a função', async () => {
  let chamou = 0; const t = mk({ direta: async () => { chamou++; return RESP(); } }); t.deps.rpc = async () => resp(false);
  await t.c.entrar(); await settle(); assert.equal(chamou, 0); assert.equal(t.c.st.fase, 'semacesso');
});

test('código executável: sem innerHTML, sem armazenamento, sem escrita, sem fonte inventada', () => {
  const lim = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  for (const f of ['ponto-ao-vivo.js', 'ponto-ao-vivo-modelo.js']) {
    const src = lim(f);
    const fetches = src.match(/\bfetch\s*\(/g) || [];
    if (f === 'ponto-ao-vivo.js') {   // único acesso de rede próprio da tela: GET na Edge Function (JWT da sessão); nada mais
      assert.equal(fetches.length, 1); assert.match(src, /fetch\(SUPABASE_URL \+ '\/functions\/v1\/fabio-ponto-leitura\?/); assert.match(src, /method: 'GET'/);
    } else assert.equal(fetches.length, 0);
    for (const re of [/innerHTML|insertAdjacentHTML|outerHTML/, /localStorage|sessionStorage/, /service_role/, /method:\s*['"](POST|PATCH|PUT|DELETE)/i, /x-flash-auth|api\.flashapp|fabio_ponto_flash|vault\./,
      /select=\*/, /ponto_ao_vivo['"]|refeicao_lancada|func_cartao|func_apelido|vendas_saipos|saipos_itens_venda|vw_descontos|rh_flash_leitura/])
      assert.ok(!re.test(src), f + ' ' + String(re));
  }
});

