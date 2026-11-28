import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { criarPedido, confirmarPagamentoSimulado, marcarPronto } from '../src/pedidos.js';
import { gerarPayloadTicketFicticio, validarPayloadTicketOffline } from '../src/validador-offline-saipos.js';
const entrada = (key) => ({idempotencyKey:key,itens:[{produtoId:'p1',quantidade:1}]});
test('senha entregue na criação permanece a mesma até pronto; reenvio não consome senha', () => {
  const estado={pedidos:{},contadorSenha:0};
  const p=criarPedido(estado,entrada('um')); const senha=p.senha;
  assert.ok(senha); assert.equal(criarPedido(estado,entrada('um')).senha,senha);
  const segundo=criarPedido(estado,entrada('dois')); assert.notEqual(segundo.senha,senha);
  confirmarPagamentoSimulado(estado,p.id,{idempotencyKey:'pag',resultado:'aprovado'});
  assert.equal(marcarPronto(estado,p.id).senha,senha);
});
test('falha de gravação preserva memória/disco e a fila volta a aceitar transações', async () => {
  const dir=await mkdtemp(join(tmpdir(),'lab-totem-auditoria-'));
  const path=join(dir,'pedidos.json');const store=new Store(path);await store.carregar();
  const antes=await readFile(path,'utf8');const gravar=store._gravarDisco.bind(store);
  store._gravarDisco=async()=>{throw new Error('FALHA SIMULADA DE GRAVAÇÃO');};
  await assert.rejects(()=>store.transacao(e=>criarPedido(e,entrada('falha'))));
  assert.equal(store.listarPedidos().length,0);assert.equal(await readFile(path,'utf8'),antes);
  store._gravarDisco=gravar;await store.transacao(e=>criarPedido(e,entrada('recuperado')));
  assert.equal(store.listarPedidos().length,1);
});
test('criações concorrentes com a mesma chave geram um único pedido e senha', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lab-totem-concorrencia-'));const store=new Store(join(dir,'pedidos.json'));await store.carregar();
  const resultados=await Promise.all(Array.from({length:10},()=>store.transacao(e=>criarPedido(e,entrada('unica')))));
  assert.equal(new Set(resultados.map(p=>p.id)).size,1);assert.equal(store.listarPedidos().length,1);
});
test('validador rejeita itens nulos, valores negativos/não finitos e data inválida',()=>{
  const estado={pedidos:{},contadorSenha:0};const payload=gerarPayloadTicketFicticio(criarPedido(estado,entrada('formato')));
  for(const mutar of [p=>p.items=[null],p=>p.items[0].unit_price=-1,p=>p.payment_types[0].amount=Infinity,p=>p.created_at='invalida']) {
    const copia=structuredClone(payload);mutar(copia);assert.equal(validarPayloadTicketOffline(copia).valido,false);
  }
});
