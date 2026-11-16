const test = require('node:test');
const assert = require('node:assert');
const { resumir } = require('./ponto-historico.js');
const t = (d, h) => d + 'T' + h + ':00';
const J = { entrada: '11:00', saida: '20:00' };
test('conta infrações por tipo e põe o dia mais novo primeiro', () => {
  const r = resumir([
    { dia: '2026-05-01', empresa: 'AGUA VERDE', horarios: [t('2026-05-01', '11:00'), t('2026-05-01', '15:00'), t('2026-05-01', '15:30'), t('2026-05-01', '19:00')] },
    { dia: '2026-05-02', empresa: 'AGUA VERDE', horarios: [t('2026-05-02', '11:00'), t('2026-05-02', '15:00'), t('2026-05-02', '16:00'), t('2026-05-02', '20:00')] },
    { dia: '2026-05-03', empresa: 'AGUA VERDE', horarios: [t('2026-05-03', '11:00')] },
  ], J);
  assert.equal(r.linhas[0].dia, '2026-05-03');
  assert.equal(r.total, 2);
  assert.equal(r.contagem.intervalo, 1); assert.equal(r.contagem.cedo, 1); assert.equal(r.contagem.impar, 1);
  assert.equal(r.linhas[1].tipos.length, 0);
});
test('sem horário cadastrado só marca intervalo', () => {
  const r = resumir([{ dia: '2026-05-01', horarios: [t('2026-05-01', '09:00'), t('2026-05-02', '01:00')] }], null);
  assert.deepEqual(r.linhas[0].tipos, ['semintervalo']);
});
