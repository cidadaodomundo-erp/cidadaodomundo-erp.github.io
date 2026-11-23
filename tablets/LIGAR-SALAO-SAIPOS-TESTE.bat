@echo off
chcp 65001 >nul
title Servidor do salao - TESTE + loja TESTE do Saipos
if "%CONNECTOR_ENV_PATH%"=="" set "CONNECTOR_ENV_PATH=%USERPROFILE%\Documents\Codex\2026-11-10\j-vou-fazer-mais-uma-pergunta\work\private-saipos\.env"
if not exist "%CONNECTOR_ENV_PATH%" (
  echo Nao achei a configuracao privada da loja TESTE do Saipos em:
  echo   %CONNECTOR_ENV_PATH%
  echo Ela e a mesma do totem. Nada foi ligado.
  pause
  exit /b 1
)
echo Ligando o servidor do salao + loja TESTE do Saipos (pedido vai como ficha)...
echo Se o Windows perguntar sobre o Firewall, clique em "Permitir acesso" (rede privada).
echo.
node "%~dp0servidor\bin\start-salao.js" --sandbox --rede %*
echo.
echo O servidor parou. Feche esta janela.
pause
