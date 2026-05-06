#!/usr/bin/env python3
import os
import re
import subprocess
import time
import urllib.parse

import requests

SERVER = "http://127.0.0.1:8766"

UPLOAD_ENABLED =  "1"
UPLOAD_CMD = os.environ.get("TET_UPLOAD_CMD", "/home/cat/scripts/zipline-temp-upload.sh")

LAST_UPLOAD_TRACK_FILE = None
LAST_UPLOADED_THUMBNAIL = None

prevmusic="non"
prevart = None

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
    global LAST_UPLOAD_TRACK_FILE, LAST_UPLOADED_THUMBNAIL

    if not UPLOAD_ENABLED or not os.path.exists(UPLOAD_CMD):
        return None

    if LAST_UPLOAD_TRACK_FILE == path and LAST_UPLOADED_THUMBNAIL:
        print("hit cache for this track")
        return LAST_UPLOADED_THUMBNAIL

    try:
        print("Trying to upload")
        p = subprocess.run(f'{UPLOAD_CMD} "{path}"', shell=True, capture_output=True, text=True, timeout=15)
        output = (p.stdout or "") + "\n" + (p.stderr or "")
        print("ha ran", output)
        match = re.search(r'https?://[^\s\"\'"<>]+', output)
        if match:
            LAST_UPLOAD_TRACK_FILE = path
            LAST_UPLOADED_THUMBNAIL = match.group(0)
            return LAST_UPLOADED_THUMBNAIL
    except Exception:
        print("écouldn uplod")


    return None

def get_info():
    global prevmusic, prevart
    players = run("playerctl -l").splitlines()
    if not players:
        return None
    player = None
    # take the first of the two that has a status of Playing else none
    for p in players:
        s = run(f"playerctl -p {p} status")
        if s == "Playing":
            player = p
            break
    if not player:
        return None
    fmt = "{{playerName}}\x1f{{status}}\x1f{{title}}\x1f{{artist}}\x1f{{album}}\x1f{{position}}\x1f{{mpris:length}}\x1f{{xesam:url}}\x1f{{mpris:artUrl}}\x1f{{xesam:artUrl}}\x1f{{artUrl}}"
    values = run(f"playerctl -p {player} metadata --format '{fmt}'").split("\x1f")
    if len(values) < 11:
        values += [""] * (11 - len(values))

    _, status, title, artist, album, pos, length, url, art1, art2, art3 = values[:11]
    art = art1 or art2 or art3

    track_key = "|".join([
        title or "",
        artist or "",
        str(parse_time_value(length))
    ])
    new=False
    if not prevmusic or prevmusic != track_key:
        print(f"New track: {track_key}")
        prevmusic = track_key
        new=True

    if art:
        if new:
            print(f"parsing art from {art}")
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
        prevart = art
    else:
        if not new:
            print("restored art (ytm)")
            art = prevart

    return {
        "title": title or None,
        "artist": artist or None,
        "album": album or None,
        "currentTime": parse_time_value(pos),
        "duration": parse_time_value(length),
        "isPaused": status != "Playing", # ultimately yhis is useless
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
    try:
        while True:
            info = get_info()
            if info:
                print(info)
                post_update(info)
            else:
                post_clear()
            time.sleep(0.96)
    except KeyboardInterrupt:
        print("Exiting...")
        post_clear()

