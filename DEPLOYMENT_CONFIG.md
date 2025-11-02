# Deployment Configuration Guide

## Overview
All hardcoded IP addresses and ports have been replaced with a centralized configuration system using `config.ini`. This makes deployment to different environments simple - just edit one file!

## Configuration File: `config.ini`

Located at project root: `GoogleHackthon-IDKAI/config.ini`

```ini
[orchestrator]
host = 127.0.0.1
port = 8000

[module3]
host = 127.0.0.1
port = 8002

[frontend]
host = localhost
port = 3000
```

## Deployment Scenarios

### Local Development (Current Setup)
```ini
[orchestrator]
host = 127.0.0.1
port = 8000

[module3]
host = 127.0.0.1
port = 8002

[frontend]
host = localhost
port = 3000
```

### Production Single Server
All services on one server with public IP:
```ini
[orchestrator]
host = 0.0.0.0
port = 8000

[module3]
host = 0.0.0.0
port = 8002

[frontend]
host = 0.0.0.0
port = 3000
```

### Production Distributed Setup
Services on different servers:
```ini
[orchestrator]
host = api.yourdomain.com
port = 443

[module3]
host = module3.yourdomain.com
port = 443

[frontend]
host = yourdomain.com
port = 443
```

### Docker Deployment
Using service names:
```ini
[orchestrator]
host = orchestrator
port = 8000

[module3]
host = module3-backend
port = 8002

[frontend]
host = frontend
port = 3000
```

## Files That Read Configuration

### Python Backend
- **orchestrator.py**: Uses `config_loader.get_config()` for all module URLs
- **module3/backend/main.py**: Reads host/port for server startup and CORS origins
- **module3/backend/main_modules/api_request.py**: Uses config for frontend notifications

### Frontend
- **frontend/next.config.js**: Uses `config-loader.js` for API rewrites
- **frontend/config-loader.js**: Parses config.ini for JavaScript consumption

## Configuration Loaders

### Python: `config_loader.py`
```python
from config_loader import get_config

config = get_config()
orchestrator_url = config.get_orchestrator_url()  # http://127.0.0.1:8000
module3_host = config.get_module3_host()          # 127.0.0.1
```

### JavaScript: `frontend/config-loader.js`
```javascript
const { loadConfig } = require('./config-loader');

const config = loadConfig();
console.log(config.orchestratorHost);  // 127.0.0.1
console.log(config.orchestratorPort);  // 8000
```

## Deployment Steps

### Step 1: Update config.ini
Edit `config.ini` with your server IPs/domains:
```bash
nano config.ini
```

### Step 2: No Code Changes Needed!
All services automatically read from `config.ini`

### Step 3: Restart Services
```bash
# Stop all services (Ctrl+C in each terminal)

# Start with new config
./start-all.bat

# OR start individually
./start-orchestrator.bat
./start-module3.bat
./start-frontend.bat
```

## Environment Variables (Still Supported)

Module3 can still use environment variables as fallback:
- `PIPELINE_PORT`: Overrides config.ini port for module3
- Values in `module3/.env` are loaded first, then config.ini

Priority order:
1. Environment variables (`.env` files)
2. `config.ini`
3. Hardcoded defaults (only if both above fail)

## Verification

### Check Configuration Loading
```bash
# Python
python config_loader.py

# Output:
# Orchestrator URL: http://127.0.0.1:8000
# Module3 URL: http://127.0.0.1:8002
# Frontend URL: http://localhost:3000
```

### Check Services
1. **Orchestrator**: http://127.0.0.1:8000 (or your configured URL)
2. **Module3**: http://127.0.0.1:8002/api/health
3. **Frontend**: http://localhost:3000

## Troubleshooting

### "Config file not found" Error
**Cause**: config.ini missing or in wrong location
**Fix**: 
```bash
# Ensure config.ini is in project root
ls config.ini  # Should exist

# If missing, copy from template
cp config.ini.example config.ini
```

### Services Can't Connect
**Cause**: Mismatched IPs in config.ini
**Fix**: Ensure all services use compatible addresses:
- `127.0.0.1` for local-only access
- `0.0.0.0` to listen on all interfaces
- Specific IPs/domains for distributed setup

### CORS Errors
**Cause**: Frontend URL not in CORS whitelist
**Fix**: Module3 automatically adds frontend URL from config to CORS.
Restart module3 after changing frontend config.

## Production Checklist

- [ ] Update `config.ini` with production IPs/domains
- [ ] Set appropriate `host` values (0.0.0.0 for public access)
- [ ] Configure firewall rules for ports
- [ ] Use HTTPS/SSL (configure via nginx/reverse proxy)
- [ ] Update CORS origins if using different domains
- [ ] Test all inter-service communication
- [ ] Monitor logs for connection errors

## Rollback

To revert to hardcoded defaults:
1. Delete or rename `config.ini`
2. Services will use fallback defaults:
   - Orchestrator: 127.0.0.1:8000
   - Module3: 127.0.0.1:8002
   - Frontend: localhost:3000

## Benefits

✅ **Single Source of Truth**: One file controls all network configuration
✅ **No Code Changes**: Deploy anywhere without touching code
✅ **Environment-Specific**: Different configs for dev/staging/prod
✅ **Version Control Safe**: Add config.ini to .gitignore, share config.ini.example
✅ **Docker-Ready**: Use service names instead of IPs
✅ **Zero Downtime Prep**: Update config, restart services sequentially

## Example: Deploy to VPS

```bash
# 1. Edit config on server
ssh user@your-server.com
cd /var/www/GoogleHackthon-IDKAI
nano config.ini

# Set to:
# [orchestrator]
# host = 0.0.0.0
# port = 8000
# [module3]
# host = 0.0.0.0
# port = 8002
# [frontend]
# host = 0.0.0.0
# port = 3000

# 2. Restart services
./start-all.bat  # or use systemd/pm2

# 3. Configure nginx reverse proxy
# Frontend: your-domain.com -> localhost:3000
# API: api.your-domain.com -> localhost:8000

# 4. Done! Services now accessible publicly
```

Your application is now deployment-ready! 🚀
