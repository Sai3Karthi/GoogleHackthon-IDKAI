"""
Configuration loader for IDK-AI application.
Reads config.ini from the project root.
"""
import os
import configparser
from pathlib import Path
from typing import Dict, Tuple
from urllib.parse import urlparse


class Config:
    def __init__(self, config_file=None):
        self.config = configparser.ConfigParser()
        
        if config_file is None:
            # Try to find config.ini in project root
            current_dir = Path(__file__).parent
            config_file = current_dir / 'config.ini'
            
            # If not found, try parent directories (for nested modules)
            while not config_file.exists() and current_dir.parent != current_dir:
                current_dir = current_dir.parent
                config_file = current_dir / 'config.ini'
        
        if not Path(config_file).exists():
            raise FileNotFoundError(f"Config file not found: {config_file}")

        self.config.read(config_file)
        self.execution_mode = self._detect_execution_mode()

    def _get_optional(self, section: str, option: str, fallback=None):
        """Safely read values without raising when the section is missing."""
        if not self.config.has_section(section):
            return fallback
        if not self.config.has_option(section, option):
            return fallback
        return self.config.get(section, option, fallback=fallback)

    @staticmethod
    def _coerce_bool(value, default=False):
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}

    def _detect_execution_mode(self) -> str:
        """Derive execution mode so we can pivot between local and deployed URLs."""
        override = os.getenv("IDKAI_ENV") or os.getenv("IDKAI_ENVIRONMENT")
        if override:
            normalized = override.strip().lower()
            if normalized in {"prod", "production", "cloud", "deployed"}:
                return "cloud"
            if normalized in {"local", "dev", "development", "test"}:
                return "local"

        if self._env_flag("IDKAI_FORCE_LOCAL"):
            return "local"

        if self._env_flag("IDKAI_FORCE_CLOUD"):
            return "cloud"

        if os.getenv("K_SERVICE") or os.getenv("CLOUD_RUN_JOB") or os.getenv("K_REVISION"):
            return "cloud"

        return "local"

    def is_cloud_environment(self) -> bool:
        return self.execution_mode == "cloud"

    def _bool_from_env_or_config(self, section: str, option: str, env_name: str, default: bool = False) -> bool:
        env_value = os.getenv(env_name)
        if env_value is not None:
            return self._coerce_bool(env_value, default)
        return self._coerce_bool(self._get_optional(section, option), default)
    
    def get_orchestrator_url(self):
        """Get full orchestrator URL"""
        service_env = os.getenv('ORCHESTRATOR_SERVICE_URL')
        if service_env:
            normalized, _, _, _ = self._normalize_url(service_env.strip())
            return normalized

        # If a deployed backend URL is provided via env, prefer it (production)
        deployed_backend = os.getenv('DEPLOYED_BACKEND_URL')
        if deployed_backend:
            # strip trailing slash
            return deployed_backend.rstrip('/')

        if self.is_cloud_environment():
            service_url = self._get_optional('orchestrator', 'service_url')
            if service_url:
                normalized, _, _, _ = self._normalize_url(service_url.strip())
                return normalized

        host = self.config.get('orchestrator', 'host', fallback='127.0.0.1')
        port = self.config.getint('orchestrator', 'port', fallback=8000)
        use_https = self._bool_from_env_or_config('orchestrator', 'use_https', 'ORCHESTRATOR_USE_HTTPS')
        scheme = 'https' if use_https else 'http'
        if use_https and port in {443, 0}:
            return f"{scheme}://{host}"
        return f"{scheme}://{host}:{port}"
    
    def get_orchestrator_host(self):
        """Get orchestrator host only"""
        return self.config.get('orchestrator', 'host', fallback='127.0.0.1')
    
    def get_orchestrator_port(self):
        """Get orchestrator port only"""
        return self.config.getint('orchestrator', 'port', fallback=8000)
    
    @staticmethod
    def _env_flag(name: str, default: bool = False) -> bool:
        raw = os.getenv(name)
        return Config._coerce_bool(raw, default)

    @staticmethod
    def _normalize_url(url: str) -> Tuple[str, str, int, bool]:
        """Return normalized base URL, host, port, https flag."""
        parsed = urlparse(url)
        scheme = parsed.scheme or "http"
        host = parsed.hostname or ""
        port = parsed.port
        use_https = scheme.lower() == "https"
        if port is None:
            port = 443 if use_https else 80
        netloc = host
        if (use_https and port != 443) or (not use_https and port != 80):
            netloc = f"{host}:{port}"
        normalized = f"{scheme.lower()}://{netloc}{parsed.path.rstrip('/')}"
        return normalized.rstrip('/'), host, port, use_https

    def _module_connection_from_env(self, module_key: str) -> Tuple[str, str, int, bool]:
        env_var = f"{module_key.upper()}_SERVICE_URL"
        env_url = os.getenv(env_var)
        if not env_url:
            raise KeyError(env_var)
        normalized, host, port, use_https = self._normalize_url(env_url.strip())
        return normalized, host, port, use_https

    def _module_connection_from_config(
        self,
        section: str,
        default_port: int,
        prefer_service_url: bool = False,
    ) -> Tuple[str, str, int, bool]:
        if prefer_service_url:
            raw_service_url = self._get_optional(section, "service_url")
            if raw_service_url:
                normalized, host, port, use_https = self._normalize_url(raw_service_url.strip())
                return normalized, host, port, use_https

        host = self.config.get(section, "host", fallback="127.0.0.1")
        port = self.config.getint(section, "port", fallback=default_port)
        use_https = self._bool_from_env_or_config(section, "use_https", f"{section.upper()}_USE_HTTPS")
        scheme = "https" if use_https else "http"
        if use_https and port in {443, 0}:
            base_url = f"{scheme}://{host}"
        else:
            base_url = f"{scheme}://{host}:{port}"
        return base_url.rstrip('/'), host, port, use_https

    def get_module_connection(self, section: str, default_port: int) -> Dict[str, object]:
        """Resolve module connection metadata supporting env overrides."""
        prefer_service_url = self.is_cloud_environment()
        try:
            base_url, host, port, use_https = self._module_connection_from_env(section)
        except KeyError:
            base_url, host, port, use_https = self._module_connection_from_config(
                section,
                default_port,
                prefer_service_url=prefer_service_url,
            )
        return {
            "base_url": base_url,
            "host": host,
            "port": port,
            "use_https": use_https,
        }

    def _module_public_url(self, section: str, default_port: int) -> str:
        deployed_backend = os.getenv('DEPLOYED_BACKEND_URL')
        if deployed_backend:
            return f"{deployed_backend.rstrip('/')}/{section}"
        connection = self.get_module_connection(section, default_port)
        return connection["base_url"]

    def get_module1_url(self):
        """Get full module1 URL"""
        return self._module_public_url('module1', 8001)
    
    def get_module1_host(self):
        """Get module1 host only"""
        return self.config.get('module1', 'host', fallback='127.0.0.1')
    
    def get_module1_port(self):
        """Get module1 port only"""
        return self.config.getint('module1', 'port', fallback=8001)
    
    def get_module2_url(self):
        """Get full module2 URL"""
        return self._module_public_url('module2', 8002)
    
    def get_module2_host(self):
        """Get module2 host only"""
        return self.config.get('module2', 'host', fallback='127.0.0.1')
    
    def get_module2_port(self):
        """Get module2 port only"""
        return self.config.getint('module2', 'port', fallback=8002)
    
    def get_module3_url(self):
        """Get full module3 URL"""
        return self._module_public_url('module3', 8003)
    
    def get_module3_host(self):
        """Get module3 host only"""
        return self.config.get('module3', 'host', fallback='127.0.0.1')
    
    def get_module3_port(self):
        """Get module3 port only"""
        return self.config.getint('module3', 'port', fallback=8003)
    
    def get_module4_url(self):
        """Get full module4 URL"""
        return self._module_public_url('module4', 8004)
    
    def get_module4_host(self):
        """Get module4 host only"""
        return self.config.get('module4', 'host', fallback='127.0.0.1')
    
    def get_module4_port(self):
        """Get module4 port only"""
        return self.config.getint('module4', 'port', fallback=8004)
    
    def get_frontend_url(self):
        """Get full frontend URL"""
        service_env = os.getenv('FRONTEND_SERVICE_URL')
        if service_env:
            normalized, _, _, _ = self._normalize_url(service_env.strip())
            return normalized

        # Allow explicit deployed frontend URL via environment variable
        deployed_frontend = os.getenv('DEPLOYED_FRONTEND_URL')
        if deployed_frontend:
            return deployed_frontend.rstrip('/')

        if self.is_cloud_environment():
            service_url = self._get_optional('frontend', 'service_url')
            if service_url:
                normalized, _, _, _ = self._normalize_url(service_url.strip())
                return normalized

        host = self.config.get('frontend', 'host', fallback='localhost')
        port = self.config.getint('frontend', 'port', fallback=3000)
        use_https = self._bool_from_env_or_config('frontend', 'use_https', 'FRONTEND_USE_HTTPS')
        scheme = 'https' if use_https else 'http'
        if use_https and port in {443, 0}:
            return f"{scheme}://{host}"
        return f"{scheme}://{host}:{port}"
    
    def get_frontend_host(self):
        """Get frontend host only"""
        return self.config.get('frontend', 'host', fallback='localhost')
    
    def get_frontend_port(self):
        """Get frontend port only"""
        return self.config.getint('frontend', 'port', fallback=3000)

    def get_database_url(self):
        """Resolve database connection string with environment overriding config."""
        env_url = os.getenv('DATABASE_URL')
        if env_url:
            return env_url

        cfg_url = self._get_optional('database', 'url')
        if cfg_url:
            return cfg_url

        raise ValueError(
            "Database URL not configured. Set DATABASE_URL environment variable or add [database] section to config.ini"
        )

    def get_database_echo(self):
        """Optional SQL echo flag used for debugging."""
        env_echo = os.getenv('DATABASE_ECHO')
        if env_echo is not None:
            return env_echo.lower() in {'1', 'true', 'yes', 'on'}

        cfg_echo = self._get_optional('database', 'echo')
        if cfg_echo is not None:
            return str(cfg_echo).lower() in {'1', 'true', 'yes', 'on'}

        return False


# Singleton instance
_config_instance = None


def get_config():
    """Get the global config instance"""
    global _config_instance
    if _config_instance is None:
        _config_instance = Config()
    return _config_instance


if __name__ == "__main__":
    # Test the config loader
    config = get_config()
    print(f"Orchestrator URL: {config.get_orchestrator_url()}")
    print(f"Module1 URL: {config.get_module1_url()}")
    print(f"Module2 URL: {config.get_module2_url()}")
    print(f"Module3 URL: {config.get_module3_url()}")
    print(f"Module4 URL: {config.get_module4_url()}")
    print(f"Frontend URL: {config.get_frontend_url()}")
