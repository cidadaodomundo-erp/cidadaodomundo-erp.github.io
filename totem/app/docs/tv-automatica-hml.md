# TV automática no Saipos HML — encerramento documental — 11/11/2026

Teste autorizado, isolado, somente na loja Saipos HML 93936, com dados artificiais. O ensaio externo foi feito e conferido. Não há implantação, operação real, TV física, pagamento, impressão, portal, ERP, robô nem serviço permanente.

## Em linguagem simples

O aplicativo de teste recebe o aviso do Saipos e mostra a senha como PRONTA na TV. Na demonstração principal, clicou-se em "Pedido Pronto" no Saipos e a senha 9206 apareceu como pronta na TV, sem rota local de pronto. A retirada (a senha sair da TV) continua sendo um comando manual no aplicativo.

## Fonte oficial e o que foi observado

Fonte: https://saipos-docs-order-api.readme.io/reference/eventos-pedido, consultada em 11/11/2026.

- Contratado pela documentação: TAKEOUT/DELIVERY podem emitir CONFIRMED, READY_TO_DELIVER, DISPATCHED, CONCLUDED e CANCELLED. TICKET emite só CONFIRMED, CONCLUDED e CANCELLED (não existe "pronto").
- Observado na HML real: ao clicar "Pedido Pronto" no Saipos, vieram CONFIRMED e depois CONCLUDED, sem READY_TO_DELIVER. Isso vale só para esta HML; não é semântica universal de CONCLUDED nem prova de prontidão física.

## Regra implementada

- Padrão (`prontoAoConcluirHml` ausente = false): READY_TO_DELIVER muda PREPARANDO para PRONTO; CONCLUDED não chama pronto (fica como encerrado sem pronto). TICKET antigo não muda.
- Opt-in HML (`prontoAoConcluirHml: true`, booleano; null ou outro tipo é rejeitado na inicialização): vale somente para pedidos NOVOS TAKEOUT HML, marcados com a flag persistida antes do envio. Para eles, CONFIRMED + CONCLUDED (em qualquer ordem) muda para PRONTO, e qualquer encerramento desses pedidos HML também chama a senha. Não produz conclusão real nem prontidão física universal.
- Cancelados são terminais e avisos tardios não reabrem. Retirada é sempre manual no aplicativo.
- Pedidos concluídos sem pronto não aparecem como retirados (aparecem em `encerrados` de `/api/hml/preparo`).

## Ensaio externo conferido (11/11/2026)

- Testes locais com fixtures: aplicativo 147/147 e conector 38/38 (as contagens incluem o receptor; não há contagem separada).
- Ensaio externo via túnel temporário, conferido às 15:52 (Curitiba).
- Pedido: orderId HML-20261111185147-90c7e772, loja Saipos HML 93936, pedido Balcao3 no Saipos (número do pedido, não outra loja), id 936502431, 1 Nelson 33,99 sem extras, do cardápio snapshot de 11/11 01:42. "Não imprimir" foi clicado.
- CONFIRMED às 15:51:48.709; clique em "Pedido Pronto" no Saipos, CONCLUDED às 15:52:18.432, sem READY_TO_DELIVER.
- A TV mostrou 9206 como pronto sem rota local de pronto. Retirada manual no aplicativo às 15:52:58.025, conferida na TV.
- O pedido novo estava marcado com a opt-in HML.

## Pedidos desta retomada

Quatro pedidos novos, 9203 a 9206 (3 aceitos, 1 recusado); 7 ledgers finais; próxima senha 9207. Preservados sem alteração: 9201 e 9202 (antigos).

- 9203: recusado. O Saipos exigiu telefone (HTTP 400) e o pedido não chegou à cozinha. Corrigido com telefone fictício só para TAKEOUT HML; TICKET inalterado.
- 9204 e 9205: concluídos sem Pronto, preservados sem reclassificação.
- 9206: o ensaio acima.

## Encerramento

- O campo do Saipos não aceita apagar a URL. A URL temporária protegida foi SUBSTITUÍDA e SALVA por https://webhook-desativado.invalid/; editor fechado e ausência de URL trycloudflare conferidos. (Não dizer "Nenhuma URL".)
- Túnel Cloudflare (4656) e aplicativo (4654) parados, sem serviço, abas próprias fechadas. As portas 4654, 4656 e 20241 já foram conferidas pelo Codex: ECONNREFUSED (fechadas).
- A Cloudflare e o cadastro no Saipos foram autorizados explicitamente; nenhuma permissão pendente.

## Limites

- Painel de pedidos prontos do Saipos HML: o valor original era Não. Foi testado como Sim no pedido 9205, sem mudar os eventos; depois restaurado para Não e conferido após recarregar a página.
- Último aviso só indica recebimento passado. A TV consulta o estado local a cada 1,5 segundo; em falha, limpa os números e avisa. Sem aviso, nunca inventar prontidão.
- O receptor separado escuta apenas em 127.0.0.1:4656, POST na rota secreta, JSON até 4096 bytes. Não expor a 4654.

## Próximo passo concreto

Demonstrar o aplicativo completo no equipamento do totem e na TV física, ainda em HML, antes de qualquer implantação ou aprovação real. Para repetir o teste: bin/start-saipos-hml.js com --sandbox, CONNECTOR_ENV_PATH e TV_WEBHOOK_CONFIG_PATH apontando para configurações privadas, nunca em argumentos, logs ou pacote.
