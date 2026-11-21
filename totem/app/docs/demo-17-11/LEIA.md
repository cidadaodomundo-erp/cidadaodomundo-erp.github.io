# Demonstração do totem — 17/11/2026

Tudo simulado: nenhum dinheiro, nenhuma loja Saipos real, nenhuma senha.

Como ligar em qualquer PC com Node 18+:

    node bin/start-demo.js

Abra no navegador:
- Totem: http://127.0.0.1:4660/
- Cozinha: http://127.0.0.1:4660/cozinha-hml.html
- TV: http://127.0.0.1:4660/tv-hml.html

O que acontece: cardápio real (Gama/VNDX) → carrinho → escolhe Pix, Débito ou Crédito →
Pix mostra QR Code e "o banco" confirma sozinho em 8 s; cartão "a maquininha" aprova em 5 s →
só depois de aprovado o pedido vai para a loja (falsa) → senha na tela → cozinha marca pronto → TV mostra.

Peças:
- `src/tef.js`: maquininha TEF genérica. Qualquer empresa (SuperTEF, Saipos, Rede, PayGo, SiTef) entra
  escrevendo só duas funções: `solicitar` e `consultar`.
- `src/pix.js`: Pix pelo padrão do Banco Central (/cob). Falta só o banco da conta PJ.
- `src/pagamento.js`: regra única: só "aprovado" libera a cozinha; mesma chave nunca cobra duas vezes.
- Servidor (`src/saipos-hml.js`): com pagamento ligado, o valor é calculado no servidor e o pedido
  é bloqueado (402) até o pagamento do MESMO carrinho ser aprovado.
