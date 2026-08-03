// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['danfojs-node', 'better-sqlite3', 'cloudinary'],
  },
}

export default nextConfig
