const test = require('node:test');
const assert = require('node:assert');
const { resumir } = require('./ponto-historico.js');
const t = (d, h) => d + 'T' + h + ':00';
const J = { entrada: '11:00', saida: '20:00' };
const base = (dias, extra) => Object.assign({ jornada: J, dias, refeicao: { identificado: true, ate: '2026-11-15', dias: { '2026-05-02': [{ hora: '15:10', produto: 'almoço' }] } }, ocorrencias: [], ausencias: [] }, extra || {});
test('conta infrações por tipo, refeição e põe o dia mais novo primeiro', () => {
  const r = resumir(base([
    { dia: '2026-05-01', empresa: 'AGUA VERDE', horarios: [t('2026-05-01', '11:00'), t('2026-05-01', '15:00'), t('2026-05-01', '15:30'), t('2026-05-01', '19:00')] },
    { dia: '2026-05-02', empresa: 'AGUA VERDE', horarios: [t('2026-05-02', '11:00'), t('2026-05-02', '15:00'), t('2026-05-02', '16:00'), t('2026-05-02', '20:00')] },
    { dia: '2026-05-03', empresa: 'AGUA VERDE', horarios: [t('2026-05-03', '11:00')] },
  ]));
  assert.equal(r.linhas[0].dia, '2026-05-03');
  assert.equal(r.total, 2);
  assert.equal(r.contagem.intervalo, 1); assert.equal(r.contagem.cedo, 1); assert.equal(r.contagem.impar, 1); assert.equal(r.contagem.refeicao, 1);
  assert.deepEqual(r.linhas[1].tipos, []); assert.match(r.linhas[1].refeicao, /almoço 15:10/);
});
test('advertência, suspensão e férias entram como linhas; férias não conta como infração', () => {
  const r = resumir(base([], { ocorrencias: [{ dia: '2026-06-01', tipo: 'ADVERTENCIA', motivo: 'atraso' }, { dia: '2026-06-05', tipo: 'SUSPENSAO', motivo: '' }], ausencias: [{ inicio: '2026-07-01', fim: '2026-07-30', tipo: 'FERIAS' }] }));
  assert.equal(r.contagem.ADVERTENCIA, 1); assert.equal(r.contagem.SUSPENSAO, 1); assert.equal(r.contagem.FERIAS, 1);
  assert.equal(r.total, 2);
});
test('sem cartão de refeição cadastrado não acusa refeição', () => {
  const r = resumir(base([{ dia: '2026-05-01', horarios: [t('2026-05-01', '11:00'), t('2026-05-01', '15:00'), t('2026-05-01', '16:00'), t('2026-05-01', '20:00')] }], { refeicao: { identificado: false, ate: '2026-11-15', dias: {} } }));
  assert.equal(r.contagem.refeicao, 0); assert.equal(r.total, 0);
});
