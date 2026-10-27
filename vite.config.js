import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (name) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  base: './',
  build: {
    target: 'chrome105',
    rollupOptions: {
      input: { main: page('./index.html'), overlay: page('./overlay.html'), edit: page('./edit.html'), recorder: page('./recorder.html'), pill: page('./pill.html') },
    },
  },
});
