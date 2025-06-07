/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Eliminamos transpilePackages para evitar el conflicto
  experimental: {
    // Mantenemos serverComponentsExternalPackages para @upstash/redis
    serverComponentsExternalPackages: ["@upstash/redis"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
