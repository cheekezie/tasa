import { Link } from 'react-router-dom';
import appRoutes from '@/routes/appRoutes';

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-grey-25 px-4 text-center">
      <div className="flex flex-col items-center gap-2">
        <span className="text-[clamp(4rem,20vw,6rem)] leading-none font-bold text-grey-50 select-none">
          404
        </span>
        <h1 className="text-display-title -mt-4 text-grey-800">Page not found</h1>
        <p className="text-body max-w-[320px] text-grey-400">
          The page you're looking for doesn't exist or has been moved.
        </p>
      </div>

      <Link
        to={appRoutes.HOME}
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        Back to Dashboard
      </Link>
    </main>
  );
}
