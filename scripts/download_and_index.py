import sys
import gzip
import os
import json
import urllib.request
import urllib.error
from pathlib import Path

# Add the scripts directory to the path for imports
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))

# Now import after path is set
from gamecache.downloader import Downloader  # noqa: E402
from gamecache.sqlite_indexer import SqliteIndexer  # noqa: E402
from gamecache.github_integration import setup_github_integration  # noqa: E402
from gamecache.config import parse_config_file, create_nested_config  # noqa: E402
from gamecache.http_client import open_url  # noqa: E402
from setup_logging import setup_logging  # noqa: E402


UPGRADE_INSTRUCTIONS_URL = "https://github.com/EmilStenstrom/gamecache#keeping-your-copy-updated"


def _print_info_box(title, lines):
    content = [title] + list(lines)
    width = max(len(s) for s in content) if content else len(title)
    border = "+" + ("-" * (width + 2)) + "+"
    print(border)
    print(f"| {title.ljust(width)} |")
    print("|" + (" " * (width + 2)) + "|")
    for line in lines:
        print(f"| {line.ljust(width)} |")
    print(border)


def _http_get_json(url, timeout=10, headers=None):
    req = urllib.request.Request(url)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('User-Agent', 'GameCache/1.0')
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)

    with open_url(req, timeout=timeout) as resp:
        data = resp.read()
        return json.loads(data.decode('utf-8', errors='replace'))


def _get_default_branch(owner, repo):
    info = _http_get_json(f"https://api.github.com/repos/{owner}/{repo}")
    return info.get('default_branch')


def check_for_upstream_updates_via_github(github_repo):
    """Check whether the user's repo is behind the upstream template.

    Uses GitHub's compare API (HTTP GET) so it works without git installed.
    """
    if os.environ.get("GAMECACHE_SKIP_UPDATE_CHECK"):
        return

    if not github_repo or '/' not in github_repo:
        return

    owner, repo = github_repo.split('/', 1)

    try:
        upstream_owner = 'EmilStenstrom'
        upstream_repo = 'gamecache'

        upstream_branch = _get_default_branch(upstream_owner, upstream_repo) or 'master'
        head_branch = _get_default_branch(owner, repo) or 'master'

        compare_url = (
            f"https://api.github.com/repos/{upstream_owner}/{upstream_repo}"
            f"/compare/{upstream_branch}...{owner}:{head_branch}"
        )
        comparison = _http_get_json(compare_url, timeout=10)

        behind_by = int(comparison.get('behind_by', 0) or 0)
        if behind_by > 0:
            _print_info_box(
                "New GameCache version available",
                [
                    f"Your repo ({github_repo}) is {behind_by} commits behind upstream.",
                    f"How to update: {UPGRADE_INSTRUCTIONS_URL}",
                    "(Set GAMECACHE_SKIP_UPDATE_CHECK=1 to hide this message)",
                ],
            )
    except urllib.error.HTTPError as e:
        # Don't block the main script if GitHub is rate-limiting or unavailable.
        if e.code == 403:
            # Often rate limit.
            return
        return
    except Exception:
        return

def main(args):
    config = parse_config_file(args.config)
    # Convert flat config to nested structure for backward compatibility
    SETTINGS = create_nested_config(config)

    # Best-effort update check (does not affect script success)
    check_for_upstream_updates_via_github(SETTINGS.get("github", {}).get("repo"))

    # Get BGG token from config
    bgg_token = SETTINGS["boardgamegeek"].get("token")

    downloader = Downloader(
        cache_bgg=args.cache_bgg,
        debug=args.debug,
        token=bgg_token,
    )
    extra_params = SETTINGS["boardgamegeek"].get("extra_params", {"own": 1})
    collection = downloader.collection(
        user_name=SETTINGS["boardgamegeek"]["user_name"],
        extra_params=extra_params,
    )

    # Deduplicate collection based on game ID
    seen_ids = set()
    unique_collection = []
    for game in collection:
        if game.id not in seen_ids:
            unique_collection.append(game)
            seen_ids.add(game.id)
    collection = unique_collection

    num_games = len(collection)
    num_expansions = sum([len(game.expansions) for game in collection])
    print(f"Imported {num_games} games and {num_expansions} expansions from boardgamegeek.")

    if not len(collection):
        assert False, "No games imported, is the boardgamegeek part of config.ini correctly set?"

    # Create SQLite database
    sqlite_path = "gamecache.sqlite"
    indexer = SqliteIndexer(sqlite_path)
    indexer.add_objects(collection)
    print(f"Created SQLite database with {num_games} games and {num_expansions} expansions.")

    # Gzip the database and remove the original
    gzip_path = f"{sqlite_path}.gz"
    with open(sqlite_path, 'rb') as f_in, gzip.open(gzip_path, 'wb') as f_out:
        f_out.write(f_in.read())
    os.remove(sqlite_path)
    print(f"Created gzipped database: {gzip_path}")

    # Upload to GitHub only when explicitly requested
    if args.upload:
        if "github" not in SETTINGS or not SETTINGS["github"].get("repo"):
            print("Error: github_repo must be set in config.ini when using --upload")
            sys.exit(1)
        try:
            github_manager = setup_github_integration(SETTINGS)

            # Upload the gzipped SQLite file
            snapshot_tag = SETTINGS["github"].get("snapshot_tag", "database")
            asset_name = SETTINGS["github"].get("snapshot_asset", "gamecache.sqlite.gz")

            download_url = github_manager.upload_snapshot(gzip_path, snapshot_tag, asset_name)
            print(f"Successfully uploaded to GitHub: {download_url}")

        except Exception as e:
            print(f"Error uploading to GitHub: {e}")
            sys.exit(1)
    else:
        print(f"Database saved locally: {gzip_path}")


if __name__ == '__main__':
    import argparse

    setup_logging()

    parser = argparse.ArgumentParser(description='Download and create SQLite database of boardgames')
    parser.add_argument(
        '--upload',
        action='store_true',
        help=(
            "Upload the generated database to GitHub Releases. "
            "Requires github_repo in config.ini."
        )
    )
    parser.add_argument(
        '--no_upload',
        action='store_true',
        help="Deprecated alias kept for compatibility; upload is disabled by default."
    )
    parser.add_argument(
        '--cache_bgg',
        action='store_true',
        help=(
            "Enable a cache for all BGG calls. This makes script run very "
            "fast the second time it's run."
        )
    )
    parser.add_argument(
        '--debug',
        action='store_true',
        help="Print debug information, such as requests made and responses received."
    )
    parser.add_argument(
        '--config',
        type=str,
        required=False,
        default="config.ini",
        help="Path to the config file (default: config.ini from the working directory)."
    )

    args = parser.parse_args()

    main(args)
