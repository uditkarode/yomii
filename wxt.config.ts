import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Yomii',
    description: 'Highlights parts of speech on Japanese pages so you can skim faster.',
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      64: 'icon/64.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
      256: 'icon/256.png',
    },
    action: {
      default_title: 'Yomii',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
      },
    },
    permissions: ['storage'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    browser_specific_settings: {
      gecko: {
        id: '{6e8a8f0a-8cee-4f39-af37-dad80d1b6b15}',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
});
