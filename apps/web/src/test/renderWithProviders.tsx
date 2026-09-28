/**
 * Test-only rendering helper.
 *
 * `main.tsx` composes the providers around `<App />`, but a test needs to inject
 * its own router (an in-memory one) and its own query client. Duplicating the
 * provider tree here is unavoidable; putting it in one function keeps the
 * duplication to one place.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

export function renderWithProviders(ui: ReactElement, initialPath = '/'): RenderResult {
  // A fresh client per render, so one test's cache can never satisfy another
  // test's query.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // No retries in tests: a failure should surface immediately, not after
        // backoff delays that make the suite slow and the failure obscure.
        retry: false,
        gcTime: 0,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {/*
        MemoryRouter rather than BrowserRouter. It keeps routing state in memory
        instead of mutating `window.history`, so tests cannot leak a URL into
        each other or depend on jsdom's URL implementation.
      */}
      <MemoryRouter initialEntries={[initialPath]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * A minimal stand-in for a `Response`.
 *
 * Only the three members `apiClient` actually reads are implemented. Building
 * the double this way -- rather than constructing a real `Response` -- keeps the
 * test independent of whether `Response` exists in the jsdom environment, and
 * makes the coupling to `apiClient` explicit.
 */
export function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    // Returns a promise rather than being an `async` function, because there is
    // nothing to await. The explicit return type is what makes the double
    // honest about satisfying the parts of `Response` the client relies on.
    json: (): Promise<unknown> => Promise.resolve(body),
  };
}
