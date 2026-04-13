import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/*': ['./node_modules/jsdom/lib/jsdom/browser/**/*'],
  },
  reactCompiler: true,
  transpilePackages: ['jsdom', 'html-encoding-sniffer', '@exodus/bytes'],
};

export default nextConfig;
