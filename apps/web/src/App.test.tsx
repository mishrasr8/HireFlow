/**
 * Application shell tests.
 *
 * The network is mocked at `fetch`, which is the true boundary of the frontend
 * system. Mocking the `apiClient` module instead would leave the request
 * building, the error handling and the response validation untested -- and those
 * are exactly the parts most likely to be wrong. Stubbing `fetch` means these
 * tests cover the client and the component together, while still depending on
 * no live service.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App.js';
import { jsonResponse, renderWithProviders } from './test/renderWithProviders.js';

/**
 * The shape of the global `fetch` this app uses.
 *
 * Declaring it explicitly matters: `vi.fn(async () => ...)` has no parameters,
 * so TypeScript infers `mock.calls` as `[][]` and every assertion on the
 * arguments becomes a type error. Naming the real signature keeps the mock
 * honest about what it is standing in for.
 */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<unknown>;

const HEALTH_OK = {
  success: true,
  data: {
    service: 'hireflow-api',
    status: 'ok',
    timestamp: '2026-09-28T12:00:00.000Z',
    uptimeSeconds: 42.5,
    database: 'connected',
  },
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('application shell', () => {
  it('renders the product name and tagline', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(HEALTH_OK))),
    );

    renderWithProviders(<App />);

    // A top-level `<header>` maps to the `banner` landmark role. The product
    // name is brand text, not a section heading, so it is asserted as content
    // of the landmark rather than as a heading.
    expect(screen.getByRole('banner')).toHaveTextContent('Hireflow');
    expect(
      screen.getByRole('heading', { name: 'Engineering Hiring Platform' }),
    ).toBeInTheDocument();
  });
});

describe('frontend to backend communication', () => {
  it('calls GET /api/health on the configured base URL', async () => {
    const fetchMock = vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(HEALTH_OK)));
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<App />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // The base URL comes from the env module, which the test setup pins. The
    // path and the credentials mode are what this test is really about.
    const [url, init] = fetchMock.mock.calls[0] ?? [];

    expect(url).toBe('http://localhost:4000/api/health');
    expect(init?.method).toBe('GET');
    // Phase 0 D-011 authenticates with a cookie, so credentials are sent.
    expect(init?.credentials).toBe('include');
  });

  it('shows a checking state before the API answers', () => {
    // A request that never settles keeps the query pending. It rejects on abort
    // so that unmounting the component cleans up promptly instead of leaving a
    // ten-second timer behind.
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );

    renderWithProviders(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('Checking the API...');
  });

  it('shows connected with the details from the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(HEALTH_OK))),
    );

    renderWithProviders(<App />);

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('hireflow-api')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('reports a degraded database as connected, because the API answered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(() =>
        Promise.resolve(
          jsonResponse({
            ...HEALTH_OK,
            data: { ...HEALTH_OK.data, status: 'degraded', database: 'disconnected' },
          }),
        ),
      ),
    );

    renderWithProviders(<App />);

    // The distinction matters: the browser reached the API successfully, so
    // "Connected" is the truth. The database column reports the degradation.
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('degraded')).toBeInTheDocument();
    expect(screen.getByText('disconnected')).toBeInTheDocument();
  });

  it('shows unavailable with the API error message when the API returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(() =>
        Promise.resolve(
          jsonResponse(
            {
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: 'An unexpected error occurred',
                requestId: 'req-abc-123',
              },
            },
            500,
          ),
        ),
      ),
    );

    renderWithProviders(<App />);

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent('Unavailable');
    // The correlation id is surfaced to the user, which is the whole reason the
    // API bothers to send one.
    expect(alert).toHaveTextContent('An unexpected error occurred');
    expect(alert).toHaveTextContent('req-abc-123');
  });

  it('shows unavailable when the request cannot be made at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(() => {
        throw new TypeError('Failed to fetch');
      }),
    );

    renderWithProviders(<App />);

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent('Unavailable');
    expect(alert).toHaveTextContent('The API could not be reached.');
  });

  it('refuses to render a 200 response that does not match the contract', async () => {
    // Exactly the failure TypeScript cannot catch: the server said 200 and sent
    // something that is not the agreed shape.
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(() =>
        Promise.resolve(jsonResponse({ success: true, data: { status: 'fine' } })),
      ),
    );

    renderWithProviders(<App />);

    const alert = await screen.findByRole('alert');

    expect(alert).toHaveTextContent('Unavailable');
    expect(alert).toHaveTextContent('unexpected response shape');
  });
});

describe('routing', () => {
  it('renders the not-found page for an unknown path', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(HEALTH_OK))),
    );

    renderWithProviders(<App />, '/no-such-page');

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('navigates back home from the not-found page', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchLike>(() => Promise.resolve(jsonResponse(HEALTH_OK))),
    );

    renderWithProviders(<App />, '/no-such-page');

    await user.click(screen.getByRole('link', { name: 'Back to the start' }));

    expect(
      screen.getByRole('heading', { name: 'Engineering Hiring Platform' }),
    ).toBeInTheDocument();
  });
});
