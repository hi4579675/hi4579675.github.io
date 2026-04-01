import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightBlog from 'starlight-blog';

export default defineConfig({
  site: 'https://hi4579675.github.io',
  integrations: [
    starlight({
      title: 'hanna.log',
      plugins: [starlightBlog()],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/hi4579675' },
      ],
      sidebar: [
        { label: 'Docs', autogenerate: { directory: 'docs' } },
      ],
      customCss: ['./src/styles/custom.css'],
      components: {
        Header: './src/components/Header.astro',
      },
    }),
  ],
});