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
