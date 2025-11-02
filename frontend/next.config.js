/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost'],
  },
  async rewrites() {
    return [
      {
        source: '/module3/:path*',
        destination: 'http://localhost:8000/module3/:path*',
      },
      {
        source: '/run/:path*',
        destination: 'http://localhost:8000/run/:path*',
      },
    ]
  },
}

module.exports = nextConfig
