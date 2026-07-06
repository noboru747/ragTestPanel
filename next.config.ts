import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone 只在 Docker 環境下啟用，Vercel 不需要
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
};

export default nextConfig;
