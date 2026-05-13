import type { MetadataRoute } from "next";
import { absoluteUrl, SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/leads",
          "/pipeline",
          "/accounts",
          "/contacts",
          "/deals",
          "/activity",
          "/followups",
          "/tasks",
          "/inbox",
          "/notifications",
          "/team-chat",
          "/admin",
          "/settings",
          "/login",
          "/signup",
          "/forgot-password",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: SITE.url,
  };
}
