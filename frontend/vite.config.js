import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [vue()],
  server: {
    port: 31201,
    strictPort: true,
  },
  // en el build de producción se eliminan console.* y debugger (en dev se mantienen)
  esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : {},
  // el worklet del master (helpers/master_dsp.worklet.js, importado con ?worker&url) tiene que quedar en
  // un solo archivo sin import/export (master_dsp.js adentro): standardized-audio-context (lo usa Tone)
  // descarga el fuente y lo envuelve en una función, así que no admite chunks compartidos ni export.
  // "iife" es el default de Vite 5; se deja explícito a propósito.
  worker: { format: 'iife' },
}))
