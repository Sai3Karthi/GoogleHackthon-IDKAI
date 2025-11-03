// Check if we're in production (Vercel) or development (local)
const isProduction = process.env.NODE_ENV === 'production';
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

let orchestratorUrl;

if (isProduction && apiUrl) {
  // Production: Use environment variable
  orchestratorUrl = apiUrl;
  console.log(`[Next.js Config] Production mode - Using API URL: ${orchestratorUrl}`);
} else {
  // Development: Use local config
  try {
    const { loadConfig } = require('./config-loader');
    const config = loadConfig();
    orchestratorUrl = `http://${config.orchestratorHost}:${config.orchestratorPort}`;
    console.log(`[Next.js Config] Development mode - Using orchestrator at: ${orchestratorUrl}`);
  } catch (error) {
    // Fallback for production build without config-loader
    orchestratorUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    console.log(`[Next.js Config] Fallback mode - Using: ${orchestratorUrl}`);
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    proxyTimeout: 18000000,
  },
  images: {
    domains: ['localhost', '127.0.0.1'],
    remotePatterns: [
      {
        protocol: 'http',
        hostname: '**',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/module1/:path*',
        destination: `${orchestratorUrl}/module1/:path*`,
      },
      {
        source: '/module2/:path*',
        destination: `${orchestratorUrl}/module2/:path*`,
      },
      {
        source: '/module3/:path*',
        destination: `${orchestratorUrl}/module3/:path*`,
      },
      {
        source: '/module4/:path*',
        destination: `${orchestratorUrl}/module4/:path*`,
      },
      {
        source: '/run/:path*',
        destination: `${orchestratorUrl}/run/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
