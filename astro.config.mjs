// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://allanmontilla.dev',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
});
