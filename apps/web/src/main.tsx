import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { App } from './App.js';
import './styles/index.css';

/**
 * Server state defaults.
 *
 * TanStack Query is included because the Phase 1 requirement is a *live* API
 * call, and hand-rolling `useEffect` + `useState` for that is how components end
 * up racing, double-fetching, and continuing to set state after unmount. The
 * library owns caching, deduplication, cancellation and background refetching.
 *
 * Zustand is deliberately *not* included. There is no application-wide client
 * state in Phase 1, and Phase 0 decision `DC-006` forbids adding a global store
 * without a demonstrated requirement. Adding a state library "just in case" is
 * how a codebase acquires invisible coupling between unrelated components.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Short: a health reading goes stale quickly, and serving a cached
      // "connected" while the API is down is actively misleading.
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      // One retry. More than that turns a 20-second API outage into a 40-second
      // blank screen, and a health indicator should give up and say so.
      retry: 1,
    },
  },
});

const container = document.getElementById('root');

if (container === null) {
  // A loud failure here beats React's default "cannot read properties of null".
  throw new Error('Cannot start Hireflow: no element with id "root" was found in index.html.');
}

createRoot(container).render(
  // StrictMode is not a setting; it is a correctness check. In development it
  // intentionally double-invokes render and effects to surface impure
  // components and missing cleanup. It has no effect on the production build.
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
