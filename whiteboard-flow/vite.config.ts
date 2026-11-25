import { defineConfig } from 'vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.VITE_BASE_PATH ?? (repoName ? `/${repoName}/` : './');

export default defineConfig({
  base,
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    rolldownOptions: {
      external: ['canvas'],
    },
  },
});
