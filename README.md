# looper

Reproductor de loops aleatorio. Subís loops de audio, los agrupás en **Track Groups** (pistas que
suenan en paralelo) y les ponés **Tags** (secciones). Al darle START, cada pista va eligiendo loops
al azar compatibles con el Tag activo, sincronizados a un tempo, y el Tag cambia cada 2^n tiempos.

- Backend: Node.js + Express + SQLite (knex) + Redis (sesiones) + ffmpeg
- Frontend: Vue 3 + Vite + Element Plus + Tone.js

## Puesta en marcha

Requisitos: Node 24 (`.nvmrc`), Redis, ffmpeg. El frontend debe correr en el puerto 31201 (debe coincidir con `cors_origin` del backend).

```bash
cd backend
npm install
cp .env.example .env      # completar rutas y Redis
node index.js

cd ../frontend
npm install
echo "VITE_APP_BACKEND=http://localhost:31200" > .env.local
npm run dev               # http://localhost:31201
```

Build de producción: `npm run build_prd` (usa `frontend/.env.prd`).

Los usuarios se crean a mano en la tabla `users` (password con hash bcrypt, ver `AGENTS.md`).

## Documentación

- [`AGENTS.md`](AGENTS.md): guía para mantener el proyecto con asistentes de IA (y resumen útil para humanos).
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): arquitectura, modelo de datos, motor de reproducción.
- [`docs/API.md`](docs/API.md): endpoints.
- [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md): bugs y deuda técnica conocidos.
