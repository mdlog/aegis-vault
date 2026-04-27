import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { initSentry, Sentry } from './lib/sentry.js';
import { wagmiConfig } from './lib/wagmiConfig.js';
import ErrorFallback from './components/ErrorFallback.jsx';
import './index.css';
import './styles/editorial.css';
import './styles/whitepaper.css';
import App from './App.jsx';

initSentry();

const queryClient = new QueryClient();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <App />
          <Toaster
            theme="dark"
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{
              style: {
                background: 'rgba(15, 17, 22, 0.95)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                backdropFilter: 'blur(12px)',
                fontFamily: 'inherit',
              },
            }}
          />
        </QueryClientProvider>
      </WagmiProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
