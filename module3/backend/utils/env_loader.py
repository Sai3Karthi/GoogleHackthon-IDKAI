"""
Environment variable loader utility.
Provides a simple interface to load .env files.
"""
import os
from pathlib import Path
from typing import Union


def load_env_file(env_path: Union[str, Path]) -> bool:
    """
    Load environment variables from a .env file.
    
    Args:
        env_path: Path to the .env file
        
    Returns:
        True if file was loaded successfully, False otherwise
    """
    try:
        from dotenv import load_dotenv
        env_path = Path(env_path)
        
        if not env_path.exists():
            return False
        
        load_dotenv(env_path)
        return True
    except ImportError:
        # If python-dotenv is not installed, manually parse the file
        env_path = Path(env_path)
        
        if not env_path.exists():
            return False
        
        try:
            with open(env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    # Skip comments and empty lines
                    if not line or line.startswith('#'):
                        continue
                    
                    # Parse key=value
                    if '=' in line:
                        key, value = line.split('=', 1)
                        key = key.strip()
                        value = value.strip()
                        
                        # Remove quotes if present
                        if value.startswith('"') and value.endswith('"'):
                            value = value[1:-1]
                        elif value.startswith("'") and value.endswith("'"):
                            value = value[1:-1]
                        
                        os.environ[key] = value
            return True
        except Exception:
            return False
