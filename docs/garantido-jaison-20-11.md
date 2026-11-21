# Tela do garantido para o Jaison (20/11/2026)

- Página: `jaison/` (celular primeiro; "Adicionar à tela inicial" abre como app).
- Banco: ERP rtmgzsikwglsvpopbfbw, migração `garantido_jaison_dia_20_11`:
  - `pagar_motoboys_calc(dia)`: o cálculo de `pagar_motoboys_dia(dia)` copiado do próprio banco, sem a trava; ninguém de fora executa.
  - `pagar_motoboys_dia(dia)`: igual antes (trava `pode_ver_pessoal` + o mesmo cálculo).
  - `pode_ver_garantido()`: dono, quem vê pessoal, ou e-mail em `rmb_config` chave `emails_garantido` (começa vazia).
  - `garantido_motoboys_dia(dia)`: só garantido, taxas, refeição, a receber, escala e motivo. Sem chave Pix, sem id.
- Não grava nada. Hora no pátio vem só das tabelas do ERP (`chegada_fila`, `chegada_presenca`); a tela Pagar motoboys também usa a chegada do portal antigo, então o corte por atraso pode aparecer lá e não aqui.
- 20/11 (pedido do Fábio): cada motoboy mostra, por turno, a escala combinada, a hora que chegou (pátio ou, sem pátio, 1ª coleta) e o atraso; garantido Sim/Não; corridas; quanto vai ganhar. Função ganhou corta_alm/jan, atraso_*, chegada_jan, saida_alm.

## 21/11/2026 — chuva por período e botão da escala (pedido do Fábio)
- Previsão: manhã, tarde e noite com Difícil / Atenção / Tranquilo, as horas de chuva e a ordem ("Chame mais motoboys para o jantar"). Difícil = chance ≥ 60% e ≥ 0,5 mm na hora, ou ≥ 2 mm. Véspera de feriado também pede reforço.
- Cartão: o garantido mostra só Sim / Não e uma linha com o motivo (até 15 min de atraso: tem garantido e refeição).
- Aba Escala: o Jaison põe e tira motoboy, até 30 dias à frente. Banco ERP: `escala_dia(p_dia)`, `escala_mexer(...)` (só quem passa em `pode_ver_garantido()`), tabela `escala_ajuste` (guarda quem mexeu) e `escala_aplicar_ajustes(dias)`, que `chegada_copia_receber` chama depois de cada cópia automática, para o ajuste não se perder.
- Cópia automática: robô `erp-chegada-copia` no banco pessoal (a cada 5 min, 10h–2h) manda fila, pátio e escala (sem observações). Cópia de segurança da escala: `_bkp_motoboy_escala_20_11_jaison` (1647 linhas).
