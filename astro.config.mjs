// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://allanmontilla.dev',
  output: 'static',
  integrations: [sitemap()],
  build: {
    inlineStylesheets: 'always',
  },
  vite: {
    plugins: [tailwindcss()],
    // Prevent LightningCSS from dropping -webkit-backdrop-filter (Safari)
    // when Astro’s default cssTarget resolves to empty targets.
    build: {
      cssTarget: ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4'],
    },
  },
});
