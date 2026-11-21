# Como ligar os tablets das mesas (modo TESTE)

Nada aqui cobra dinheiro. O pedido vai para a tela da cozinha de teste e, se você usar o atalho do Saipos, para a **loja TESTE** do Saipos.

## 1. No computador do salão (uma vez por dia)
1. Abra a pasta `tablets` deste projeto.
2. Dê dois cliques em **LIGAR-SALAO-TESTE.bat** (sem Saipos) ou **LIGAR-SALAO-SAIPOS-TESTE.bat** (com a loja TESTE do Saipos).
3. Se o Windows perguntar sobre o Firewall: clique em **Permitir acesso**.
4. A janela preta mostra:
   - **Senha da equipe** (6 números) — anote; serve para entrar na tela da cozinha, trocar a mesa do tablet e fechar a conta.
   - O endereço dos tablets, tipo `http://192.168.1.50:4662/tablet?mesa=1`.
   - O endereço da cozinha, tipo `http://192.168.1.50:4662/cozinha`.
5. Deixe essa janela aberta. Fechar a janela desliga os tablets.

## 2. Em cada Redmi (uma vez só)
1. Ligue o tablet no **mesmo Wi-Fi** do computador.
2. Abra o **Chrome** e digite o endereço da mesa, trocando o número no fim: mesa 7 → `...:4662/tablet?mesa=7`.
3. No Chrome: menu **⋮** (três pontinhos, canto de cima à direita) → **Adicionar à tela inicial** → **Adicionar**.
4. Abra pelo ícone novo. Toque uma vez na tela: ela entra em **tela cheia**.
5. Para o cliente não sair do app: nas Configurações, use a lupa de busca e digite **Fixar** (o nome muda conforme a versão do Redmi: "Fixar app" ou "Fixação de tela") e ligue. Depois, em Apps recentes, segure o app e toque em **Fixar**. Para soltar: segurar **Voltar + Recentes**.
6. Tela sempre ligada: deixe na tomada; Configurações → Tela → **Suspensão** no maior tempo.

## Como o cliente paga (TESTE: simulado, nada é cobrado)
- Ao tocar em Confirmar, aparece **PAGAR A RODADA** com um QR Code e os botões Pix, Apple Pay, Google Pay, Crédito e Débito.
- O cliente paga no tablet ou aponta a câmera do celular para o QR. O pedido só vai para a cozinha depois do pagamento aprovado.
- **Cancelar pagamento** não manda nada para a cozinha; o carrinho continua.

## 3. Na cozinha / caixa
- Abra `http://<ip>:4662/cozinha` num computador ou tablet.
- Cada rodada aparece sozinha: **Começar preparo** → **Marcar pronta** → **Entregue na mesa**. O tablet da mesa mostra o andamento.
- Pedidos de "Chamar atendente" e "Pedir conta" piscam em vermelho no topo. Toque em **Visto**.
- Na primeira vez, digite a senha da equipe no topo e toque em **Entrar** (o aparelho lembra).
- **Fechar conta**: toque em **Fechar conta** da mesa e confirme. O tablet da mesa fica zerado para o próximo cliente.

## Se algo der errado
- Tablet diz "Sem conexão": confira o Wi-Fi e se a janela preta continua aberta. O carrinho não se perde; toque em Confirmar de novo (não duplica).
- Computador reiniciou: dê dois cliques no atalho de novo. Os tablets continuam funcionando sem recarregar.
- Esqueceu a senha: ela fica em `tablets/servidor/dados/pin-equipe.txt` nesse computador.

## Pix da loja (QR com o valor, a equipe confirma)

**Água Verde: dê dois cliques em `LIGAR-SALAO-PIX-AGUA-VERDE.bat`.** Usa a chave CNPJ 32.620.507/0001-34 (confirmada pelo Fábio em 21/11/2026). Outras lojas entram em `servidor/pix-lojas.json`.

Outra forma (qualquer chave):

1. Na pasta `tablets/servidor/dados/`, crie o arquivo `pix.json` com a chave Pix oficial da loja:
   `{"chave": "CNPJ ou chave da loja", "nome": "CIDADAO DO MUNDO", "cidade": "CURITIBA"}`
2. Ligue o servidor do salão como sempre. Ele avisa: "Pix da loja LIGADO".
3. No tablet, ao pagar, aparece o QR do Pix já com o valor da rodada.
4. Na tela da cozinha aparece "PIX A CONFERIR". A equipe confere no app do banco e toca em **Pix recebido**. Só então a rodada vai para a cozinha.

Este Pix não confirma sozinho: quem garante que o dinheiro entrou é a equipe. A confirmação automática precisa da API do banco ou do e.Rede.
Sem o arquivo `pix.json`, o pagamento continua simulado.
