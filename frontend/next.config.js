const { loadConfig } = require('./config-loader');

// Load configuration
const config = loadConfig();
const orchestratorUrl = `http://${config.orchestratorHost}:${config.orchestratorPort}`;

console.log(`[Next.js Config] Using orchestrator at: ${orchestratorUrl}`);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: [config.orchestratorHost, config.module3Host, config.frontendHost, 'localhost'],
  },
  async rewrites() {
    return [
      {
        source: '/module3/:path*',
        destination: `${orchestratorUrl}/module3/:path*`,
      },
      {
        source: '/run/:path*',
        destination: `${orchestratorUrl}/run/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
