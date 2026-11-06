import { Link } from "react-router-dom";
import { Button } from "@/shared/ui/button";

export default function ForbiddenPage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="text-sm font-semibold text-primary">403</p>
      <h1 className="text-xl font-semibold text-grey-800">Your role can't open this page</h1>
      <p className="max-w-md text-sm text-grey-400">Ask a super admin if you need access.</p>
      <Button asChild variant="outline">
        <Link to="/">Back to the dashboard</Link>
      </Button>
    </div>
  );
}
