import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Prevent "Invalid hook call" errors when a dependency hoists its own copy
  // of react/react-dom. Forcing dedupe at resolution time means the app
  // always uses the top-level React, regardless of what child packages
  // might try to pull in.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  // Pre-bundle the wallet stack + markdown ESM packages at startup so Vite
  // does not re-optimize mid-session. Mid-session re-optimization produces a
  // new browserHash, which leaves already-loaded modules referencing the old
  // hash — two wagmi instances → two React Contexts → useContext returns null
  // and every wagmi hook crashes with "Invalid hook call".
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-markdown',
      'remark-gfm',
      'wagmi',
      'wagmi/connectors',
      'viem',
      '@rainbow-me/rainbowkit',
      '@tanstack/react-query',
    ],
  },
  server: {
    host: '0.0.0.0',
    // Leading dot allows the apex domain plus every subdomain (docs.*, etc.)
    allowedHosts: ['nectiq.xyz', '.aegisvaults.xyz'],
  },
  build: {
    // Raise the warning threshold — wagmi + viem + recharts are heavy by nature.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep manual chunks minimal to avoid circular-import issues.
        // Only split the truly independent heavy stacks.
        manualChunks(id) {
          if (id.includes('node_modules/recharts')) return 'charts';
          if (
            id.includes('node_modules/wagmi') ||
            id.includes('node_modules/viem') ||
            id.includes('node_modules/@rainbow-me') ||
            id.includes('node_modules/@tanstack')
          ) {
            return 'wallet-stack';
          }
          if (id.includes('node_modules/framer-motion')) return 'animations';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    setupFiles: ['./src/test/setup.js'],
  },
})
