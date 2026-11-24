import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Thai fonts are read from disk at request time by the PDF report route.
  outputFileTracingIncludes: { "/api/report": ["./assets/fonts/**"] },
  serverExternalPackages: ["@react-pdf/renderer"],
  partialPrefetching: true,
  // PREVIEW-ONLY (throwaway branch, never merged): read the dashboard's
  // public GET data from production so this preview shows real numbers.
  // Writes can't go through: the preview has no ENTRY_PASSWORD to log in.
  async rewrites() {
    return {
      beforeFiles: ["records", "tat", "kpi", "pm-machines", "service-points", "kpi-indicators"].map((p) => ({
        source: `/api/${p}`,
        destination: `https://brskpi.vercel.app/api/${p}`,
      })),
    };
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
