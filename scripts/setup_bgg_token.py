"""
BGG Token Setup Script

This script automatically generates a BGG (BoardGameGeek) API token for GameCache.
It uses a private Cloudflare Worker to generate tokens on behalf of users.
"""

import sys
import json
import os
import time
from pathlib import Path
from urllib.parse import unquote

# Import our own HTTP client
from gamecache.http_client import make_http_request, make_json_request
from gamecache.config import parse_config_file


def get_bgg_username_from_config(config_path="config.ini"):
    """
    Get the BGG username from config.ini.

    Args:
        config_path: Path to the config file

    Returns:
        The username string, or None if not found
    """
    print("\n" + "="*70)
    print("🎮 BGG TOKEN GENERATOR")
    print("="*70)
    print()
    print("This script will automatically generate a BGG API token for you.")
    print()

    try:
        config = parse_config_file(config_path)
        username = config.get('bgg_username')
        
        if not username:
            print(f"❌ Error: 'bgg_username' not found in {config_path}")
            print(f"   Please add your BGG username to the config file:")
            print(f"   bgg_username = YOUR_BGG_USERNAME")
            return None
        
        print(f"📖 Read BGG username from {config_path}: {username}")
        return username
        
    except FileNotFoundError:
        print(f"❌ Error: Config file '{config_path}' not found")
        print(f"   Please create a config.ini file with your BGG username")
        return None
    except Exception as e:
        print(f"❌ Error reading config file: {e}")
        return None


def is_bearer_token(value):
    """Return True if value looks like a BGG bearer token."""
    if not isinstance(value, str):
        return False

    parts = value.split('-')
    return (
        len(parts) == 5
        and [len(part) for part in parts] == [8, 4, 4, 4, 12]
        and all(all(ch in '0123456789abcdefABCDEF' for ch in part) for part in parts)
    )


def validate_token_with_bgg(token, username):
    """Confirm BGG accepts the token before saving it."""
    try:
        make_http_request(
            "https://boardgamegeek.com/xmlapi2/user",
            params={"name": unquote(username)},
            timeout=10,
            headers={"Authorization": f"Bearer {token}"},
        )
        return True
    except Exception as e:
        print(f"❌ Generated token was rejected by BGG: {e}")
        return False


def unique_token_label(username):
    """Build a Worker-safe token label that avoids stale existing-token records."""
    suffix = time.strftime("%m%d%H%M%S")
    prefix = username[:21]
    return f"{prefix}-{suffix}"


def request_token_from_worker(username):
    worker_url = 'https://gamecache-bgg-token-generator.mybgg.workers.dev'

    data = make_json_request(
        worker_url,
        method='POST',
        data={'username': username},
        timeout=30
    )

    if data and data.get('success') and data.get('token'):
        return data
    return data or {}


def generate_token_via_worker(username):
    """
    Generate a BGG token by calling the Cloudflare Worker.

    Args:
        username: The BGG username for token naming

    Returns:
        The generated token, or None if failed
    """
    token_label = unique_token_label(username)
    print(f"\n🔄 Generating token for user '{username}'...")
    print(f"   Token label: {token_label}")

    try:
        data = request_token_from_worker(token_label)

        if data and data.get('success') and data.get('token'):
            token = data['token']
            if not is_bearer_token(token):
                print("❌ Token generator did not return a valid BGG bearer token.")
                if data:
                    safe_data = dict(data)
                    safe_data.pop('token', None)
                    print(f"   Response metadata: {safe_data}")
                return None

            if not validate_token_with_bgg(token, username):
                return None

            print("✅ Token generated and verified successfully!")
            return token
        elif data:
            print(f"❌ Unexpected response from token generator:")
            print(f"   {data}")
            return None
        else:
            print(f"❌ Token generation failed - no response data")
            return None

    except Exception as e:
        error_msg = str(e)
        if 'timed out' in error_msg.lower() or 'timeout' in error_msg.lower():
            print("❌ Request timed out. Please check your internet connection.")
        elif 'connection' in error_msg.lower():
            print("❌ Connection error. Please check your internet connection.")
        else:
            print(f"❌ Error generating token: {e}")
        return None


def save_token_to_config(token, config_path="config.ini"):
    """
    Save the BGG token to a local environment file (not to config.ini for security).

    Args:
        token: The BGG application token
        config_path: Path to the config file (used to find the project root)
    """
    # Create .env file in the same directory as config.ini
    config_file = Path(config_path)
    project_root = config_file.parent
    env_file = project_root / '.env'

    # Check if .env file exists and if GAMECACHE_BGG_TOKEN is already set
    env_lines = []
    token_exists = False

    if env_file.exists():
        with open(env_file, 'r', encoding='utf-8') as f:
            for line in f:
                stripped = line.strip()
                if stripped.startswith('GAMECACHE_BGG_TOKEN'):
                    env_lines.append(f'GAMECACHE_BGG_TOKEN={token}\n')
                    token_exists = True
                else:
                    env_lines.append(line)

    # If token doesn't exist, add it
    if not token_exists:
        env_lines.append(f'GAMECACHE_BGG_TOKEN={token}\n')

    # Write to .env file
    with open(env_file, 'w', encoding='utf-8') as f:
        f.writelines(env_lines)

    print(f"\n✅ Token saved to {env_file}")
    print(f"\n💡 Your token is stored securely in .env (not committed to git)")
    print(f"   The token will be automatically loaded when you run scripts.")

    exported_token = os.environ.get('GAMECACHE_BGG_TOKEN')
    if exported_token and exported_token != token:
        print()
        print("⚠️  Your shell has an older GAMECACHE_BGG_TOKEN exported.")
        print("   It will override .env until you unset or update it:")
        print("   unset GAMECACHE_BGG_TOKEN")

    return True


def main():
    """Main function to orchestrate the token setup process."""
    print("BGG Token Setup for PlayChest")
    print("-" * 70)

    # Get username from config.ini
    username = get_bgg_username_from_config()
    if not username:
        sys.exit(1)

    # Generate token
    token = generate_token_via_worker(username)
    if not token:
        print("\n❌ Failed to generate token.")
        print("\nIf the automatic token generation isn't working, you can create")
        print("a token manually at: https://boardgamegeek.com/application/189/tokens")
        sys.exit(1)

    # Save to config
    if not save_token_to_config(token):
        print(f"\n⚠️  Token generated but not saved automatically.")
        print(f"   Please create a .env file with:")
        print(f"   GAMECACHE_BGG_TOKEN={token}")
        sys.exit(1)

    print("\n" + "="*70)
    print("🎉 SUCCESS!")
    print("="*70)
    print()
    print("Your BGG token has been configured successfully.")
    print("You can now use PlayChest to download and index BGG data.")
    print()


if __name__ == "__main__":
    main()
