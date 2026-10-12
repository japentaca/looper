import js from "@eslint/js"
import globals from "globals"
import stylistic from "@stylistic/eslint-plugin"

// Sin Prettier: solo las reglas de estilo que el código ya respeta (sin punto y coma, 2 espacios).
// No se usa la regla camelcase: el proyecto usa snake_case.
export default [
  { ignores: ["node_modules/", "tmp/"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/semi": ["warn", "never"],
      "@stylistic/indent": ["warn", 2],
      "no-unused-vars": ["warn", { args: "none" }],
    },
  },
]
