/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost'],
  },
  async rewrites() {
    return [
      {
        source: '/api/module3/:path*',
        destination: 'http://localhost:8002/:path*',
      },
    ]
  },
}

module.exports = nextConfig
