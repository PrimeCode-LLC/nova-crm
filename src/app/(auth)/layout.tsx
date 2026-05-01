import { APP_NAME } from "@/lib/constants";
import { Zap, Sparkles } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-12">
      <div className="mb-8 flex flex-col items-center gap-3">
        <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/30">
          <Zap className="h-6 w-6" />
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 ring-2 ring-background">
            <Sparkles className="h-2.5 w-2.5 text-white" />
          </span>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Multi-channel sales ops, finally sane.
          </p>
        </div>
      </div>
      <div className="w-full max-w-sm rounded-xl border bg-card shadow-xl shadow-black/10 p-6">
        {children}
      </div>
    </div>
  );
}
