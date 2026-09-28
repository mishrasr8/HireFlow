import { ApiStatusCard } from '../components/ApiStatusCard.js';

export function HomePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Engineering Hiring Platform
        </h1>
        <p className="mt-2 text-slate-600">
          Phase 1 establishes the engineering foundation. Product features arrive in later phases.
        </p>
      </div>

      <ApiStatusCard />
    </div>
  );
}
