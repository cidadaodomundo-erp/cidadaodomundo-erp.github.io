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
