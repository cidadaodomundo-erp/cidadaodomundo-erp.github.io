# Tablet de mesas — Cidadão do Mundo (DEMONSTRAÇÃO)

Protótipo de pedidos para tablet de mesa (alvo: Redmi Pad SE 11"). **Demo permanente**: faixa "DEMONSTRAÇÃO — pedidos não chegam à cozinha". Nada é enviado (sem rede, cozinha, Saipos, impressora, pagamento ou banco). Catálogo = **amostra de teste do totem (VNDX)**, NÃO o cardápio do salão; preços são de teste.

## Estado desta cópia (13/11 sessão sem Bash)
- Fonte copiada/atualizada: `src/` (core, app, css, template), `tools/build.mjs`, `tests/core.test.mjs`.
- **Build NÃO executado e testes NÃO executados nesta sessão** (sem ferramenta de shell). `tablet-mesas-cdm.html` **ainda não foi gerado aqui**.
- Para gerar e validar (local, sem rede):

```
node tools/build.mjs        # lê o totem somente leitura (caminho padrão no script, ou passe como argumento)
node --test tests/
```

## Mudanças desta revisão
- Horizontal (≥840px): **categorias verticais à esquerda** (150px) | cardápio com cards compactos 4:3 | **comanda à direita** (340px). Vertical: categorias em fita no topo e comanda em painel pela barra inferior.
- **Confirmação antes de registrar** cada rodada (resumo com ocupação, itens e total); cancelar mantém o carrinho.
- Mantido: Cubano em títulos CAIXA ALTA ASCII, Barlow no resto; variações/adicionais/observação/quantidade com validação mín/máx; rodadas; chamar atendente e pedir conta **simulados**; troca de mesa/cartão bloqueada com consumo ativo; persistência `localStorage` (`cdm-tablet-demo-v1`).

Veja `STATUS.json` para arquivos, testes e pendências reais.
