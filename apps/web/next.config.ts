import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@portfolio-rebalancer/application",
    "@portfolio-rebalancer/broker",
    "@portfolio-rebalancer/broker-toss",
    "@portfolio-rebalancer/ui",
  ],
};

export default nextConfig;
