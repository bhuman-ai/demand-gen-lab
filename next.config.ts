import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async redirects() {
    return [
      {
        source: "/projects",
        destination: "/brands",
        permanent: true,
      },
      {
        source: "/projects/:path*",
        destination: "/brands/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
