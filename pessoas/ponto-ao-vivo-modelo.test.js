/* Ponto ao Vivo — modelo puro: filtro da lista, 1/2/3/4 batidas, virada da madrugada, indisponibilidade de fonte.
   node --test pessoas/ponto-ao-vivo-modelo.test.js   (módulo REAL; sem rede/DOM; nenhum dado de pessoa real) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PAV = require('./ponto-ao-vivo-modelo.js');

const DIA = '2026-11-12';
const AGORA = '2026-11-12T18:00:00-03:00';      // quinta 18:00 em Brasília
const LIDO = '2026-11-12T17:50:00-03:00';       // 10 min antes: leitura fresca
const T = (hm, dia = DIA) => dia + 'T' + hm + ':00';
const P = (o) => Object.assign({ id: 1, nome: 'Ana Teste', unidade: 'AGUA VERDE', admissao: '2020-01-01', desligamento: null, flash_id: 'F1', usa_ponto: true, folga_fixa_dow: null }, o);
const B = (o) => Object.assign({ data: DIA, flash_id: 'F1', entrada: T('08:00'), saida: null, n_batidas: 1, lido_em: LIDO }, o);
const run = (o) => PAV.cruzar(Object.assign({ pessoas: [P()], batidas: [], dia: DIA, consultadoEm: AGORA, loja: 'AGUA VERDE', redeOk: false, fontes: { ausencias: true, ocorrencias: true } }, o));
const uma = (b, extra) => { const r = run(Object.assign({ batidas: [b] }, extra || {})); return { r, l: r.linhas[0] }; };
const vals = (l) => ['entrada', 'saiuIntervalo', 'voltouIntervalo', 'saida'].map((k) => l.celulas[k].estado + ':' + (l.celulas[k].v === null ? '-' : l.celulas[k].v));

// ---------- filtro: só batida válida + vínculo ativo ----------
test('lista só quem tem batida válida e vínculo ativo: sem batida, folga, desligado, não usa ponto, cargo de confiança e inválidos ficam fora', () => {
  const pessoas = [
    P({ id: 1, nome: 'Ana Ok', flash_id: 'F1' }),
    P({ id: 2, nome: 'Bia SemBatida', flash_id: 'F2' }),
    P({ id: 3, nome: 'Caio Desligado', flash_id: 'F3', desligamento: '2026-11-01' }),
    P({ id: 4, nome: 'Duda SemPonto', flash_id: 'F4', usa_ponto: false }),
    P({ id: 5, nome: 'Edu Confianca', flash_id: 'F5', cargo_confianca: true }),
    P({ id: 6, nome: 'Fabi Futura', flash_id: 'F6', admissao: '2026-12-01' }),
    P({ id: 7, nome: 'Gil Invalido', flash_id: 'F7' }),
    P({ id: 8, nome: 'Hana Folga', flash_id: 'F8', folga_fixa_dow: 4 }),
  ];
  const batidas = [
    B({ flash_id: 'F1' }), B({ flash_id: 'F3' }), B({ flash_id: 'F4' }), B({ flash_id: 'F5' }), B({ flash_id: 'F6' }),
    B({ flash_id: 'F7', n_batidas: 2, saida: null }),   // contagem 2 sem saída: dado incoerente
  ];
  const r = run({ pessoas, batidas, dowConvencao: 'DOM0' });
  assert.deepEqual(r.listadas.map((l) => l.nome), ['Ana Ok']);
  assert.equal(r.linhas.length, 8, 'o cadastro da loja continua inteiro em linhas (para contagem), mas só listadas viram tela');
  const sit = (nome) => r.linhas.find((l) => l.nome === nome).situacao;
  assert.equal(sit('Bia SemBatida'), 'SEM_BATIDA');
  assert.equal(sit('Hana Folga'), 'SEM_BATIDA');
  assert.equal(sit('Caio Desligado'), 'FORA_DO_VINCULO');
  assert.equal(sit('Duda SemPonto'), 'NAO_USA_PONTO');
  assert.equal(sit('Edu Confianca'), 'CARGO_CONFIANCA');
  assert.equal(sit('Fabi Futura'), 'FORA_DO_VINCULO');
  assert.equal(sit('Gil Invalido'), 'CONFERIR');
  assert.equal(r.resumo.ocultosVinculo, 4);
  assert.equal(r.resumo.ocultosConferir, 1);
  assert.ok(r.avisos.some((a) => /NÃO foram listados/.test(a)), 'o que foi escondido por dado ruim é contado nos avisos, não some em silêncio');
  assert.equal(r.avaliacao.cargoConfianca, true);
});

test('cadastro sem o campo cargo_confianca: o filtro por cargo NÃO é aplicado e a avaliação diz isso', () => {
  const r = run({ batidas: [B()] });
  assert.equal(r.avaliacao.cargoConfianca, false);
  assert.equal(r.listadas.length, 1);
});

test('desligamento no próprio dia ainda é vínculo ativo; um dia depois, não', () => {
  assert.equal(run({ pessoas: [P({ desligamento: DIA })], batidas: [B()] }).listadas.length, 1);
  assert.equal(run({ pessoas: [P({ desligamento: '2026-11-11' })], batidas: [B()] }).listadas.length, 0);
});

test('quem já saiu continua na lista, com a saída aparecendo', () => {
  const { r, l } = uma(B({ n_batidas: 4, saida: T('17:00'), horarios: [T('08:00'), T('12:00'), T('13:00'), T('17:00')] }));
  assert.equal(r.listadas.length, 1);
  assert.equal(l.situacao, 'JA_SAIU');
  assert.deepEqual(vals(l), ['exato:08:00', 'exato:12:00', 'exato:13:00', 'exato:17:00']);
});

test('outra loja não entra; REDE só com permissão', () => {
  const pessoas = [P({ id: 1, unidade: 'AGUA VERDE' }), P({ id: 2, flash_id: 'F2', unidade: 'AHU', nome: 'Outra' })];
  const batidas = [B(), B({ flash_id: 'F2' })];
  assert.deepEqual(run({ pessoas, batidas }).listadas.map((l) => l.nome), ['Ana Teste']);
  assert.equal(run({ pessoas, batidas, loja: 'REDE', redeOk: false }).listadas.length, 0);
  assert.equal(run({ pessoas, batidas, loja: 'REDE', redeOk: true }).listadas.length, 2);
});

// ---------- 1 / 2 / 3 / 4 batidas ----------
test('1 batida: dentro; só entrada é horário; intervalo e saída "não ocorreram"', () => {
  const { l } = uma(B());
  assert.equal(l.situacao, 'DENTRO'); assert.equal(l.listar, true);
  assert.deepEqual(vals(l), ['exato:08:00', 'nao:-', 'nao:-', 'nao:-']);
});

test('2 batidas hoje sem escala: a 2ª é AMBÍGUA (saída ou intervalo); nenhum intervalo é inventado', () => {
  const { l } = uma(B({ n_batidas: 2, saida: T('12:00') }));
  assert.equal(l.situacao, 'SAIU_OU_INTERVALO');
  assert.deepEqual(vals(l), ['exato:08:00', 'ambigua:-', 'nao:-', 'ambigua:12:00']);
  assert.equal(l.celulas.saiuIntervalo.v, null);
});

test('2 batidas hoje com escala que prevê intervalo: saiu para o intervalo (horário exato), saída vazia', () => {
  const { l } = uma(B({ n_batidas: 2, saida: T('12:00') }), { escalaDia: { 1: { temIntervalo: true } } });
  assert.equal(l.situacao, 'INTERVALO');
  assert.deepEqual(vals(l), ['exato:08:00', 'exato:12:00', 'nao:-', 'nao:-']);
});

test('2 batidas hoje com escala sem intervalo, ou dia já encerrado: é saída', () => {
  assert.deepEqual(vals(uma(B({ n_batidas: 2, saida: T('12:00') }), { escalaDia: { 1: { temIntervalo: false } } }).l), ['exato:08:00', 'nao:-', 'nao:-', 'exato:12:00']);
  const ontem = '2026-11-11';
  const l = uma(B({ data: ontem, entrada: T('08:00', ontem), saida: T('17:00', ontem), n_batidas: 2 }), { dia: ontem }).l;
  assert.equal(l.situacao, 'JA_SAIU');
  assert.deepEqual(vals(l), ['exato:08:00', 'nao:-', 'nao:-', 'exato:17:00']);
});

test('3 batidas SEM detalhe (realidade do ERP): intervalo é "sem detalhe", nunca um horário deduzido dos extremos', () => {
  const { l } = uma(B({ n_batidas: 3, saida: T('13:10') }));
  assert.equal(l.situacao, 'DENTRO');
  assert.deepEqual(vals(l), ['exato:08:00', 'sem_detalhe:-', 'sem_detalhe:-', 'nao:-']);
  assert.deepEqual(l.ultimaBatida, { v: '13:10', mais1: false }, 'a última batida é exata e fica visível, mas não vira "voltou do intervalo"');
  assert.equal(l.todasBatidas, null);
});

test('3 batidas COM detalhe: horários exatos nas colunas certas', () => {
  const { l } = uma(B({ n_batidas: 3, saida: T('13:10'), horarios: [T('08:00'), T('12:00'), T('13:10')] }));
  assert.deepEqual(vals(l), ['exato:08:00', 'exato:12:00', 'exato:13:10', 'nao:-']);
  assert.equal(l.todasBatidas.length, 3);
});

test('4 batidas SEM detalhe: saída é a última batida (exata), intervalo "sem detalhe"', () => {
  const { l } = uma(B({ n_batidas: 4, saida: T('17:00') }));
  assert.equal(l.situacao, 'JA_SAIU');
  assert.deepEqual(vals(l), ['exato:08:00', 'sem_detalhe:-', 'sem_detalhe:-', 'exato:17:00']);
});

test('4 batidas COM detalhe: os quatro horários exatos', () => {
  const { l } = uma(B({ n_batidas: 4, saida: T('17:00'), horarios: [T('08:00'), T('12:05'), T('13:02'), T('17:00')] }));
  assert.deepEqual(vals(l), ['exato:08:00', 'exato:12:05', 'exato:13:02', 'exato:17:00']);
});

test('5 batidas com detalhe: sem coluna certa para todas — células ambíguas e todas as batidas listadas', () => {
  const { l } = uma(B({ n_batidas: 5, entrada: T('07:00'), saida: T('14:30'), horarios: [T('07:00'), T('10:00'), T('10:15'), T('14:00'), T('14:30')] }));
  assert.equal(l.situacao, 'DENTRO');
  assert.deepEqual(vals(l), ['exato:07:00', 'ambigua:-', 'ambigua:-', 'nao:-']);
  assert.deepEqual(l.todasBatidas.map((b) => b.v), ['07:00', '10:00', '10:15', '14:00', '14:30']);
});

test('nunca existe horário de intervalo sem horarios[] (propriedade geral, 1 a 8 batidas)', () => {
  for (let n = 1; n <= 8; n++) {
    const saida = n >= 2 ? T('18:00') : null;
    const l = uma(B({ n_batidas: n, saida })).l;
    if (!l.listar) continue;
    ['saiuIntervalo', 'voltouIntervalo'].forEach((k) => assert.equal(l.celulas[k].v, null, n + ' batidas, ' + k + ' sem detalhe não pode ter horário'));
  }
});

test('dia encerrado com número ímpar: lista, marca incompleto e alerta CONFERIR (nunca falta)', () => {
  const ontem = '2026-11-11';
  const l = uma(B({ data: ontem, entrada: T('08:00', ontem), saida: T('13:00', ontem), n_batidas: 3 }), { dia: ontem }).l;
  assert.equal(l.situacao, 'INCOMPLETO'); assert.equal(l.listar, true);
  assert.ok(l.alertas.some((a) => a.codigo === 'BATIDAS_IMPARES'));
  assert.ok(l.alertas.every((a) => !/falta|atras/i.test(a.texto.replace(/batida faltante/, ''))), 'texto nunca fala em falta/atraso');
});

// ---------- virada da madrugada ----------
test('turno que atravessa a meia-noite (dia encerrado): saída no dia seguinte aparece com +1 dia', () => {
  const ontem = '2026-11-11';
  const { l } = uma(B({ data: ontem, entrada: T('18:00', ontem), saida: T('02:10', DIA), n_batidas: 2 }), { dia: ontem });
  assert.equal(l.situacao, 'JA_SAIU'); assert.equal(l.listar, true);
  assert.deepEqual(l.celulas.saida, { estado: 'exato', v: '02:10', mais1: true });
  assert.equal(l.celulas.entrada.mais1, false);
});

test('virada com horarios[]: 4 batidas atravessando a meia-noite, ordem cronológica exata', () => {
  const ontem = '2026-11-11';
  const hs = [T('18:00', ontem), T('21:00', ontem), T('21:30', ontem), T('02:00', DIA)];
  const { l } = uma(B({ data: ontem, entrada: hs[0], saida: hs[3], n_batidas: 4, horarios: hs }), { dia: ontem });
  assert.equal(l.listar, true);
  assert.deepEqual(vals(l), ['exato:18:00', 'exato:21:00', 'exato:21:30', 'exato:02:00']);
  assert.equal(l.celulas.saida.mais1, true);
});

test('saída antes da entrada no mesmo dia, ou dois dias depois: dado ruim, fora da lista (CONFERIR)', () => {
  const ontem = '2026-11-11';
  const antes = uma(B({ data: ontem, entrada: T('18:00', ontem), saida: T('02:10', ontem), n_batidas: 2 }), { dia: ontem });
  assert.equal(antes.l.situacao, 'CONFERIR'); assert.equal(antes.l.listar, false);
  const longe = uma(B({ data: ontem, entrada: T('18:00', ontem), saida: T('02:10', '2026-11-13'), n_batidas: 2 }), { dia: ontem });
  assert.equal(longe.l.situacao, 'CONFERIR'); assert.equal(longe.l.listar, false);
});

test('horarios[] fora de ordem, com contagem diferente ou em outro dia: nada é atribuído e a pessoa não é listada', () => {
  const ruins = [
    { n_batidas: 3, saida: T('13:00'), horarios: [T('08:00'), T('13:00'), T('12:00')] },
    { n_batidas: 3, saida: T('13:00'), horarios: [T('08:00'), T('13:00')] },
    { n_batidas: 2, saida: T('13:00', '2026-11-14'), horarios: [T('08:00'), T('13:00', '2026-11-14')] },
  ];
  ruins.forEach((x) => { const { l } = uma(B(x)); assert.equal(l.situacao, 'CONFERIR'); assert.equal(l.listar, false); });
});

test('madrugada de hoje: turno de ontem sem saída aparece como CONFERIR com marca de ontem', () => {
  const agora = '2026-11-13T01:30:00-03:00', ontem = '2026-11-12';
  const r = run({
    dia: '2026-11-13', consultadoEm: agora, batidas: [], fontes: { ausencias: true, ocorrencias: true, anterior: true },
    batidasAnterior: [B({ data: ontem, entrada: T('18:00', ontem), n_batidas: 1 })], ultimaLeituraGeral: '2026-11-13T03:10:00+00:00',
  });
  assert.equal(r.listadas.length, 1);
  const l = r.listadas[0];
  assert.equal(l.virada, true); assert.equal(l.diaOrigem, ontem); assert.equal(l.situacao, 'DENTRO');
  assert.ok(l.alertas.some((a) => a.codigo === 'TURNO_DE_ONTEM'));
  assert.ok(!l.alertas.some((a) => a.codigo === 'LEITURA_ANTIGA'));
  assert.equal(l.refeicao.estado, 'indisponivel', 'refeição de hoje não vale para o turno de ontem');
  assert.equal(r.fonte.virada, 'conferida');
});

test('madrugada sem a leitura de ontem: não inventa turno aberto e avisa que não pôde conferir', () => {
  const r = run({ dia: '2026-11-13', consultadoEm: '2026-11-13T01:30:00-03:00', batidas: [], fontes: { ausencias: true, ocorrencias: true, anterior: false } });
  assert.equal(r.listadas.length, 0);
  assert.equal(r.fonte.virada, 'indisponivel');
  assert.ok(r.avisos.some((a) => /Madrugada/.test(a)));
});

test('depois das 06:00 ou com turno de ontem já encerrado ou com batida de hoje: não há linha de virada', () => {
  const ontem = '2026-11-12', fontes = { ausencias: true, ocorrencias: true, anterior: true };
  const aberto = [B({ data: ontem, entrada: T('18:00', ontem), n_batidas: 1 })];
  const tarde = run({ dia: '2026-11-13', consultadoEm: '2026-11-13T06:30:00-03:00', batidas: [], fontes, batidasAnterior: aberto });
  assert.equal(tarde.listadas.length, 0); assert.equal(tarde.fonte.virada, 'nao_aplica');
  const fechado = [B({ data: ontem, entrada: T('18:00', ontem), saida: T('22:00', ontem), n_batidas: 4, horarios: [T('18:00', ontem), T('19:00', ontem), T('19:30', ontem), T('22:00', ontem)] })];
  assert.equal(run({ dia: '2026-11-13', consultadoEm: '2026-11-13T01:30:00-03:00', batidas: [], fontes, batidasAnterior: fechado }).listadas.length, 0);
  const hoje = run({ dia: '2026-11-13', consultadoEm: '2026-11-13T01:30:00-03:00', fontes, batidasAnterior: aberto, batidas: [B({ data: '2026-11-13', entrada: T('00:30', '2026-11-13'), n_batidas: 1 })] });
  assert.equal(hoje.listadas.length, 1); assert.equal(hoje.listadas[0].virada, false);
});

// ---------- indisponibilidade de fonte (nunca zero falso) ----------
test('dia sem nenhuma leitura: fonte diz SEM leitura, lista vazia, aviso explícito — não vira "ninguém bateu"', () => {
  const r = run({ batidas: [] });
  assert.equal(r.fonte.semLeituraDoDia, true); assert.equal(r.fonte.linhasDoDia, 0);
  assert.equal(r.fonte.ultimaLeituraRotulo, null); assert.equal(r.fonte.fresca, false);
  assert.equal(r.listadas.length, 0);
  assert.ok(r.avisos.some((a) => /Nenhuma leitura datada/.test(a)));
  assert.equal(r.linhas[0].situacao, 'CONFERIR', 'sem leitura recente não se afirma "ainda sem batida"');
});

test('dia sem leitura mas com a última leitura da tabela conhecida: mostra quando foi e a idade', () => {
  const r = run({ batidas: [], ultimaLeituraGeral: '2026-11-12T03:10:00-03:00' });
  assert.equal(r.fonte.ultimaLeituraRotulo, '12/11 03:10'); assert.equal(r.fonte.escopoLeitura, 'geral');
  assert.equal(r.fonte.idadeLeituraMin, 890); assert.equal(r.fonte.fresca, false);
});

test('com leitura do dia: frescor vem do maior lido_em; leitura velha vira aviso e alerta, nunca situação nova', () => {
  const fresca = run({ batidas: [B()] });
  assert.equal(fresca.fonte.ultimaLeituraRotulo, '12/11 17:50'); assert.equal(fresca.fonte.idadeLeituraMin, 10); assert.equal(fresca.fonte.fresca, true);
  const velha = run({ batidas: [B({ lido_em: '2026-11-12T15:00:00-03:00' })] });
  assert.equal(velha.fonte.fresca, false); assert.equal(velha.fonte.idadeLeituraMin, 180);
  assert.ok(velha.avisos.some((a) => /defasadas/.test(a)));
  assert.ok(velha.listadas[0].alertas.some((a) => a.codigo === 'LEITURA_ANTIGA'));
});

test('detalhe da fonte: nenhum / parcial / completo, contado só entre as pessoas listadas', () => {
  const pessoas = [P({ id: 1, flash_id: 'F1' }), P({ id: 2, flash_id: 'F2', nome: 'Bia' })];
  const semDet = B({ flash_id: 'F1', n_batidas: 4, saida: T('17:00') });
  const comDet = B({ flash_id: 'F2', n_batidas: 4, saida: T('17:00'), horarios: [T('08:00'), T('12:00'), T('13:00'), T('17:00')] });
  assert.equal(run({ pessoas, batidas: [semDet, Object.assign({}, semDet, { flash_id: 'F2' })] }).fonte.detalhe, 'nenhum');
  const parcial = run({ pessoas, batidas: [semDet, comDet] }).fonte;
  assert.equal(parcial.detalhe, 'parcial'); assert.equal(parcial.comDetalhe, 1); assert.equal(parcial.semDetalhe, 1);
  assert.equal(run({ pessoas, batidas: [Object.assign({}, comDet, { flash_id: 'F1' }), comDet] }).fonte.detalhe, 'completo');
  assert.equal(run({ batidas: [] }).fonte.detalhe, 'sem_linhas');
});

test('refeição: sem fonte é "indisponivel" (nunca "não lançou"); com fonte, por pessoa', () => {
  const pessoas = [P({ id: 1, flash_id: 'F1' }), P({ id: 2, flash_id: 'F2', nome: 'Bia' })];
  const batidas = [B({ flash_id: 'F1' }), B({ flash_id: 'F2' })];
  const sem = run({ pessoas, batidas });
  assert.ok(sem.listadas.every((l) => l.refeicao.estado === 'indisponivel')); assert.equal(sem.fonte.refeicao, 'indisponivel');
  ['x', { disponivel: false, porPessoa: new Map() }, { porPessoa: new Map([[1, [{ tipo: 'almoço' }]]]) }].forEach((refeicoes) => {
    assert.ok(run({ pessoas, batidas, refeicoes }).listadas.every((l) => l.refeicao.estado === 'indisponivel'));
  });
  const com = run({ pessoas, batidas, refeicoes: { disponivel: true, porPessoa: new Map([[1, [{ tipo: 'almoço\u0000', produto: 'prato', quantidade: 2, hora: '12:10' }, 'lixo']]]) } });
  assert.equal(com.fonte.refeicao, 'disponivel');
  const ana = com.listadas.find((l) => l.pessoaId === 1).refeicao, bia = com.listadas.find((l) => l.pessoaId === 2).refeicao;
  assert.equal(ana.estado, 'lancada'); assert.deepEqual(ana.itens, [{ tipo: 'almoço', produto: 'prato', quantidade: 2, hora: '12:10' }]);
  assert.equal(bia.estado, 'nao_lancou');
});

test('hora da consulta inválida: nada é listado nem classificado ao vivo', () => {
  const r = run({ consultadoEm: 'ontem', batidas: [B()] });
  assert.equal(r.listadas.length, 0); assert.equal(r.posicao, 'desconhecida');
  assert.ok(r.avisos.some((a) => /Hora da consulta inválida/.test(a)));
});

test('dia futuro e dia inválido', () => {
  assert.equal(run({ dia: '2026-11-20', batidas: [B({ data: '2026-11-20', entrada: T('08:00', '2026-11-20') })] }).listadas.length, 0);
  assert.throws(() => run({ dia: '2026-02-30' }), /dia inválido/);
});

test('ambiguidades de cadastro/leitura nunca atribuem horário: flash_id repetido e leitura duplicada', () => {
  const dup = run({ pessoas: [P({ id: 1 }), P({ id: 2, nome: 'Outra' })], batidas: [B()] });
  assert.equal(dup.listadas.length, 0); assert.equal(dup.resumo.ocultosConferir, 2);
  const duas = run({ batidas: [B(), B({ entrada: T('09:00') })] });
  assert.equal(duas.listadas.length, 0); assert.equal(duas.linhas[0].situacao, 'CONFERIR');
});

test('leitura sem cadastro correspondente é contada no aviso, não exibida', () => {
  const r = run({ batidas: [B(), B({ flash_id: 'ZZ' })] });
  assert.equal(r.listadas.length, 1);
  assert.ok(r.avisos.some((a) => /sem cadastro correspondente/.test(a)));
});

test('ausência registrada sem batida não lista; ausência COM batida lista e pede conferência', () => {
  const ausencias = [{ flash_id: 'F1', inicio: '2026-11-10', fim: '2026-11-14' }];
  assert.equal(run({ batidas: [], ausencias }).listadas.length, 0);
  const l = run({ batidas: [B()], ausencias }).listadas[0];
  assert.ok(l.alertas.some((a) => a.codigo === 'AUSENCIA_E_BATIDA'));
});

// ---------- leitura direta (Flash) ----------
test('leitura direta bem-sucedida com lista vazia: é leitura do dia (ninguém bateu), fresca e rotulada — não "sem leitura"', () => {
  const r = run({ batidas: [], fonteDireta: { lidoEm: '2026-11-12T20:59:00.000Z', rotulo: 'Flash — leitura direta' } });
  assert.equal(r.fonte.semLeituraDoDia, false); assert.equal(r.fonte.direta, 'Flash — leitura direta'); assert.equal(r.fonte.fresca, true);
  assert.equal(r.fonte.ultimaLeituraRotulo, '12/11 17:59'); assert.equal(r.linhas[0].situacao, 'SEM_BATIDA'); assert.equal(r.listadas.length, 0);
});
test('leitura direta com lidoEm inválido não conta: continua valendo a regra do lote', () => {
  const r = run({ batidas: [], fonteDireta: { lidoEm: 'agora', rotulo: 'x' } });
  assert.equal(r.fonte.semLeituraDoDia, true); assert.equal(r.fonte.direta, null);
});
test('refeição de ontem vale só para o turno de ontem; a de hoje só para hoje', () => {
  const ontem = '2026-11-12';
  const r = run({
    dia: '2026-11-13', consultadoEm: '2026-11-13T01:30:00-03:00', batidas: [], fontes: { ausencias: true, ocorrencias: true, anterior: true },
    batidasAnterior: [B({ data: ontem, entrada: T('18:00', ontem), n_batidas: 1 })],
    refeicoes: { disponivel: true, porPessoa: { 1: [{ tipo: 'almoço', hora: '11:00' }] }, identificados: [1] },
    refeicoesAnterior: { disponivel: true, porPessoa: { 1: [{ tipo: 'jantar', hora: '19:30' }] }, identificados: [1] },
  });
  assert.equal(r.listadas[0].refeicao.itens[0].tipo, 'jantar');
});
test('refeição: pessoa fora da lista de identificados e sem item = "sem_vinculo", nunca "nao_lancou"', () => {
  const ref = { disponivel: true, porPessoa: {}, identificados: [7] };
  assert.equal(PAV.celulaRefeicao(ref, 1).estado, 'sem_vinculo');
  assert.equal(PAV.celulaRefeicao(ref, 7).estado, 'nao_lancou');
  assert.equal(PAV.celulaRefeicao({ disponivel: true, porPessoa: {} }, 1).estado, 'nao_lancou', 'sem a lista de identificados vale o contrato antigo');
});
test('avisosExtras entram como texto limpo e limitado', () => {
  const r = run({ batidas: [B()], avisosExtras: ['3 item(ns) sem dono\u0000', 42, '', 'x'.repeat(500)] });
  assert.ok(r.avisos.includes('3 item(ns) sem dono')); assert.ok(r.avisos.some((a) => a.length === 200)); assert.ok(!r.avisos.some((a) => a === '42'));
});

// ---------- modo Água Verde (só leitura direta): dia operacional + regra das 2 batidas ----------
const av = (o) => run(Object.assign({ modoAguaVerde: true }, o));
test('diaOperacionalDe: 02:59 e 06:59 ainda são ontem; 07:00 é hoje', () => {
  assert.equal(PAV.diaOperacionalDe('2026-11-13T02:59:00-03:00'), '2026-11-12'); assert.equal(PAV.diaOperacionalDe('2026-11-13T03:00:00-03:00'), '2026-11-12');
  assert.equal(PAV.diaOperacionalDe('2026-11-13T06:59:00-03:00'), '2026-11-12'); assert.equal(PAV.diaOperacionalDe('2026-11-13T07:00:00-03:00'), '2026-11-13');
  assert.equal(PAV.diaOperacionalDe('lixo'), null);
});
test('modoAguaVerde: o dia operacional é "hoje"; sem o modo, ou em consulta histórica, não', () => {
  const ag = (hm) => '2026-11-13T' + hm + ':00-03:00';
  assert.equal(av({ dia: '2026-11-12', consultadoEm: ag('02:59') }).posicao, 'hoje');
  assert.equal(av({ dia: '2026-11-12', consultadoEm: ag('06:59') }).posicao, 'hoje');
  assert.equal(av({ dia: '2026-11-12', consultadoEm: ag('07:00') }).posicao, 'passado');
  assert.equal(av({ dia: '2026-11-13', consultadoEm: ag('06:59') }).posicao, 'futuro');
  assert.equal(av({ dia: '2026-11-13', consultadoEm: ag('07:00') }).posicao, 'hoje');
  assert.equal(av({ dia: '2026-11-11', consultadoEm: ag('02:59') }).posicao, 'passado');
  assert.equal(run({ dia: '2026-11-12', consultadoEm: ag('02:59') }).posicao, 'passado', 'sem o modo: dia civil (lote intacto)');
});
test('modoAguaVerde de madrugada: turno aberto do dia operacional é DENTRO (sem depender de "ontem")', () => {
  const r = av({ dia: '2026-11-12', consultadoEm: '2026-11-13T01:30:00-03:00', batidas: [B({ lido_em: '2026-11-13T01:29:00-03:00', entrada: T('18:00') })], fonteDireta: { lidoEm: '2026-11-13T01:30:00-03:00', rotulo: 'x' } });
  assert.equal(r.listadas[0].situacao, 'DENTRO'); assert.equal(r.fonte.virada, 'nao_aplica');
});
const dois = (seg, o) => av(Object.assign({ batidas: [B({ n_batidas: 2, saida: T(seg) })] }, o || {})).listadas[0];
const J = (o) => ({ 1: Object.assign({ entrada: '08:00', saida: '22:00', conferidoEm: DIA }, o) });
test('2 batidas (modo AV, 18:00): exatamente 2 h já é saída; 1h59 sem jornada NÃO se afirma', () => {
  const sai = dois('16:00');
  assert.equal(sai.situacao, 'JA_SAIU'); assert.deepEqual(vals(sai), ['exato:08:00', 'exato:16:00', 'nao:-', 'exato:16:00'], 'antigo: 2ª nas colunas de intervalo e de saída');
  const amb = dois('16:01');
  assert.equal(amb.situacao, 'SAIU_OU_INTERVALO'); assert.deepEqual(vals(amb), ['exato:08:00', 'ambigua:16:01', 'nao:-', 'ambigua:16:01']);
});
test('2 batidas com jornada cadastral recente: no intervalo até o fim previsto; fim passado ou 2 h = saída', () => {
  const int = dois('16:01', { jornadas: J() });
  assert.equal(int.situacao, 'INTERVALO'); assert.deepEqual(vals(int), ['exato:08:00', 'exato:16:01', 'nao:-', 'nao:-']);
  assert.match(int.explicacao, /Jornada cadastral conferida em 12\/11; não é escala diária/);
  assert.equal(dois('17:00', { jornadas: J({ saida: '17:30' }) }).situacao, 'JA_SAIU');
  assert.equal(dois('16:00', { jornadas: J() }).situacao, 'JA_SAIU', 'exatas 2 h vencem a jornada');
  assert.deepEqual(int.alertas, [], 'jornada cadastral não gera falta/atraso/alerta');
});
test('2 batidas com jornada noturna: fim é no dia seguinte (saída < entrada)', () => {
  const r = av({ consultadoEm: '2026-11-12T23:30:00-03:00', batidas: [B({ n_batidas: 2, entrada: T('18:00'), saida: T('22:30'), lido_em: '2026-11-12T23:29:00-03:00' })], jornadas: J({ entrada: '18:00', saida: '02:00' }) });
  assert.equal(r.listadas[0].situacao, 'INTERVALO');
});
test('2 batidas: jornada vencida (8 dias), futura, inválida ou ausente = ambígua; 7 dias ainda vale', () => {
  for (const j of [J({ conferidoEm: '2026-11-04' }), J({ conferidoEm: '2026-11-13' }), J({ entrada: 'x' }), J({ entrada: '08:00', saida: '08:00' }), null, {}])
    assert.equal(dois('16:01', { jornadas: j }).situacao, 'SAIU_OU_INTERVALO', JSON.stringify(j));
  assert.equal(dois('16:01', { jornadas: J({ conferidoEm: '2026-11-05' }) }).situacao, 'INTERVALO');
});
test('jornada: frescor contra o dia CIVIL de agora — às 04h de 13/11 (operacional 12/11) conferida em 13/11 vale; em 12/11 também; 8 dias não', () => {
  const r = (conf) => av({ consultadoEm: '2026-11-13T04:00:00-03:00', batidas: [B({ n_batidas: 2, entrada: T('18:00'), saida: T('02:30', '2026-11-13'), lido_em: '2026-11-13T03:59:00-03:00' })],
    jornadas: { 1: { entrada: '18:00', saida: '05:00', conferidoEm: conf } } }).listadas[0];
  assert.equal(r('2026-11-13').situacao, 'INTERVALO'); assert.equal(r('2026-11-12').situacao, 'INTERVALO'); assert.equal(r('2026-11-05').situacao, 'SAIU_OU_INTERVALO'); assert.equal(r('2026-11-04').situacao, 'SAIU_OU_INTERVALO');
  assert.equal(r('2026-11-14').situacao, 'SAIU_OU_INTERVALO', 'conferida no futuro civil não vale');
});
test('jornada nunca é usada em consulta histórica', () => {
  const l = av({ dia: '2026-11-11', batidas: [B({ data: '2026-11-11', n_batidas: 2, entrada: T('08:00', '2026-11-11'), saida: T('12:00', '2026-11-11') })], jornadas: { 1: { entrada: '08:00', saida: '22:00', conferidoEm: DIA } } }).listadas[0];
  assert.equal(l.situacao, 'JA_SAIU'); assert.ok(!/Jornada cadastral/.test(l.explicacao));
});
test('modo AV: 1, 3 e 4 batidas seguem b2=saiu, b3=voltou, última par=saída', () => {
  assert.deepEqual(vals(av({ batidas: [B()] }).listadas[0]), ['exato:08:00', 'nao:-', 'nao:-', 'nao:-']);
  const t3 = av({ batidas: [B({ n_batidas: 3, saida: T('13:10'), horarios: [T('08:00'), T('12:00'), T('13:10')] })] }).listadas[0];
  assert.deepEqual(vals(t3), ['exato:08:00', 'exato:12:00', 'exato:13:10', 'nao:-']);
  const t4 = av({ batidas: [B({ n_batidas: 4, saida: T('17:00'), horarios: [T('08:00'), T('12:00'), T('13:00'), T('17:00')] })] }).listadas[0];
  assert.deepEqual(vals(t4), ['exato:08:00', 'exato:12:00', 'exato:13:00', 'exato:17:00']);
});

test('rotuloBrt converte UTC para Brasília sem somar horas fixas', () => {
  assert.equal(PAV.rotuloBrt('2026-11-13T02:10:00Z'), '12/11 23:10');
  assert.equal(PAV.rotuloBrt('lixo'), null);
});

test('calendário próprio: dia anterior/seguinte na virada de mês e ano', () => {
  assert.equal(PAV.diaAnterior('2026-03-01'), '2026-02-28'); assert.equal(PAV.diaAnterior('2027-01-01'), '2026-12-31');
  assert.equal(PAV.diaSeguinte('2026-12-31'), '2027-01-01'); assert.equal(PAV.diaSeguinte('2028-02-28'), '2028-02-29');
});

