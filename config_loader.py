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
    
    def get_orchestrator_url(self):
        """Get full orchestrator URL"""
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
        host = self.config.get('module1', 'host', fallback='127.0.0.1')
        port = self.config.getint('module1', 'port', fallback=8001)
        return f"http://{host}:{port}"
    
    def get_module1_host(self):
        """Get module1 host only"""
        return self.config.get('module1', 'host', fallback='127.0.0.1')
    
    def get_module1_port(self):
        """Get module1 port only"""
        return self.config.getint('module1', 'port', fallback=8001)
    
    def get_module3_url(self):
        """Get full module3 URL"""
        host = self.config.get('module3', 'host', fallback='127.0.0.1')
        port = self.config.getint('module3', 'port', fallback=8002)
        return f"http://{host}:{port}"
    
    def get_module3_host(self):
        """Get module3 host only"""
        return self.config.get('module3', 'host', fallback='127.0.0.1')
    
    def get_module3_port(self):
        """Get module3 port only"""
        return self.config.getint('module3', 'port', fallback=8002)
    
    def get_frontend_url(self):
        """Get full frontend URL"""
        host = self.config.get('frontend', 'host', fallback='localhost')
        port = self.config.getint('frontend', 'port', fallback=3000)
        return f"http://{host}:{port}"
    
    def get_frontend_host(self):
        """Get frontend host only"""
        return self.config.get('frontend', 'host', fallback='localhost')
    
    def get_frontend_port(self):
        """Get frontend port only"""
        return self.config.getint('frontend', 'port', fallback=3000)


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
    print(f"Module3 URL: {config.get_module3_url()}")
    print(f"Frontend URL: {config.get_frontend_url()}")
