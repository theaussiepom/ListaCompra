import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

// Tres destinos de build según variables de entorno:
//  - GITHUB_PAGES=true → https://maestrea76.github.io/ListaCompra/  (base /ListaCompra)
//  - HA_PANEL=true     → servido por la integración HA en /tucompra_static/app
//  - (ninguna)         → dev local en la raíz
const isPages = process.env.GITHUB_PAGES === 'true';
const isHAPanel = process.env.HA_PANEL === 'true';

const base = isPages
  ? '/ListaCompra'
  : isHAPanel
    ? '/tucompra_static/app/'
    : undefined;

export default defineConfig({
  output: 'static',
  site: isPages ? 'https://maestrea76.github.io' : undefined,
  base,
  trailingSlash: 'ignore',
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
  },
});
