/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  // Static export for Cloudflare Workers Assets: `next build` emits a
  // pre-rendered `out/` dir wrangler can serve directly. App is fully
  // client-side ('use client' + localStorage) so SSR isn't needed.
  output: 'export',
  // Image optimization is server-side — disable for static export.
  images: { unoptimized: true },
  // Trailing slash so routes resolve to /path/index.html on the assets
  // handler (matches Cloudflare's default).
  trailingSlash: true,
};
module.exports = nextConfig;
