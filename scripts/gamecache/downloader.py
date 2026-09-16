from gamecache.bgg_client import BGGClient
from gamecache.bgg_client import CacheBackendSqlite
from gamecache.models import BoardGame


class Downloader():
    def __init__(self, cache_bgg, debug=False, token=None):
        if cache_bgg:
            self.client = BGGClient(
                cache=CacheBackendSqlite(
                    path=f"gamecache-cache.sqlite",
                    ttl=60 * 60 * 24,
                ),
                debug=debug,
                token=token,
            )
        else:
            self.client = BGGClient(
                debug=debug,
                token=token,
            )

    def collection(self, user_name, extra_params):
        collection_data = []
        plays_data = []

        if isinstance(extra_params, list):
            for params in extra_params:
                collection_data += self.client.collection(
                    user_name=user_name,
                    **params,
                )
        else:
            collection_data = self.client.collection(
                user_name=user_name,
                **extra_params,
            )

        plays_data = self.client.plays(
            user_name=user_name,
        )

        game_list_data = self.client.game_list([game_in_collection["id"] for game_in_collection in collection_data])
        game_id_to_tags = {game["id"]: game["tags"] for game in collection_data}
        game_id_to_image = {game["id"]: game["image_version"] or game["image"] for game in collection_data}
        game_id_to_numplays = {game["id"]: game["numplays"] for game in collection_data}

        game_id_to_players = {game["id"]: [] for game in collection_data}
        for play in plays_data:
            if play["game"]["gameid"] in game_id_to_players:
                game_id_to_players[play["game"]["gameid"]].extend(play["players"])
                game_id_to_players[play["game"]["gameid"]] = list(set(game_id_to_players[play["game"]["gameid"]]))

        games_data = list(filter(lambda x: x["type"] == "boardgame", game_list_data))
        expansions_data = list(filter(lambda x: x["type"] == "boardgameexpansion", game_list_data))

        game_id_to_expansion = {game["id"]: [] for game in games_data}
        for expansion_data in expansions_data:
            for expansion in expansion_data["expansions"]:
                if expansion["inbound"] and expansion["id"] in game_id_to_expansion:
                    game_id_to_expansion[expansion["id"]].append(expansion_data)

        games = [
            BoardGame(
                game_data,
                image=game_id_to_image[game_data["id"]],
                tags=game_id_to_tags[game_data["id"]],
                numplays=game_id_to_numplays[game_data["id"]],
                previous_players=game_id_to_players[game_data["id"]],
                collection_owners=[user_name],
                expansions=[
                    BoardGame(
                        expansion_data,
                        image=game_id_to_image.get(expansion_data["id"]) or expansion_data.get("image") or "",
                    )
                    for expansion_data in game_id_to_expansion[game_data["id"]]
                ]
            )
            for game_data in games_data
        ]
        return games
