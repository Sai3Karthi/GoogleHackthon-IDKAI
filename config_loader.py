"""
Configuration loader for IDK-AI application.
Reads config.ini from the project root.
"""
import os
import configparser
from pathlib import Path


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

    def _get_optional(self, section: str, option: str, fallback=None):
        """Safely read values without raising when the section is missing."""
        if not self.config.has_section(section):
            return fallback
        if not self.config.has_option(section, option):
            return fallback
        return self.config.get(section, option, fallback=fallback)
    
    def get_orchestrator_url(self):
        """Get full orchestrator URL"""
        # If a deployed backend URL is provided via env, prefer it (production)
        deployed_backend = os.getenv('DEPLOYED_BACKEND_URL')
        if deployed_backend:
            # strip trailing slash
            return deployed_backend.rstrip('/')

        host = self.config.get('orchestrator', 'host', fallback='127.0.0.1')
        port = self.config.getint('orchestrator', 'port', fallback=8000)
        return f"http://{host}:{port}"
    
    def get_orchestrator_host(self):
        """Get orchestrator host only"""
        return self.config.get('orchestrator', 'host', fallback='127.0.0.1')
    
    def get_orchestrator_port(self):
        """Get orchestrator port only"""
        return self.config.getint('orchestrator', 'port', fallback=8000)
    
    def get_module1_url(self):
        """Get full module1 URL"""
        # If deployed backend is provided, return module path through orchestrator
        deployed_backend = os.getenv('DEPLOYED_BACKEND_URL')
        if deployed_backend:
            return f"{deployed_backend.rstrip('/')}/module1"

        host = self.config.get('module1', 'host', fallback='127.0.0.1')
        port = self.config.getint('module1', 'port', fallback=8001)
        return f"http://{host}:{port}"
    
    def get_module1_host(self):
        """Get module1 host only"""
        return self.config.get('module1', 'host', fallback='127.0.0.1')
    
    def get_module1_port(self):
        """Get module1 port only"""
        return self.config.getint('module1', 'port', fallback=8001)
    
    def get_module2_url(self):
        """Get full module2 URL"""
        deployed_backend = os.getenv('DEPLOYED_BACKEND_URL')
        if deployed_backend:
            return f"{deployed_backend.rstrip('/')}/module2"

        host = self.config.get('module2', 'host', fallback='127.0.0.1')
        port = self.config.getint('module2', 'port', fallback=8002)
        return f"http://{host}:{port}"
    
    def get_module2_host(self):
        """Get module2 host only"""
        return self.config.get('module2', 'host', fallback='127.0.0.1')
    
    def get_module2_port(self):
        """Get module2 port only"""
        return self.config.getint('module2', 'port', fallback=8002)
    
    def get_module3_url(self):
        """Get full module3 URL"""
        deployed_backend = os.getenv('DEPLOYED_BACKEND_URL')
        if deployed_backend:
            return f"{deployed_backend.rstrip('/')}/module3"

        host = self.config.get('module3', 'host', fallback='127.0.0.1')
        port = self.config.getint('module3', 'port', fallback=8003)
        return f"http://{host}:{port}"
    
    def get_module3_host(self):
        """Get module3 host only"""
        return self.config.get('module3', 'host', fallback='127.0.0.1')
    
    def get_module3_port(self):
        """Get module3 port only"""
        return self.config.getint('module3', 'port', fallback=8003)
    
    def get_module4_url(self):
        """Get full module4 URL"""
        deployed_backend = os.getenv('DEPLOYED_BACKEND_URL')
        if deployed_backend:
            return f"{deployed_backend.rstrip('/')}/module4"

        host = self.config.get('module4', 'host', fallback='127.0.0.1')
        port = self.config.getint('module4', 'port', fallback=8004)
        return f"http://{host}:{port}"
    
    def get_module4_host(self):
        """Get module4 host only"""
        return self.config.get('module4', 'host', fallback='127.0.0.1')
    
    def get_module4_port(self):
        """Get module4 port only"""
        return self.config.getint('module4', 'port', fallback=8004)
    
    def get_frontend_url(self):
        """Get full frontend URL"""
        # Allow explicit deployed frontend URL via environment variable
        deployed_frontend = os.getenv('DEPLOYED_FRONTEND_URL')
        if deployed_frontend:
            return deployed_frontend.rstrip('/')

        host = self.config.get('frontend', 'host', fallback='localhost')
        port = self.config.getint('frontend', 'port', fallback=3000)
        return f"http://{host}:{port}"
    
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
