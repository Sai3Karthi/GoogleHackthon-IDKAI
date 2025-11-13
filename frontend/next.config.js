const fs = require('fs');
const path = require('path');

function hydrateEnvFallback() {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return;
  }

  const envCandidates = ['.env.production', '.env.local', '.env'];
  for (const filename of envCandidates) {
    const envPath = path.join(__dirname, filename);
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const [key, ...valueParts] = line.split('=');
      if (key !== 'NEXT_PUBLIC_API_URL') {
        continue;
      }

      const value = valueParts.join('=').trim();
      if (value) {
        process.env.NEXT_PUBLIC_API_URL = value;
        console.log(`[Next.js Config] Loaded NEXT_PUBLIC_API_URL from ${filename}`);
        return;
      }
    }
  }
}

hydrateEnvFallback();

// Check if we're in production (Vercel) or development (local)
const isProduction = process.env.NODE_ENV === 'production';
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

let cachedConfig = undefined;
const loadConfigSafe = () => {
  if (cachedConfig !== undefined) {
    return cachedConfig;
  }
  try {
    const { loadConfig } = require('./config-loader');
    cachedConfig = loadConfig();
    return cachedConfig;
  } catch (error) {
    console.warn(`[Next.js Config] Unable to load config.ini: ${error.message}`);
    cachedConfig = null;
    return cachedConfig;
  }
};

const config = loadConfigSafe();

function resolveOrchestratorUrl() {
  // Check if USE_LOCAL_ORCHESTRATOR flag is set
  const useLocal = process.env.USE_LOCAL_ORCHESTRATOR === 'true';
  
  if (useLocal) {
    // Force local orchestrator
    const localUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
    console.log(`[Next.js Config] USE_LOCAL_ORCHESTRATOR=true, using: ${localUrl}`);
    return localUrl.replace(/\/+$/, '');
  }
  
  const envFallbacks = [
    process.env.NEXT_PUBLIC_API_URL,
    process.env.ORCHESTRATOR_SERVICE_URL,
    process.env.DEPLOYED_BACKEND_URL,
  ].filter(Boolean);

  if (envFallbacks.length > 0) {
    const url = envFallbacks[0].replace(/\/+$/, '');
    console.log(`[Next.js Config] Using orchestrator URL from env: ${url}`);
    return url;
  }

  if (config?.orchestratorServiceUrl) {
    const url = config.orchestratorServiceUrl.replace(/\/+$/, '');
    console.log(`[Next.js Config] Using orchestrator URL from config.ini: ${url}`);
    return url;
  }

  if (config) {
    const url = `http://${config.orchestratorHost}:${config.orchestratorPort}`;
    console.log(`[Next.js Config] Using orchestrator host/port fallback: ${url}`);
    return url;
  }

  const url = (apiUrl || 'http://localhost:8000').replace(/\/+$/, '');
  console.log(`[Next.js Config] Using default orchestrator URL: ${url}`);
  return url;
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
    const orchestratorUrl = resolveOrchestratorUrl();
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
