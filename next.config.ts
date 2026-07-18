import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Public launch capabilities are bearer credentials embedded in the path.
  // Suppress that path in Next's development request log; production access
  // logging must apply the equivalent exclusion at its hosting/proxy seam.
  logging: { incomingRequests: { ignore: [/^\/sales\/launch\//] } },
};

export default nextConfig;
