import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightBlog from 'starlight-blog';

// ──────────────────────────────────────────────────────────────
// remark plugin: ```mermaid 코드 블록 → <div class="mermaid"> 로 변환
// (Shiki 하이라이팅을 우회하고 클라이언트 mermaid.js가 렌더하게)
// ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function remarkMermaid() {
  return (tree) => {
    function walk(node, parent, index) {
      if (
        node && node.type === 'code' && node.lang === 'mermaid'
        && parent && typeof index === 'number'
      ) {
        parent.children[index] = {
          type: 'html',
          value: '<div class="mermaid">' + escapeHtml(node.value || '') + '</div>',
        };
        return;
      }
      if (node && Array.isArray(node.children)) {
        node.children.forEach((child, i) => walk(child, node, i));
      }
    }
    walk(tree);
  };
}

// ──────────────────────────────────────────────────────────────
// Client-side mermaid bootstrap
// - 페이지에 .mermaid 가 있을 때만 mermaid.js 동적 import
// - 테마(data-theme) 변경 시 자동 재렌더
// - Astro 클라이언트 라우팅(astro:after-swap) 대응
// ──────────────────────────────────────────────────────────────
const mermaidBootstrap = `
(function(){
  let mermaidPromise;
  async function loadMermaid() {
    if (!mermaidPromise) {
      mermaidPromise = import('https://esm.sh/mermaid@11').then(m => m.default);
    }
    return mermaidPromise;
  }
  async function renderAll(force) {
    const all = document.querySelectorAll('div.mermaid');
    if (all.length === 0) return;
    const targets = [];
    all.forEach((el) => {
      if (!el.hasAttribute('data-source')) {
        el.setAttribute('data-source', el.textContent.trim());
      }
      if (force || !el.hasAttribute('data-processed')) {
        if (force) {
          el.innerHTML = el.getAttribute('data-source');
          el.removeAttribute('data-processed');
        }
        targets.push(el);
      }
    });
    if (targets.length === 0) return;
    const mermaid = await loadMermaid();
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily: 'JetBrains Mono, Noto Sans KR, monospace',
    });
    try {
      await mermaid.run({ nodes: targets });
      targets.forEach(el => el.setAttribute('data-processed', '1'));
    } catch(e) { console.error('mermaid render error', e); }
  }
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => renderAll(false));
    } else { renderAll(false); }
  }
  init();
  document.addEventListener('astro:after-swap', () => renderAll(false));
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'attributes' && m.attributeName === 'data-theme') {
        renderAll(true);
        break;
      }
    }
  });
  obs.observe(document.documentElement, { attributes: true });
})();
`;

export default defineConfig({
  site: 'https://hi4579675.github.io',
  markdown: {
    remarkPlugins: [remarkMermaid],
  },
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
      head: [
        {
          tag: 'script',
          content: `(function(){var t=localStorage.getItem('theme')||localStorage.getItem('starlight-theme');if(t){document.documentElement.setAttribute('data-theme',t)}})()`,
        },
        {
          tag: 'script',
          content: mermaidBootstrap,
        },
      ],
    }),
  ],
});
