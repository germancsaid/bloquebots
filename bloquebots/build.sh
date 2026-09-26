#!/bin/sh
# Une las partes en un solo archivo HTML
cd "$(dirname "$0")"
cat src/1-head.html src/2-world.js src/3-scene.js src/3b-maps.js src/4-game.js src/4b-picker.js src/4c-builder.js src/5-ai.js src/5b-war.js src/6-loop.js src/7-end.html > index.html
# Copia local con esqueleto completo para probar en el navegador
{ printf '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n'; cat index.html; printf '\n</body></html>\n'; } > preview.html
