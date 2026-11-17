#!/data/data/com.termux/files/usr/bin/bash
# Instala/atualiza o programa do totem DENTRO do JOOG (Android + Termux). Pode rodar de novo quantas vezes quiser.
# Nao tem senha nem segredo aqui. Modo atual: DEMONSTRACAO (pagamento simulado, loja falsa).
PASTA_TROCA=/sdcard/Download/cdm-totem
LOG=$PASTA_TROCA/instalar.log
mkdir -p "$PASTA_TROCA"
exec > >(tee "$LOG") 2>&1
echo "== inicio $(date)"
export DEBIAN_FRONTEND=noninteractive
yes | pkg update -y -o Dpkg::Options::=--force-confnew || echo "aviso: pkg update"
pkg install -y -o Dpkg::Options::=--force-confnew nodejs-lts git termux-api || { echo "== ERRO ao instalar node"; exit 1; }
DIR=$HOME/cdm-totem
REPO=https://github.com/cidadaodomundo-erp/cidadaodomundo-erp.github.io.git
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin totem-app-jog && git -C "$DIR" reset --hard FETCH_HEAD
else
  git clone --depth 1 --branch totem-app-jog --filter=blob:none --sparse "$REPO" "$DIR" && git -C "$DIR" sparse-checkout set totem
fi || { echo "== ERRO ao baixar o codigo"; exit 1; }
echo "versao: $(git -C "$DIR" log --oneline -1)"
echo "node: $(node -v)"
mkdir -p "$HOME/.termux/boot"
cp "$DIR/totem/app/android/ligar-totem.sh" "$HOME/.termux/boot/ligar-totem.sh"
chmod +x "$HOME/.termux/boot/ligar-totem.sh"
bash "$HOME/.termux/boot/ligar-totem.sh"
sleep 6
curl -s -o /dev/null -w "teste do servidor: HTTP %{http_code}\n" http://127.0.0.1:4660/api/hml/config
echo "== fim $(date)"
