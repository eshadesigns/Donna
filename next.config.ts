import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  serverExternalPackages: ["mongodb", "node-cron", "mongoose"],
};

export default nextConfig;
