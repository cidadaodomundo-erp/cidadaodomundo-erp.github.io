# Saipos Pedidos — fonte oficial encontrada pelo Codex em 10/11/2026

O botao de documentacao com icone de pacote em https://developer.saipos.com/#/login abriu https://saipos-docs-order-api.readme.io/reference/introducao . Nao e saipos-order-api nem logistica.

Introducao: API permite parceiros enviarem Delivery,Retirada,Ficha eMesa/Comanda; loja ve kanban e gerencia producao. Cadastro emSaiposDeveloper gera acesso a lojaTESTE; depois desenvolvimento,homologacao,oficializacao.

Guia https://saipos-docs-order-api.readme.io/reference/guia-pratico-de-integra%C3%A7%C3%A3o lido via navegadorDOM: credenciais contem Secret e dados da loja deTESTE(IDLoja,URLacesso,usuario,IDPartner,opcaoredefinirsenha); usuario doDeveloper e mesmo da lojaTESTE. Configuracao: nomecanal,modulos,webhook; identidadevisual. AtivacaoPRODUCAO aposhomologacao viaContaSaipos>Menu>CanaisdeVendas eIntegracoes>Configurar;Confirmarpedidosautomaticamente;Adicionarnovocodigodeloja;Habilitarintegracao;Adicionarformasdepagamentopadrao;Salvar geraIDPartner. NADA disso foi alterado.

Autenticacao https://saipos-docs-order-api.readme.io/reference/token-autenticacao : POST https://order-api.saipos.com/auth JSON{idPartner,secret}; token porloja; so renovar quando pertoexpirado ouexpirado,excessobloqueia. Secret porparceiro,IDPartner porloja. Nao confundir credenciaisDataAPIexistentes. Nenhuma credencialreal inspecionada.

Criacao https://saipos-docs-order-api.readme.io/reference/criar-pedido : POST https://order-api.saipos.com/order cabecalho Authorization recebe token (exemploOFICIAL nao mostra prefixoBearer). TICKET e orientacaooficial paraTotemautoatendimento e senha. ticket_reference vai SOMENTEcomoobservacao; numero da vendaTICKET Saipos gerado internamente incrementaloualeatorio. Nao assumir senhaigual.

Schema completo ainda a ler; exemplospublicosnaosao credenciaisreais e nao devemserusadosemrequisicoes. NENHUMA chamada auth/order executada. Credenciamento/SaiposDeveloper telaLOGIN semsessao; cadastro possivel exige Fabio definirsenha e aceitarcondicoes se houver. Nao cadastrar/geraracessoporcontapropria. O testeatual continuaLOCAL, semSaipos ate acessoteste conferido.

## Eventos e homologacao — lidos no navegador oficial

https://saipos-docs-order-api.readme.io/reference/eventos-pedido : TICKET somente CONFIRMED,CONCLUDED,CANCELLED. READY_TO_DELIVER soDELIVERY/TAKEOUT. CONFIRMED significa restauranteaceitouproduzir. Callback POST contem {event,cod_store,order_id}. O Pronto deve continuar botaoNOSSO de cozinha; nao inferir CONCLUDED=pronto.

https://saipos-docs-order-api.readme.io/reference/criterios-de-homologacao : moduloFICHA testa order_idrepetido,clientesmesmoID,consumidornaoidentificado(customer.id:-1),codigopdvproduto/complemento,maisdumpagamento,online/offline,cartao(codeCRE/complementVISA),Pixnoparceiro(codePARTNER_PAYMENT/complementPIX/typeONLINE),dinheirotroco,observacaoitem/pedido,desconto/acrescimo. Isso é checklistOFICIAL,NAO testesnossos aprovados.

Criarpedido possui customer.id:-1 para anonimo. PayloadTICKET campos documentados: order_id,display_id,cod_store,created_at,notes,total_increase,total_discount,total_amount,customer,order_method{mode:TICKET,ticket_reference},items[{integration_code,desc_item,quantity,unit_price,notes,choice_items[{integration_code,desc_item_choice,aditional_price,quantity,notes}]}],payment_types[{code,amount,change_for,...}]. Atenção grafia aditional_price UMd. Campos obrigatorios por modulo dependem paginaestrutura. Exemplooficial totals numericamente inconsistentes(exemplo total_amount10 e complementos3+10). Nao usar numero exemplo como totalcorreto;validar soma propriaemcentavos.

https://saipos-docs-order-api.readme.io/reference/estrutura-campos-endpoints LIDA: TICKET obrigatorios order_id(string),display_id(string),cod_store(string),created_at(string),total_discount(number),customer.id(string),customer.name(string),order_method.mode(TICKET),items array comintegration_code/desc_item strings,quantityinteger,unit_price number;choice_items opcional mas cadaitem necessita integration_code,desc_item_choice,aditional_price,quantity;payment_types OBRIGATORIO array code(string),amount(number),change_for(number). customer.phone/email/document_number opcionaisTICKET. notes,total_increase,total_amount,ticket_reference opcionais. Pagamentocomplement/type opcionais. Divergencia deobrigatoriedade usarpaginaestrutura porMODULO, nao generalizarDELIVERY.

https://saipos-docs-order-api.readme.io/reference/rotinas-pdv LIDA: exportarprodutos Menu>Cardapio>CodigosdeIntegracao>Exportar. Mapeamentopagamento emCanaisdeVendaeIntegracoes>app>Configurar;complement coincide exatovalorJSON;se PGTOONLINE marcado enviartypeONLINE.
