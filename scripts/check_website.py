#!/usr/bin/env python3
"""
Simple script to check if the PlayChest website is working properly.
"""

import argparse
import sys
from pathlib import Path

# Add the scripts directory to the path so we can import gamecache modules
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Now import after path is set
from gamecache.http_client import make_http_request  # noqa: E402


def check_website(base_url="http://localhost:8080"):
    """Check if the PlayChest website is accessible and working"""
    website_url = base_url.rstrip("/")

    print(f"🔍 Checking website: {website_url}")

    try:
        response = make_http_request(website_url, timeout=10)
        response_text = response.decode('utf-8', errors='ignore')

        if "playchest" not in response_text.lower() and "boardgame" not in response_text.lower() and "gamecache" not in response_text.lower():
            print("⚠️  Website is accessible but doesn't look like PlayChest")
            return False

        database_url = f"{website_url}/gamecache.sqlite.gz"
        print("🔍 Checking database endpoint...")
        try:
            make_http_request(database_url, timeout=10)
            print("✅ Database file is reachable!")
        except Exception:
            print("❌ Database file not found")
            print("   Run: python scripts/download_and_index.py --cache_bgg")
            print("   Or restart Docker and wait for the initial sync to finish.")
            return False

        print(f"\n🌐 Your website: {website_url}")
        return True

    except Exception as e:
        print(f"❌ Error accessing website: {e}")
        print("   Check that the server or Docker container is running")
        return False


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Check whether the PlayChest site is reachable.")
    parser.add_argument(
        "--url",
        default="http://localhost:8080",
        help="Base URL of the running site (default: http://localhost:8080)",
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    print("🌐 Checking PlayChest website status...\n")

    success = check_website(args.url)

    print("\n" + "=" * 50)

    if success:
        print("🎉 Your PlayChest website appears to be working!")
    else:
        print("❌ Website check failed - see issues above")
        sys.exit(1)


if __name__ == "__main__":
    main()
