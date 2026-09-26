# Bloquebots

Juego 3D de robots hechos de bloques de madera (tipo Jenga) con un dado como piloto. Hecho con Three.js y cannon-es, sin instalar nada.

## Jugar (y jugar en red)

```bash
npm install     # solo la primera vez
npm start
```

- En este ordenador: http://localhost:8080
- En otra PC de tu Wi-Fi: http://IP-DE-ESTE-MAC:8080 (el servidor muestra la IP al arrancar)
- Desde otra red (internet): en otra terminal `npm run tunnel` y comparte el link `https://….trycloudflare.com` que aparece.

En el menú: **Jugar en red** → uno crea la partida (elige Rojo o Azul y el mapa) y el otro se une con el código de 4 letras.
El que crea la partida calcula la física; el otro recibe el estado 30 veces por segundo.

## Estructura

- `src/`: el código, dividido por partes (se juntan en orden):
  - `1-head.html`: estilos, menú y pantallas
  - `2-world.js`: render, texturas y física básica
  - `3-scene.js`: bloques, robots, ventilador y miniaturas
  - `3b-maps.js`: mapas (mesa, obstáculos, luz)
  - `4-game.js`: partida por turnos, mira de precisión y caminar
  - `4b-picker.js`: elegir robots y mapa
  - `4c-builder.js`: Taller para diseñar robots
  - `5-ai.js`: rival de la computadora
  - `5b-war.js`: modo Guerra total (sin turnos)
  - `5c-net.js`: multijugador en red (salas, sincronización)
  - `6-loop.js`: cámara, controles y bucle principal
- `server.js`: servidor (sirve el juego y conecta a los jugadores por WebSocket).
- `build.sh`: junta todo en `index.html` (la versión que se publica) y `preview.html` (para probar en local).

Después de cambiar algo en `src/`, ejecuta `./build.sh`.

Los robots guardados en el Taller viven en el navegador (localStorage).
