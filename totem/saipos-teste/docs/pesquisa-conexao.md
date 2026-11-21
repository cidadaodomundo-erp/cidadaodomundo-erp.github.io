# Pesquisa — conector Saipos (ensaio DEV, loja TESTE)

Leitura das páginas públicas da Order API e ensaio integrado em 10/11/2026. O coordenador confirmou autenticação, cardápio, um pedido na cozinha e sua conclusão, somente na loja HML 93936. Chave e token são consumidos localmente, sem exibição ao modelo ou inclusão no pacote. Não usa Data API nem Logística.

## Contratos comprovados (usados pelo conector)

| Uso | Contrato | Fonte |
|---|---|---|
| Autenticar | `POST https://order-api.saipos.com/auth`, JSON `{"idPartner","secret"}`. 200 → `{"token":"<JWT>"}`. 400 → `{t, dateTime, errorMessage, guidRequest}` ("Id do parceiro ou secret inválidos"). 500 mesma estrutura. Só pedir novo token perto de expirar; excesso causa bloqueio temporário. Sem 401/403/429 documentados. | [token-autenticacao](https://saipos-docs-order-api.readme.io/reference/token-autenticacao) |
| Validade do token | "2 dias tanto em produção quanto em homologação". | [duvidas-frequentes](https://saipos-docs-order-api.readme.io/reference/duvidas-frequentes) |
| Header | `Authorization: <token>`; o exemplo oficial mostra só o valor do token. Prefixo `Bearer` não documentado, não usado. | criar-pedido / consultar-cardapio |
| Catálogo | `GET https://order-api.saipos.com/v2/catalog` (sem query, sem `cod_store`). 200 → `{"url": "<link pré-assinado S3, 30 min>"}`. O JSON baixado é uma lista com `categoria`, `tipo`, `tamanho`, `id_store_item`, `item`, `item_type`, `id_store_choice`, `complemento`, `complemento_item`, `min_choices`, `max_choices`, `calc_method`, `print_by_quantity`, `codigo_saipos` (código PDV p/ itens e opcionais; ex. `12606018` e `12606018.12326242`), `price`, `store_item_enabled`, `store_choice_enabled`, `store_choice_item_enabled`. Erros 404/500 na estrutura acima. | [consultar-cardapio](https://saipos-docs-order-api.readme.io/reference/consultar-cardapio) |
| Criar ficha TICKET | `POST https://order-api.saipos.com/order`, JSON. Campos: ver `estrutura-campos-endpoints` (resumo em `saipos-oficial-coordenador.md`). Resposta 200 e 400: `{}` (sem id Saipos de volta). | [criar-pedido](https://saipos-docs-order-api.readme.io/reference/criar-pedido) |
| Códigos de erro (numéricos, sem HTTP status na página) | 901 `AUTHENTICATION` (token inválido/expirado); 906 `COD_STORE_NOT_FOUND`; 904 `ORDER_ALREADY_EXISTS` (enviar com novo `order_id`); 930 `PAYMENT_TYPE_NOT_FOUND`. Item/código inexistente: não documentado. | [codigos-de-erro](https://saipos-docs-order-api.readme.io/reference/codigos-de-erro) |

## Não implementado (de propósito)

- **Consulta de pedido** (`GET /order?cod_store&order_id`): documentada para Mesa/Balcão; TICKET não consta.
- **Cancelamento** (`POST /cancel-order` `{order_id, cod_store}`, 200 `{status:true}`): aplicabilidade a TICKET não consta. Cancelar ficha de teste pela UI da loja TESTE.
- **Webhook/eventos**: nenhum configurado no canal; fora do escopo.

## Pontos em aberto (pendências exatas)

1. **`cod_store` em DEV conferido**: o UUID do canal foi conferido na tela e aceito no envio à HML 93936. É diferente do número 93936. O valor e demais configurações reais ficam fora deste pacote.
2. **Unidade de `price` do catálogo**: a página não declara. O conector trata como reais (mesma unidade de `unit_price`) e exibe o total para conferência visual na UI.
3. **Vínculo item ↔ complemento**: o conector valida os códigos, habilitação, preço, vínculo por `id_store_item` e limites min/max dos grupos. Rejeita rateios. Complementos ainda não foram ensaiados contra a API: o catálogo HML consultado só contém Diversos, sem adicionais.
4. **Código de forma de pagamento**: depende do mapeamento no canal (`rotinas-pdv`). Não há default; `--payment-code` é obrigatório.
5. **Link do catálogo é S3**: download opt-in apenas do link retornado pela API, HTTPS em `saipos-integration-services-catalog-production.s3.us-east-1.amazonaws.com` e caminho `/catalog/catalog-<numero>.json`, sem portas alternativas ou redirecionamento. O arquivo real veio como `{data: [...]}`, com um registro; o helper normaliza a lista.
6. **Resposta 200 `{}`** não prova aceite na cozinha/painel; conferir na UI da loja TESTE. Sem id Saipos na resposta, o vínculo senha-nossa ↔ venda Saipos é só pelo `order_id` (nosso).
7. **`total_amount` no TICKET**: o envio de teste de valor zero foi aceito sem o campo. Valores não zero ainda precisam de ensaio específico.
8. **Custo da API**: não confirmado.

## Decisões de segurança do conector

- Host único `order-api.saipos.com`, caminhos `/auth`, `/v2/catalog`, `/order`; `redirect: manual`; resposta 3xx é tratada como falha.
- Token só em arquivo privado ao lado do `.env`; reaproveitado até 30 min antes de expirar (claim `exp` do JWT; se ausente, `obtidoEm` + 2 dias do FAQ).
- Envio: uma única tentativa por `order_id`, com reserva exclusiva em `ledger/` criada antes do POST. Timeout, 5xx, 3xx ou erro de rede = estado `ambiguo`, sem reenvio automático.


## Conferência do Codex — 10/11/2026
37/37 ensaios offline aprovados. Ensaio integrado real apenas na HML: pedido HML-20261111023156-2b454ddf, senha externa 9101, ficha Saipos 1 (id 936102693), Diversos código 40101353, quantidade 1, total e Dinheiro zero. POST /order retornou 200; a UI confirmou separadamente a entrada em Cozinha, o item e a observação TESTE NÃO PRODUZIR. Não foi acionada impressão. O clique em Pedido Pronto nessa ficha a moveu para Entregue. O registro permaneceu no HML, sem cancelamento ou reenvio. Telas de evidência e relato acompanham o pacote; o protótipo visual ainda não está ligado a este adaptador, ao pagamento real ou aos webhooks/TV. Nada foi publicado no portal ou alterado nas lojas reais.
