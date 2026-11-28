import {test} from 'node:test';
import assert from 'node:assert/strict';
import {montarPayload,localizarCodigo} from '../src/payload.js';
import {linkPermitidoParaDownload} from '../src/catalogo.js';
import {CATALOGO} from './ajuda.js';
const base={meta:{codStore:'COD-TESTE-1'},itemCodigo:'12606018',complementos:['12606018.12326242'],paymentCode:'DIN'};
test('rejeita flag N documentada como produto desabilitado',()=>{
 const rows=structuredClone(CATALOGO);rows[0].store_item_enabled='N';
 assert.throws(()=>localizarCodigo(rows,'12606018','item'),e=>e.codigo==='CODIGO_DESABILITADO');
});
test('rejeita complemento de outro produto e escolha repetida',()=>{
 const rows=structuredClone(CATALOGO);rows[1].id_store_item=999;
 assert.throws(()=>montarPayload({...base,catalogo:rows}),e=>e.codigo==='COMPLEMENTO_OUTRO_ITEM');
 assert.throws(()=>montarPayload({...base,catalogo:CATALOGO,complementos:[...base.complementos,...base.complementos]}),e=>e.codigo==='COMPLEMENTO_REPETIDO');
});
test('rejeita grupo obrigatório não atendido e regra de rateio',()=>{
 const rows=structuredClone(CATALOGO);rows[1].min_choices=2;
 assert.throws(()=>montarPayload({...base,catalogo:rows}),e=>e.codigo==='COMPLEMENTOS_FORA_DO_LIMITE');
 rows[1].min_choices=1;rows[1].calc_method='Rateio proporcional a quantidade de itens selecionados';
 assert.throws(()=>montarPayload({...base,catalogo:rows}),e=>e.codigo==='CALCULO_NAO_SUPORTADO');
});
test('download restrito ao bucket e caminho publicados pelo Saipos, sem portas ou hosts alternativos',()=>{
 const host='saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com';
 assert.equal(linkPermitidoParaDownload(`https://${host}/catalog/catalog-93936.json?X-Amz-Signature=FICTICIO`),true);
 for(const url of ['https://outro.s3.amazonaws.com/catalog/catalog-93936.json',`https://${host}:8443/catalog/catalog-93936.json`,`https://${host}/outro/arquivo`]) assert.equal(linkPermitidoParaDownload(url),false);
});
