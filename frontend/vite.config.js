import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['nectiq.xyz'],
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
