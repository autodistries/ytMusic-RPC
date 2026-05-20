#!/usr/bin/env python3
import os
import re
import subprocess
import threading
import time
import urllib.parse

import requests

SERVER = "http://127.0.0.1:8766"

UPLOAD_CMD = os.environ.get("TET_UPLOAD_CMD", "/home/cat/scripts/zipline-temp-upload.sh")

_upload_lock = threading.Lock()
_upload_state = {"path": None, "url": None, "running": False}

prevmusic = None
prevart = None
current_player = None

def run(cmd):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return p.stdout.strip()


def parse_time_value(value):
    if not value:
        return 0.0
    try:
        return float(value) / 1_000_000.0
    except Exception:
        return 0.0


def _run_upload(path):
    if not os.path.exists(UPLOAD_CMD):
        return None
    try:
        print("Trying to upload")
        p = subprocess.run(f'{UPLOAD_CMD} "{path}"', shell=True, capture_output=True, text=True, timeout=15)
        output = (p.stdout or "") + "\n" + (p.stderr or "")
        print("ha ran", output)
        match = re.search(r'https?://[^\s\"\'"<>]+', output)
        if match:
            return match.group(0)
    except Exception:
        print("écouldn uplod")
    return None

def _upload_thread_fn(path):
    url = _run_upload(path)
    with _upload_lock:
        if _upload_state["path"] == path:
            _upload_state["url"] = url
            _upload_state["running"] = False

def get_info():
    global prevmusic, prevart, current_player
    players = run("playerctl -l").splitlines()
    if not players:
        current_player = None
        return None, False
    player = None
    paused_current = None
    for p in players:
        s = run(f"playerctl -p {p} status")
        if s == "Playing":
            player = p
            break
        if p == current_player and s == "Paused":
            paused_current = p
    if not player:
        if paused_current:
            player = paused_current
        else:
            current_player = None
            return None, False
    current_player = player
    fmt = "{{playerName}}\x1f{{status}}\x1f{{title}}\x1f{{artist}}\x1f{{album}}\x1f{{position}}\x1f{{mpris:length}}\x1f{{mpris:artUrl}}\x1f{{xesam:artUrl}}\x1f{{artUrl}}"
    values = run(f"playerctl -p {player} metadata --format '{fmt}'").split("\x1f")
    if len(values) < 10:
        values += [""] * (10 - len(values))

    _, status, title, artist, album, pos, length, art1, art2, art3 = values[:10]
    art = art1 or art2 or art3

    track_key = "|".join([
        title or "",
        artist or "",
        str(parse_time_value(length))
    ])
    new = False
    if prevmusic != track_key:
        print(f"New track: {track_key}")
        prevmusic = track_key
        prevart = None
        new = True

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
            with _upload_lock:
                sp, su = _upload_state["path"], _upload_state["url"]
            if sp == local_path:
                if su:
                    print("hit cache for this track")
                    art = su
                    prevart = art
                # else: upload still running, art stays as-is (no prevart update yet)
            else:
                with _upload_lock:
                    _upload_state.update({"path": local_path, "url": None, "running": True})
                threading.Thread(target=_upload_thread_fn, args=(local_path,), daemon=True).start()
                # art stays as-is until upload finishes
        else:
            prevart = art
    else:
        if prevart is not None and not new:
            print("restored art (ytm)")
            art = prevart

    return {
        "title": title or None,
        "artist": artist or None,
        "album": album or None,
        "currentTime": parse_time_value(pos),
        "duration": parse_time_value(length),
        "isPaused": status != "Playing",
        "thumbnail": art or None,
    }, new

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
    last_sent_pos = None
    last_sent_time = None
    last_was_paused = None
    last_sent_thumbnail = None
    had_info = False

    try:
        while True:
            info, new_track = get_info()
            now = time.monotonic()

            if info:
                current_pos = info["currentTime"]
                is_paused = info["isPaused"]
                should_send = False

                glitched_pos = current_pos < 0.1 and (last_sent_pos or 0.0) < 0.1

                if new_track:
                    should_send = True
                elif info["thumbnail"] != last_sent_thumbnail:
                    print("thb changed")
                    should_send = True
                elif last_sent_pos is None or last_sent_time is None:
                    print("never pushed")
                    should_send = True
                elif is_paused != last_was_paused:
                    should_send = True
                elif is_paused:
                    pass  # discord holds position while paused, nothing to correct
                elif glitched_pos:
                    print("glitched")
                    pass  # playerctl position glitch, ignore
                elif current_pos < last_sent_pos:
                    print(f"backward seek {current_pos=} {last_sent_pos=}")
                    should_send = True  # seeked backward
                else:
                    elapsed = now - last_sent_time
                    expected_pos = last_sent_pos + elapsed
                    if abs(current_pos - expected_pos) > 1.5:
                        print("elkej")
                        should_send = True  # drifted or seeked forward

                if should_send:
                    print(f"sending update: pos={current_pos:.1f}, paused={is_paused}, new={new_track}")
                    post_update(info)
                    last_sent_pos = current_pos
                    last_sent_time = now
                    last_was_paused = is_paused
                    last_sent_thumbnail = info["thumbnail"]

                had_info = True
            else:
                if had_info:
                    print("clearing")
                    post_clear()
                    last_sent_pos = None
                    last_sent_time = None
                    last_was_paused = None
                    last_sent_thumbnail = None
                had_info = False

            time.sleep(1)
    except KeyboardInterrupt:
        print("Exiting...")
