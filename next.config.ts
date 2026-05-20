import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  serverExternalPackages: ["@playwright/test", "playwright", "playwright-core"],
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@playwright/**",
      "node_modules/playwright/**",
      "node_modules/playwright-core/**",
      ".cache/ms-playwright/**",
    ],
  },
};

export default nextConfig;
