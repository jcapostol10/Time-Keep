import type { NextConfig } from "next";

const s3PublicUrl = process.env.S3_PUBLIC_URL ?? "http://localhost:9000/timekeep";
const s3Host = new URL(s3PublicUrl);

const nextConfig: NextConfig = {
  // Every screen is behind auth and tenant-scoped, so pages render dynamically.
  // Cache Components can be adopted later per route once there is static content.
  cacheComponents: false,
  reactStrictMode: true,
  // PDF exports launch Chromium: keep it out of the bundle, and trace its compressed
  // binary into the functions that print (the export route, the Exports page's retry).
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/w/[workspaceSlug]/reports/export": ["./node_modules/@sparticuz/chromium/bin/**"],
    "/w/[workspaceSlug]/reports/exports": ["./node_modules/@sparticuz/chromium/bin/**"],
  },
  images: {
    remotePatterns: [
      {
        protocol: s3Host.protocol.replace(":", "") as "http" | "https",
        hostname: s3Host.hostname,
        port: s3Host.port,
        pathname: `${s3Host.pathname.replace(/\/$/, "")}/**`,
      },
    ],
  },
  experimental: {
    serverActions: {
      // Avatar uploads are capped at 2 MB; leave room for multipart overhead.
      bodySizeLimit: "3mb",
    },
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
