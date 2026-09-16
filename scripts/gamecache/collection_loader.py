from typing import Any, Dict, List
import json
import os
from pathlib import Path

from .models import BoardGame


def _splitUsernames(raw: Any) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(name).strip() for name in raw if str(name).strip()]
    return [name.strip() for name in str(raw).split(",") if name.strip()]


def get_extra_usernames_path() -> Path:
    return Path(os.environ.get("GAMECACHE_DATA_DIR", "data")) / "bgg-usernames.json"


def _readUsernamesFile() -> Dict[str, List[str]]:
    extraPath = get_extra_usernames_path()
    if not extraPath.exists():
        return {"extraUsernames": [], "disabledUsernames": []}
    try:
        payload = json.loads(extraPath.read_text(encoding="utf-8"))
    except Exception:
        return {"extraUsernames": [], "disabledUsernames": []}
    return {
        "extraUsernames": _splitUsernames(payload.get("extraUsernames") or payload.get("usernames")),
        "disabledUsernames": _splitUsernames(payload.get("disabledUsernames")),
    }


def get_extra_usernames() -> List[str]:
    return _readUsernamesFile()["extraUsernames"]


def get_disabled_usernames() -> List[str]:
    return _readUsernamesFile()["disabledUsernames"]


def get_bgg_usernames(
    config: Dict[str, Any],
    includeExtras: bool = True,
    includeDisabled: bool = False,
) -> List[str]:
    usernames = []

    def addNames(raw):
        for name in _splitUsernames(raw):
            if name not in usernames:
                usernames.append(name)

    addNames(config.get("bgg_usernames"))
    addNames(config.get("bgg_username"))

    numberedKeys = sorted(
        key for key in config
        if key.startswith("bgg_username_") and key != "bgg_username"
    )
    for key in numberedKeys:
        addNames(config.get(key))

    if includeExtras:
        addNames(get_extra_usernames())

    if includeDisabled:
        return usernames

    disabled = {name.lower() for name in get_disabled_usernames()}
    return [name for name in usernames if name.lower() not in disabled]


def _mergeBoardGame(existing: BoardGame, incoming: BoardGame) -> None:
    for owner in incoming.collection_owners:
        if owner not in existing.collection_owners:
            existing.collection_owners.append(owner)
    existing.tags = sorted(set(existing.tags + incoming.tags))
    existing.numplays = max(existing.numplays, incoming.numplays)
    if incoming.numplays >= existing.numplays:
        existing.previous_players = sorted(
            set(existing.previous_players + incoming.previous_players)
        )
    incomingParents = getattr(incoming, "expansion_parent_ids", None) or []
    existingParents = getattr(existing, "expansion_parent_ids", None) or []
    for parentId in incomingParents:
        if parentId not in existingParents:
            existingParents.append(parentId)
    if existingParents:
        existing.expansion_parent_ids = existingParents


def load_merged_collection(downloader, user_names: List[str], extra_params) -> List[BoardGame]:
    merged_games: Dict[int, BoardGame] = {}
    merged_expansions: Dict[int, BoardGame] = {}

    for user_name in user_names:
        try:
            games, expansions = downloader.collection(
                user_name=user_name,
                extra_params=extra_params,
            )
        except Exception as error:
            raise RuntimeError(
                f"Failed to import the BoardGameGeek collection for '{user_name}': {error}"
            ) from error
        for game in games:
            if game.id in merged_games:
                _mergeBoardGame(merged_games[game.id], game)
            else:
                merged_games[game.id] = game
        for expansion in expansions:
            if expansion.id in merged_expansions:
                _mergeBoardGame(merged_expansions[expansion.id], expansion)
            else:
                merged_expansions[expansion.id] = expansion

    for game in merged_games.values():
        game.expansions = []

    for expansion in merged_expansions.values():
        parentIds = getattr(expansion, "expansion_parent_ids", None) or []
        attached = False
        for parentId in parentIds:
            parent = merged_games.get(parentId)
            if not parent:
                continue
            if expansion.id not in [item.id for item in parent.expansions]:
                parent.expansions.append(expansion)
            attached = True
        # Keep expansions nested under a parent. Never add DLC/expansions as their own cards.

    return list(merged_games.values())
