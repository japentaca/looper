// Configuración de pm2 para el backend en el servidor (ver "Producción (pm2)" en docs/ARCHITECTURE.md).
// Es .cjs porque el backend es ESM ("type": "module") y pm2 carga este archivo con require.
// Sin secretos: index.js los lee de backend/.env del servidor, que dotenv busca en el directorio
// de trabajo; por eso cwd tiene que ser el backend del clon.
// Se arranca una sola vez como el usuario looper (nunca como root):
//   pm2 start /var/lib/looper/looper/backend/ecosystem.config.cjs && pm2 save
// y después se reinicia siempre con `systemctl restart pm2-looper`.
module.exports = {
  apps: [
    {
      name: "looper",
      cwd: "/var/lib/looper/looper/backend",
      script: "index.js",
      // Una sola instancia en modo fork: el token de subida por usuario y la cola de conversión
      // viven en memoria del proceso; con cluster o varias instancias dejarían de valer.
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      // El VPS tiene 1,9 GB de RAM compartidos con carrillion, Redis y nginx. El backend en reposo
      // ocupa bastante menos; las subidas van a archivos temporales y ffmpeg corre en otro proceso
      // (no cuenta acá). Si pasa este tope, pm2 lo reinicia (corta una conversión en curso).
      max_memory_restart: "400M",
      // Si se cae al arrancar (por ejemplo, Redis caído o falta session_secret), no reintentar en
      // un bucle cerrado: espera creciente entre reinicios.
      exp_backoff_restart_delay: 1000,
      time: true, // fecha y hora en cada línea de log (~/.pm2/logs del usuario looper)
      env: {
        NODE_ENV: "production",
      },
    },
  ],
}
