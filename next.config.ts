import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone 只在 Docker 環境下啟用，Vercel/CF Pages 不需要
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // 不讓 Next.js 嘗試 bundle playwright（有 native binary，不能 bundle）
  serverExternalPackages: ['playwright'],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
