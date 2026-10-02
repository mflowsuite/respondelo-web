# respondelo.app

La web de Respondelo: un solo `index.html` estático en GitHub Pages, con el
dominio `respondelo.app` en Cloudflare (registros A a GitHub Pages, en gris).

- El formulario de demo lo recibe el Worker `respondelo-contacto`
  (`worker/worker.js`). Está armado igual que el de recompensalo.com: ver
  `FORMULARIO.md` en el repo `recompensalo-web`.
- Los pedidos se leen en https://respondelo-contacto.mflowsuite.workers.dev/panel
  con la clave `RESPONDELO_CONTACTOS_TOKEN` del archivo de credenciales.
- La marca (logo, colores, animación) sale de `docs/marca-respondelo.md` del
  repo del chatbot.
