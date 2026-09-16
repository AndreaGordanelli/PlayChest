from typing import Any, Dict, List

from .models import BoardGame


def get_bgg_usernames(config: Dict[str, Any]) -> List[str]:
    if "bgg_usernames" in config:
        return [name.strip() for name in config["bgg_usernames"].split(",") if name.strip()]

    usernames = []
    if config.get("bgg_username"):
        usernames.append(config["bgg_username"].strip())

    numbered_keys = sorted(
        key for key in config
        if key.startswith("bgg_username_") and key != "bgg_username"
    )
    for key in numbered_keys:
        value = config.get(key, "").strip()
        if value and value not in usernames:
            usernames.append(value)

    return usernames


def load_merged_collection(downloader, user_names: List[str], extra_params) -> List[BoardGame]:
    merged_games: Dict[int, BoardGame] = {}

    for user_name in user_names:
        games = downloader.collection(
            user_name=user_name,
            extra_params=extra_params,
        )
        for game in games:
            if game.id in merged_games:
                existing = merged_games[game.id]
                for owner in game.collection_owners:
                    if owner not in existing.collection_owners:
                        existing.collection_owners.append(owner)
                existing.tags = sorted(set(existing.tags + game.tags))
                existing.numplays = max(existing.numplays, game.numplays)
                if game.numplays >= existing.numplays:
                    existing.previous_players = sorted(
                        set(existing.previous_players + game.previous_players)
                    )
            else:
                game.collection_owners = [user_name]
                merged_games[game.id] = game

    return list(merged_games.values())
