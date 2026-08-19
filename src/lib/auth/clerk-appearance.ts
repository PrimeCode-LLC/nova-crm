/**
 * Maps Clerk prebuilt UIs onto Nova's shadcn tokens so SignIn/SignUp
 * sit inside the auth shell without a second nested card.
 */
export const clerkAppearance = {
  cssLayerName: "clerk",
  variables: {
    colorPrimary: "var(--primary)",
    colorForeground: "var(--foreground)",
    colorBackground: "transparent",
    colorMutedForeground: "var(--muted-foreground)",
    colorDanger: "var(--destructive)",
    colorSuccess: "var(--success)",
    colorWarning: "var(--warning)",
    colorNeutral: "var(--muted-foreground)",
    colorInput: "var(--input)",
    borderRadius: "0.625rem",
    fontFamily: "var(--font-sans)",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full bg-transparent shadow-none",
    card: "w-full bg-transparent p-0 shadow-none ring-0 border-0",
    headerTitle: "text-xl font-semibold tracking-tight text-foreground",
    headerSubtitle: "text-sm text-muted-foreground",
    socialButtonsBlockButton:
      "border-border bg-background text-foreground hover:bg-muted",
    formButtonPrimary:
      "bg-primary text-primary-foreground shadow-none hover:bg-primary/80",
    footer: "bg-transparent",
    footerActionLink: "text-primary hover:text-primary/80",
  },
};
