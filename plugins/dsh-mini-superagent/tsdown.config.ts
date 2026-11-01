import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024', dts: true, clean: true,
    fixedExtension: false,
    deps: { neverBundle: [/^@deepseek-ai\//, 'zod', 'proper-lockfile'] },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false,
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-mini-superagent", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
