import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Public launch capabilities are bearer credentials embedded in the path.
  // Disable framework request-path logging in both development and production;
  // application diagnostics are emitted explicitly at the route handler seam.
  logging: { incomingRequests: false },
};

export default nextConfig;
