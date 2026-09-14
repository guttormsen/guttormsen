/**
 * ESLint-oppsett. Prosjektet har ingen byggesteg, så konfigurasjonen står på
 * egne bein uten å trekke inn delte regelpakker.
 */
const browser = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  fetch: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  requestAnimationFrame: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  Blob: 'readonly',
  FileReader: 'readonly',
  Intl: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  confirm: 'readonly',
  alert: 'readonly',
  Node: 'readonly',
  getComputedStyle: 'readonly',
  structuredClone: 'readonly',
  Event: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  /** Leaflet, lastet som globalt skript fra vendor/. */
  L: 'readonly',
};

const serviceWorker = {
  self: 'readonly',
  caches: 'readonly',
  clients: 'readonly',
};

const node = {
  process: 'readonly',
  Buffer: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  fetch: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  Intl: 'readonly',
};

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-implicit-globals': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  'no-constant-condition': ['error', { checkLoops: false }],
};

export default [
  { ignores: ['vendor/**', 'node_modules/**', 'test/e2e/shots/**', 'lykkeglasset/**'] },
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browser },
    rules,
  },
  {
    files: ['sw.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...browser, ...serviceWorker } },
    // En service worker ér et globalt skript; funksjoner på toppnivå hører hjemme der.
    rules: { ...rules, 'no-implicit-globals': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', 'test/*.test.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: node },
    rules,
  },
  {
    // Røyktesten kjører Node, men sender også kode inn i nettleseren via evaluate().
    files: ['test/e2e/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...node, ...browser } },
    rules,
  },
];
