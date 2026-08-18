import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { OptionalClerkProvider } from "@/components/providers/clerk-provider";
import { ClerkFirebaseBridge } from "@/components/providers/clerk-firebase-bridge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SITE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name}: ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name}: ${SITE.tagline}`,
    description: SITE.description,
    url: SITE.url,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name}: ${SITE.tagline}`,
    description: SITE.description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-dvh`}
    >
      <body
        className="h-dvh bg-background text-foreground font-sans antialiased"
        suppressHydrationWarning
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <OptionalClerkProvider>
              <AuthProvider>
                <ClerkFirebaseBridge />
                <TooltipProvider delay={200}>
                  {children}
                  <Toaster richColors closeButton expand={false} visibleToasts={4} position="bottom-right" />
                </TooltipProvider>
              </AuthProvider>
            </OptionalClerkProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
