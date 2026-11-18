#!/data/data/com.termux/files/usr/bin/sh
# Liga o programa do totem (roda sozinho quando o JOOG liga, via Termux:Boot).
termux-wake-lock 2>/dev/null
cd "$HOME/cdm-totem/totem/app" || exit 1
pkill -f "bin/start-demo.js" 2>/dev/null
sleep 1
nohup node bin/start-demo.js --porta 4660 >> "$HOME/totem.log" 2>&1 &
# espera o servidor responder e abre a tela do totem no Chrome
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  curl -s -o /dev/null http://127.0.0.1:4660/api/hml/config && break
  sleep 2
done
am start -a android.intent.action.VIEW -d "http://127.0.0.1:4660/" -n com.android.chrome/com.google.android.apps.chrome.Main >/dev/null 2>&1
