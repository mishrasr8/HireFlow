/**
 * The application shell.
 *
 * `main.tsx` owns the providers (router, query client) so that this component is
 * a pure description of the UI and can be rendered by a test with whatever
 * providers it needs.
 *
 * The catch-all route is real rather than decorative: a client-side router has no
 * server to return a 404 for an unknown path, so without it a mistyped URL would
 * silently render nothing.
 */
import { Route, Routes } from 'react-router-dom';

import { HomePage } from './pages/HomePage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

export function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <span aria-hidden="true" className="h-3 w-3 rounded-full bg-emerald-600" />
          <span className="text-lg font-semibold tracking-tight text-slate-900">Hireflow</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  );
}
