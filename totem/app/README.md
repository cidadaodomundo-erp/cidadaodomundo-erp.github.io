# Totem — modos separados de ensaio

## Tela ligada ao Saipos HML — 11/11/2026

O modo `bin/start-saipos-hml.js --sandbox` usa somente a loja Cidadão do Mundo - HML [93936] e o conector sibling `../saipos-teste`, com configuração privada fora deste pacote.

**Estado atual (11/11/2026):** cópia do cardápio Gama/VNDX de 11/11 com 93 produtos, 107 variações e 93 fotos locais; 14 grupos e 52 opções ativos na HML. O mapa v2 real fica fora do pacote e foi conferido na API HML (107 variações, 721 vínculos de opções, 0 problemas). Um pedido de teste completo (senha 9202, ficha Saipos 3, id 936126987, total R$ 276,92) chegou à cozinha com itens, tamanhos, adicionais e quantidades exatos; opção “Não imprimir” confirmada no recebimento; recarregar a tela não duplicou o pedido. A TV local acompanhou preparando → pronto → retirado; a ficha 3 continua como Cozinha no Saipos. O total não foi cobrado (dado de teste). Detalhes: [docs/cardapio-hml.md](docs/cardapio-hml.md).

O ensaio anterior com Diversos continua preservado como histórico em `saipos.html` (senha 9201, ficha 2, id 936115299). Testes de 11/11: 110 do aplicativo, 38 do conector e 14 do mapeador; leitor Gama (17) e tela da chave (3) são da etapa anterior, não repetidos. As contagens do Node incluem arquivos de apoio. Não existe instalação, pagamento real, TV física ou agendamento. O simulador abaixo continua separado.

## Simulador original — sem conexão externa

As instruções a seguir referem-se ao simulador original `bin/start.js`, que continua separado e sem Saipos.

Demonstração local e isolada do fluxo: escolha de produto → complementos → pagamento simulado → cozinha fictícia → pronto → TV de senha → retirado.

**Não conecta ao Saipos. Não cobra de verdade. Não cria pedido real. Não roda no totem do Cidadão do Mundo (JOOG). É só um laboratório para estudar o fluxo.**

## Como abrir

Requer apenas Node.js 18 ou mais novo. Sem dependências externas (`npm install` não é necessário).

1. Rodar os testes automáticos (recomendado antes de abrir qualquer tela):
   ```
   node --test test/
   ```
2. Iniciar o servidor manualmente (decisão humana, não automática):
   ```
   node bin/start.js
   ```
   ou, para gravar os dados em outro local absoluto (ex.: pasta de QA/work em vez da pasta padrão `data/`):
   ```
   node bin/start.js --data C:\caminho\absoluto\pedidos-qa.json
   ```
   Isso abre `http://127.0.0.1:4650`, acessível só da própria máquina (host 127.0.0.1/localhost checado em toda requisição).
3. Abrir no navegador:
   - `http://127.0.0.1:4650/totem.html` — tela do cliente (cardápio fictício)
   - `http://127.0.0.1:4650/cozinha.html` — painel da cozinha (marcar pronto/retirado/cancelar)
   - `http://127.0.0.1:4650/tv.html` — tela de senhas prontas
4. Para encerrar, `Ctrl+C` no terminal onde o servidor está rodando. Não há processo de longa duração iniciado automaticamente — só quando alguém roda `bin/start.js` manualmente.

## O que este laboratório faz

- Cardápio fictício com preços rotulados "FICTÍCIO", loja fictícia fixa (`LOJA-FICTICIA-01`) validada explicitamente — qualquer outro `lojaId` é rejeitado.
- Cálculo do total sempre feito no servidor (nunca confia no valor vindo da tela).
- Valida produto, adicional permitido, ingrediente removível, quantidade (1 a 20), limite de 100 itens por pedido e corpo de requisição até 64KB. Listas de adicionais/remoções são deduplicadas.
- Pagamento é simulado: só avança se confirmado explicitamente como "aprovado"; recusado fica persistido como recusado e nunca vira sucesso em reenvio.
- "Pronto" é um botão da cozinha fictícia, não depende do status do aparelho de pagamento.
- Senha de retirada é única por pedido, alocada por um contador de loja persistido (nunca calculada pelo tamanho do histórico) — sobrevive a restart e a chamadas concorrentes, porque todas as mutações passam por uma fila de transações serializada.
- Persistência em arquivo JSON local com transação serializada: clona o estado, só grava em disco (escrita atômica tmp+rename) e só promove a memória depois do sucesso da gravação; falha de gravação não altera a memória nem corrompe o arquivo anterior. Arquivo corrompido ou com schema inválido faz o carregamento falhar fechado, sem apagar nada.
- Servidor estático usa allowlist explícita de arquivos (sem resolução de caminho livre) e confere o cabeçalho Host em toda requisição.
- Cliente (totem) desabilita o botão de criar pedido durante a tentativa e reutiliza a mesma `idempotencyKey` de pedido e de pagamento em qualquer reenvio por falha de rede, para nunca duplicar.
- Painel da cozinha mostra nomes de produto/adicionais/ingredientes removidos (não ids crus), com controles de pronto, retirado e cancelar.
- Validador offline TICKET (`src/validador-offline-saipos.js`) confere formato de payload contra a documentação oficial lida (ver `work/saipos-oficial-coordenador.md`), e um gerador de payload fictício a partir de um pedido demo, com códigos de integração marcados `FICT-*`. **Nenhum dos dois faz chamada de rede ou usa credencial real.**

## O que este laboratório NÃO faz / pendências reais

Ver `LIMITES.md`.


## Conferência de 10/11/2026
O Codex executou os 51 ensaios locais com sucesso e conferiu o fluxo pelas telas. A senha é entregue na criação e permanece a mesma em preparo, pronto e retirada. A evidência está em evidencias-10-11-2026.json. Nada foi enviado ao Saipos. Não há conector de envio ativo.
