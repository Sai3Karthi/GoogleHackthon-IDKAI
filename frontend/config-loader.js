/**
 * Configuration loader for frontend
 * Reads config.ini from project root
 */
const fs = require('fs');
const path = require('path');

function parseIni(content) {
  const lines = content.split('\n');
  const config = {};
  let currentSection = null;

  for (let line of lines) {
    line = line.trim();
    
    // Skip comments and empty lines
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }

    // Section header
    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1);
      config[currentSection] = {};
      continue;
    }

    // Key-value pair
    if (currentSection && line.includes('=')) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=').trim();
      config[currentSection][key.trim()] = value;
    }
  }

  return config;
}

function loadConfig() {
  try {
    // Try to find config.ini in project root (parent of frontend folder)
    const configPath = path.join(__dirname, '..', 'config.ini');
    
    if (!fs.existsSync(configPath)) {
      console.warn('config.ini not found, using defaults');
      return getDefaults();
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const config = parseIni(content);

    return {
      orchestratorHost: config.orchestrator?.host || '127.0.0.1',
      orchestratorPort: parseInt(config.orchestrator?.port || '8000'),
      orchestratorServiceUrl: config.orchestrator?.service_url || null,
      module3Host: config.module3?.host || '127.0.0.1',
      module3Port: parseInt(config.module3?.port || '8002'),
      frontendHost: config.frontend?.host || 'localhost',
      frontendPort: parseInt(config.frontend?.port || '3000'),
      frontendServiceUrl: config.frontend?.service_url || null,
    };
  } catch (error) {
    console.error('Error loading config:', error);
    return getDefaults();
  }
}

function getDefaults() {
  return {
    orchestratorHost: '127.0.0.1',
    orchestratorPort: 8000,
    module3Host: '127.0.0.1',
    module3Port: 8002,
    frontendHost: 'localhost',
    frontendPort: 3000,
  };
}

module.exports = { loadConfig };
