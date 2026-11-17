# Padrão: logins de robô

Regra definida pelo dono em 15/11/2026.

- **Um login por área**, nunca um login por robô.
- Endereço: `robo.<area>@cidadaodomundo.com.br`. Exemplos: `robo.rh@`, `robo.estoque@`, `robo.financeiro@`.
- **Cada login só enxerga a sua área.** O acesso é dado só onde a área precisa e é registrado com data e motivo.
- A senha é criada pelo dono no Supabase, em Authentication > Users > Add user > Create new user (com "Auto confirm user" marcado). Ninguém mais digita nem guarda a senha. No computador que roda o robô, ela fica só no arquivo de configuração local do robô, nunca no repositório.
- Todo robô novo de uma área usa o login dessa área. Não se cria login novo para isso.

## Logins existentes

| Login | Área | O que pode ver | Onde está ligado | Desde |
|---|---|---|---|---|
| `robo.rh@cidadaodomundo.com.br` | RH | Leitura do RH e do ponto (`rmb_config.emails_pessoal`, `painel_loja_inicial`) | Robô do ponto no telefone da empresa (computador da Água Verde) | 15/11/2026 |

## Áreas que usam chave em vez de login

| Área | Como entra | O que pode fazer | Onde está ligado | Desde |
|---|---|---|---|---|
| Compras | Chave própria da área Compras (o banco guarda só o resumo sha256 dela, no vault `compras_robo_segredo`; a chave fica só em `compras-ml\compras.config.json` no Escritório 2) | Só as funções `compra_robo_pegar`, `compra_robo_gravar` e `compra_wa_receber`: pegar pedidos de cotação, gravar ofertas do Mercado Livre e registrar pedido que chega pelo 1602. Não lê nenhuma tabela direto. | Robô de Compras no Escritório 2 e o módulo de compras do WhatsApp 1602 | 17/11/2026 |

Pendente: se o dono preferir login, ele cria `robo.compras@cidadaodomundo.com.br` (só ele cria senha) e a chave é trocada por esse login.
