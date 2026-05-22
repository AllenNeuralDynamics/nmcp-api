// hyparquet ships only an "import" export condition, so a CommonJS require() — which is
// what `await import(...)` compiles to under module: "commonjs" — cannot resolve it. This
// untranspiled ESM helper keeps a genuine dynamic import that resolves hyparquet's Node
// entry point at runtime, and that vitest can also evaluate natively.
export const loadHyparquet = () => import("hyparquet");
