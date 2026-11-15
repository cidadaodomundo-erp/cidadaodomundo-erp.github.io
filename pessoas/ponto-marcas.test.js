const test = require('node:test');
const assert = require('node:assert');
const { avaliar } = require('./ponto-marcas.js');
const D = '2026-11-15';
const t = (h) => D + ' ' + h + ':00';
const J = { entrada: '11:00', saida: '20:00' };
const REF = { disponivel: true, identificado: true, itens: [{ tipo: 'almoço', produto: 'x-salada', hora: '15:05' }] };

test('tudo certo fica verde', () => {
  const r = avaliar({ dia: D, horarios: [t('11:00'), t('15:00'), t('16:00'), t('20:05')], jornada: J, refeicao: REF });
  assert.equal(r.geral, 'ok'); assert.equal(r.problemas.length, 0); assert.match(r.refeicao.texto, /x-salada \(15:05\)/);
});
test('intervalo curto, saída cedo e sem refeição ficam vermelhos no campo certo', () => {
  const r = avaliar({ dia: D, horarios: [t('11:00'), t('15:00'), t('15:40'), t('19:30')], jornada: J, refeicao: { disponivel: true, identificado: true, itens: [] } });
  assert.equal(r.geral, 'ruim');
  assert.equal(r.intervalo.estado, 'ruim'); assert.match(r.intervalo.texto, /40 min/);
  assert.equal(r.saida.estado, 'ruim'); assert.match(r.saida.texto, /30 min mais cedo/);
  assert.equal(r.refeicao.estado, 'ruim'); assert.equal(r.entrada.estado, 'ok');
});
test('hora extra pede conferir autorização', () => {
  const r = avaliar({ dia: D, horarios: [t('11:00'), t('15:00'), t('16:00'), t('21:00')], jornada: J, refeicao: REF });
  assert.equal(r.saida.estado, 'ruim'); assert.match(r.saida.texto, /hora extra.*1h.*conferir autorização/);
});
test('turno virando a noite', () => {
  const r = avaliar({ dia: D, horarios: [t('18:00'), t('21:00'), t('22:00'), '2026-11-16 00:30:00'], jornada: { entrada: '18:00', saida: '00:30' }, refeicao: REF });
  assert.equal(r.saida.estado, 'ok'); assert.equal(r.geral, 'ok');
});
test('turno longo sem intervalo é vermelho; turno curto não', () => {
  assert.equal(avaliar({ dia: D, horarios: [t('11:00'), t('20:00')], jornada: J, refeicao: REF }).intervalo.estado, 'ruim');
  assert.equal(avaliar({ dia: D, horarios: [t('11:00'), t('15:00')], jornada: null, refeicao: REF }).intervalo.estado, 'ok');
});
test('ainda trabalhando não julga; sem horário ou sem leitura de refeição fica neutro', () => {
  const a = avaliar({ dia: D, horarios: [t('11:00')], jornada: J, refeicao: REF });
  assert.equal(a.andamento, true); assert.equal(a.geral, 'neutro'); assert.equal(a.problemas.length, 0);
  const b = avaliar({ dia: D, horarios: [t('11:00'), t('15:00'), t('16:00'), t('20:00')], jornada: null, refeicao: { disponivel: false } });
  assert.equal(b.geral, 'neutro'); assert.equal(b.saida.estado, 'sem'); assert.equal(b.refeicao.estado, 'sem');
});
