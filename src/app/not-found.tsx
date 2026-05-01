import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Compass className="h-8 w-8" />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">404</h1>
      <p className="mt-2 text-base font-medium">Page not found</p>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="mt-6">
        <Button nativeButton={false} render={<Link href="/dashboard">Back to dashboard</Link>} />
      </div>
    </div>
  );
}
