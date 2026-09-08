import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: {
    name: 'Yomii',
    description: 'Highlights parts of speech on Japanese pages so you can skim faster.',
    action: { default_title: 'Yomii' },
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
