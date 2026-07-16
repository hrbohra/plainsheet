/** @type {import('next').NextConfig} */
const nextConfig = {
  // transformers.js and pg are server-only native-ish deps; keep them external
  experimental: { serverComponentsExternalPackages: ['@xenova/transformers', 'pg', 'pino'] },
};
export default nextConfig;
