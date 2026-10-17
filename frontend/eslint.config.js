import js from "@eslint/js"
import globals from "globals"
import pluginVue from "eslint-plugin-vue"
import stylistic from "@stylistic/eslint-plugin"

// Sin Prettier: solo las reglas de estilo que el código ya respeta (sin punto y coma, 2 espacios).
// No se usa la regla camelcase: el proyecto usa snake_case.
// "flat/essential" de vue detecta errores sin imponer formato en los templates.
export default [
  { ignores: ["node_modules/", "dist/"] },
  js.configs.recommended,
  ...pluginVue.configs["flat/essential"],
  {
    files: ["**/*.js", "**/*.vue"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/semi": ["warn", "never"],
      "@stylistic/indent": ["warn", 2],
      "no-unused-vars": ["warn", { args: "none" }],
      // los nombres de componentes son de una palabra (Tracks, Files, Tag...)
      "vue/multi-word-component-names": "off",
    },
  },
  // AudioWorkletGlobalScope (sampleRate, currentTime, registerProcessor, AudioWorkletProcessor...)
  {
    files: ["**/*.worklet.js"],
    languageOptions: { globals: { ...globals.audioWorklet } },
  },
]
