"""
Configuration parsing utilities for GameCache project.
"""

import os
from pathlib import Path

from .collection_loader import get_bgg_usernames


def parse_config_file(config_path="config.txt"):
    """Parse simple key=value config file"""
    config = {}
    config_file = Path(config_path)

    if not config_file.exists():
        raise FileNotFoundError(f"Config file {config_path} not found")

    with open(config_file, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()

            # Skip empty lines and comments
            if not line or line.startswith('#'):
                continue

            # Parse key=value
            if '=' not in line:
                raise ValueError(f"Invalid config line {line_num}: {line}")

            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip()

            # Remove quotes if present
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            elif value.startswith("'") and value.endswith("'"):
                value = value[1:-1]

            config[key] = value

    return config


def create_nested_config(config):
    """Convert flat config to nested structure for backward compatibility"""
    nested = {
        "project": {
            "title": config["title"]
        },
        "boardgamegeek": {
            "user_name": (get_bgg_usernames(config) or [config.get("bgg_username", "")])[0],
            "user_names": get_bgg_usernames(config),
        }
    }

    if "github_repo" in config:
        nested["github"] = {
            "repo": config["github_repo"]
        }
    
    # Check for BGG token in environment variable first
    bgg_token = os.environ.get('GAMECACHE_BGG_TOKEN')

    # If not in environment, try to load from .env file
    # Look for .env in: current dir, parent dir (scripts), or grandparent (repo root)
    if not bgg_token:
        env_locations = [
            Path('.env'),
            Path(__file__).parent.parent.parent / '.env',  # repo root from scripts/gamecache/config.py
        ]
        for env_file in env_locations:
            if env_file.exists():
                with open(env_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith('GAMECACHE_BGG_TOKEN='):
                            bgg_token = line.split('=', 1)[1].strip()
                            break
                if bgg_token:
                    break

    # Fall back to config file if still not found
    if bgg_token:
        nested["boardgamegeek"]["token"] = bgg_token
    elif "bgg_token" in config:
        nested["boardgamegeek"]["token"] = config["bgg_token"]
    
    return nested

