# Revisao independente do coordenador
Todos os 11 testes atuais saipos-payload passaram, porem reproduzi duas falhas:
1. criarPedidoMesaComanda com destino {tipo:'mesa',descTable:undefined}, demais campos validos, ACEITA e gera corpo.table=null. Idem revisar comanda descOrderPad undefined. Deve recusar obrigatorio undefined mesmo propriedade presente. Checar propriedades herdadas/undefined sem inferir dados.
2. precoCentavos=Number.MAX_SAFE_INTEGER, quantidade=2 gera conferencia.totalItensCentavos nao seguro. Validar todas somas/multiplicacoes do total e recusar perda de precisao. Sem inventar limite comercial: limite tecnico Number.isSafeInteger nas operacoes.
Ambos testes feitos apenas com strings TESTE/SINTETICO, sem rede.
Corrigir por Claude e acrescentar regressao especifica. Nao ampliar escopo.

---
## STATUS: CORRIGIDO PELO EXECUTOR — AGUARDANDO TESTE DO COORDENADOR
O executor (sem shell) **nao rodou** a suite; as correcoes e testes abaixo sao por escrito e dependem da verificacao do coordenador
(`node --test tests/`; antes: 35 core/import + 11 payload passaram).

### Defeito 1 (undefined => table:null) — corrigido em `src/saipos-payload.cjs`
Causa: `texto()` retornava `false` em silencio quando a propriedade existia com valor `undefined`, e `validarDestino` so reportava
"exige descTable" quando a chave estava ausente (`!("descTable" in d)`), entao `{descTable: undefined}` passava e gerava `table: null`.
Correcao:
- `chaves()` agora recusa **qualquer propriedade propria com valor `undefined`** (obrigatoria ou opcional): `"k" esta presente com valor undefined (omita o campo ou informe o valor)`.
- Presenca passou a ser **propriedade propria** (`hasOwnProperty`), nao `in`: propriedades **herdadas** nao contam (obrigatorio herdado = ausente).
- `validarDestino` so devolve `table` quando o identificador (`descTable`/`descOrderPad`) e texto literal valido; senao o pedido e recusado (nunca `table: null`). Vale para mesa e comanda, `integrationCode` e `integrationCodeConfirmado`.
- Campos opcionais (`observacao`, `garcomId`, `referenciaParceiro`, `displayId`, `criadoEm`, `complementos`) com `undefined` agora falham em vez de serem ignorados. Textos vazios/so espacos continuam falhando.

### Defeito 2 (total inseguro) — corrigido
`totalItensCentavos` valida com `Number.isSafeInteger` **cada** passo: preco×quantidade de complemento, soma de adicionais, preco+adicionais, (unitario com adicionais)×quantidade do item e a soma acumulada dos itens. Se qualquer passo perder precisao lanca `ErroPayload` (`... excede o limite tecnico de inteiro seguro (perda de precisao)`). `criarPedidoMesaComanda` e `rascunhoAdicaoPut` calculam o total depois da validacao estrutural e recusam o payload se estourar. Nenhum limite comercial foi inventado: valores exatos ate `Number.MAX_SAFE_INTEGER` continuam aceitos (ex.: preco `MAX_SAFE_INTEGER` x 1; `floor(MAX/2)` x 2).

### Regressoes adicionadas em `tests/saipos-payload.test.mjs` (os 11 testes anteriores foram mantidos)
- `regressao: propriedade presente com valor undefined falha...` (mesa e comanda `undefined`, `tipo`, `integrationCode`, campos de pedido/item/complemento, POST e PUT e `pedirConta`).
- `regressao: textos vazios ou so com espacos falham...`.
- `regressao: propriedades herdadas nao contam como fornecidas`.
- `regressao: total de conferencia usa Number.isSafeInteger...` (caso reportado MAX_SAFE x 2; complemento; soma de adicionais; preco+adicionais; soma entre itens; PUT; `totalItensCentavos` exportada; limites exatos aceitos).

Sem mudanca de escopo: sem rede/env/credenciais, sem front/build.

VERIFICADO PELO COORDENADOR: suite completa 50/50 aprovada e tres reproducoes independentes agora recusadas corretamente.
