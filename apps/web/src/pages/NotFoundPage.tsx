import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
      <p className="text-slate-600">The address you followed does not exist in this application.</p>

      {/*
        A `Link`, not an `<a href="/">`. A router link does not reload the
        document, which is the entire reason a client-side router exists.
      */}
      <Link to="/" className="inline-block text-emerald-700 underline hover:no-underline">
        Back to the start
      </Link>
    </div>
  );
}
