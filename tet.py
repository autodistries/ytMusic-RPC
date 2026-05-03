#!/usr/bin/env python3
import os
import re
import subprocess
import time
import urllib.parse

import requests

SERVER = "http://127.0.0.1:8766"

UPLOAD_ENABLED =  "1"
UPLOAD_CMD = os.environ.get("TET_UPLOAD_CMD", "/home/cat/scripts/zipline-script-upload.sh")

LAST_UPLOAD_TRACK_KEY = None
LAST_UPLOADED_THUMBNAIL = None

prevmusic="non"


def run(cmd):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return p.stdout.strip()


def parse_time_value(value):
    if not value:
        return 0.0

    value = value.strip()
    if ":" in value:
        try:
            parts = [float(part) for part in value.split(":")][::-1]
        except Exception:
            return 0.0

        seconds = 0.0
        multiplier = 1.0
        for part in parts:
            seconds += part * multiplier
            multiplier *= 60.0
        return seconds

    try:
        numeric_value = float(value)
    except Exception:
        return 0.0

    if numeric_value >= 1_000_000.0:
        return numeric_value / 1_000_000.0
    if numeric_value >= 1000.0:
        return numeric_value / 1000.0
    return numeric_value


def upload_with_script(path, track_key):
    global LAST_UPLOAD_TRACK_KEY, LAST_UPLOADED_THUMBNAIL

    if not UPLOAD_ENABLED or not os.path.exists(UPLOAD_CMD):
        return None

    if LAST_UPLOAD_TRACK_KEY == track_key and LAST_UPLOADED_THUMBNAIL:
        print("hit cache for this track")
        return LAST_UPLOADED_THUMBNAIL

    try:
        p = subprocess.run(f'{UPLOAD_CMD} "{path}"', shell=True, capture_output=True, text=True, timeout=15)
        output = (p.stdout or "") + "\n" + (p.stderr or "")
        print("ha ran", output)
        match = re.search(r'https?://[^\s\"\'"<>]+', output)
        if match:
            LAST_UPLOAD_TRACK_KEY = track_key
            LAST_UPLOADED_THUMBNAIL = match.group(0)
            return LAST_UPLOADED_THUMBNAIL
    except Exception:
        print("écouldn uplod")


    return None

def get_info():
    global prevmusic
    players = run("playerctl -l").splitlines()
    if not players:
        return None
    player = players[0]
    # take the first of the two that has a title
    for p in players:
        t = run(f"playerctl -p {p} metadata xesam:title")
        if t:
            player = p
            break
    title = run(f"playerctl -p {player} metadata xesam:title")
    artist = run(f"playerctl -p {player} metadata xesam:artist")
    album = run(f"playerctl -p {player} metadata xesam:album")
    status = run(f"playerctl -p {player} status")
    pos = run(f"playerctl -p {player} position")
    length = run(f"playerctl -p {player} metadata mpris:length")
    art = run(f"playerctl -p {player} metadata mpris:artUrl") or run(f"playerctl -p {player} metadata xesam:artUrl") or run(f"playerctl -p {player} metadata artUrl")

    track_key = "|".join([
        title or "",
        artist or "",
        str(parse_time_value(length)),
        run(f"playerctl -p {player} metadata xesam:url") or ""
    ])
    if not prevmusic or prevmusic != track_key:
        print(f"New track: {track_key}")
        prevmusic = track_key

    if art:
        parsed = urllib.parse.urlparse(art)
        local_path = None
        if parsed.scheme == "file":
            local_path = parsed.path
        elif os.path.exists(art):
            local_path = art

        if local_path:
            uploaded = upload_with_script(local_path, track_key)
            if uploaded:
                art = uploaded

    return {
        "title": title or None,
        "artist": artist or None,
        "album": album or None,
        "currentTime": parse_time_value(pos),
        "duration": parse_time_value(length),
        "isPaused": status != "Playing",
        "thumbnail": art or None,
        "url": None
    }

def post_update(data):
    try:
        requests.post(f"{SERVER}/update", json=data, timeout=2)
    except Exception:
        pass

def post_clear():
    try:
        requests.post(f"{SERVER}/clear", timeout=2)
    except Exception:
        pass

if __name__ == "__main__":
    while True:
        info = get_info()
        if info:
            post_update(info)
        else:
            post_clear()
        time.sleep(1)
