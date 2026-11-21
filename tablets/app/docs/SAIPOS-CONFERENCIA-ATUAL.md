# Saipos — conferência atual pelo coordenador, 12/11/2026
Fonte pública lida no navegador (somente leitura, nenhuma requisição Try It):
https://saipos-docs-order-api.readme.io/reference/estrutura-campos-endpoints
https://saipos-docs-order-api.readme.io/reference/criar-pedido

POST /order TABLE: obrigatórios order_id (string max40), display_id, cod_store, created_at, order_method.mode=TABLE, items array, table objeto. customer e payment_types opcionais. table.integration_code, table.desc_table, table.desc_order_pad todos opcionais na tabela; selecionar destino explícito conforme modalidade e cadastro confirmado. Itens no POST marcados opcionais na doc, mas nosso contrato deve exigir codigo/descricao/quantidade/preco para evitar inferência. Complementos exigem integration_code,desc_item_choice,aditional_price,quantity.
PUT /order TABLE também consta: obrigatórios order_id,cod_store,order_method.mode=TABLE,items com integration_code,item_external_code,desc_item,quantity,unit_price. Complementos mesmos requisitos. created_at/display_id/customer opcionais. A documentação de criação ainda descreve rodadas por POST com mesmo order_id+desc_table ou desc_order_pad. Esta divergência precisa ensaio HML; não assumir idempotência.
Solicitar conta é documentado: PUT /order-status com order_id,cod_store,status=CLOSE_REQUESTED. Não equivale pagar/fechar venda.
Consulta de ocupação GET /sale-status-by-table-or-pad exige table OU pad (arrays em string). Página de consulta consta na navegação.
Documentação local completa correta fica FORA de outputs/laboratorio-totem: C:/Users/Fabio Ikoma/Documents/Codex/2026-11-10/j-vou-fazer-mais-uma-pergunta/work/saipos-docs.
Leitura atual confirmou conteúdos locais sobre modo TABLE, desc_table para mesa, desc_order_pad para comanda; table_reference é só observação. Número/table integration_code devem vir de cadastro real.
Nada enviado, convertido ou alterado.
