import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No ESLint config wired up yet; don't block builds on it.
  eslint: { ignoreDuringBuilds: true },
  // react-force-graph-2d (graph view) ships ESM and pulls force-graph + d3-*;
  // transpile it so Next's build doesn't choke on the package's ESM/interop.
  transpilePackages: ["react-force-graph-2d"],
};

export default nextConfig;
