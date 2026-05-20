/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";

const Native = VencordNative.pluginHelpers.YTMusicRPC as PluginNative<typeof import("./native")>;
let applicationId = "";
let pollInterval: ReturnType<typeof setInterval> | null = null;

let lastDataHash = "";
function hashData(data: any) {
    return [
        data.title,
        data.artist,
        data.isPaused,
        Math.floor(data.currentTime),
        Math.floor(data.duration),
        data.url
    ].join("|");
}

async function getApplicationAsset(key: string): Promise<string> {
    if (!applicationId) return "";
    return (await ApplicationAssetUtils.fetchAssetIds(applicationId, [key]))[0];
}

function setActivity(activity: any | null) {
    try {
        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            activity: activity,
            socketId: "anyMediaRPC",
        });
    } catch (e) {
        console.error("[anyMediaRPC] Failed to set activity:", e);
    }
}

async function createActivity(data: any) {
    if (!applicationId) return null;
    let largeImage: string | undefined;
    if (data.thumbnail) {
        let url = data.thumbnail.replace("http://", "https://");
        if (url.includes("lh3.googleusercontent.com") && !url.includes("-rj")) {
            url = url.replace(/=w\d+(-h\d+)?/, "=w544-h544-rj");
        }
        try {
            largeImage = await getApplicationAsset(url);
            console.log("[anyMediaRPC] Asset ID:", largeImage);
        } catch {
            largeImage = url;
        }
    }

    const songUrl = data.url || "https://music.youtube.com";
    const buttonUrls = [songUrl];
    const activity: any = {
        application_id: applicationId,
        name: data.forceMain || `${data.title} − ${data.artist}` || "music!!",
            type: 2,
        details: data.title?.substring(0, 128) || "Unknown name",
        state: data.artist?.substring(0, 128) || "Unknown Artist",
        assets: {
            large_image: largeImage,
            large_text: data.album || "unknown album sry",
            // small_image: "youtube_music_logo",
            // small_text: "YouTube Music",
        },
        // buttons: ["Listen on YouTube Music"],
        // metadata: {
        //     button_urls: buttonUrls,
        // },
        // details_url: songUrl,
        // state_url: `https://music.youtube.com/search?q=${encodeURIComponent(data.artist || "")}`,
        flags: 1,
    };

    if (!data.isPaused && data.duration > 0) {
        const now = Date.now();
        activity.timestamps = {
            start: Math.floor(now - (data.currentTime * 1000)),
            end: Math.floor(now + ((data.duration - data.currentTime) * 1000)),
        };
    }

    return activity;
}

async function pollForUpdates() {
    try {
        const shouldClear = await Native.getShouldClear();
        if (shouldClear) {
            setActivity(null);
            lastDataHash = "";
            return;
        }

        const data = await Native.getLatestData();
        if (!data) return;
        const hash = hashData(data);
        if (hash === lastDataHash) return; // skip if nothing changed
        lastDataHash = hash;
        const activity = await createActivity(data);
        setActivity(activity);
        console.log("[anyMediaRPC] Updated:", data.title);
    } catch (e) {
        console.error("[anyMediaRPC] Poll error:", e);
    }
}

export default definePlugin({
    name: "anyMediaRPC",
    description: "Display your media activity as Discord status. Works with the companion script or the browser extension for ytm.",
    authors: [532967505438965780n],
    settings: definePluginSettings({
        applicationId: {
            type: OptionType.STRING,
            description: "Your Discord Application ID (from Developer Portal)",
            default: "",
        },
        port: {
            type: OptionType.NUMBER,
            description: "HTTP port for connection local server",
            default: 8766,
        },
    }),

    async start() {
        const settings = Vencord.Settings.plugins.anyMediaRPC;
        applicationId = settings?.applicationId || "";
        const port = settings?.port || 8766;
        if (!applicationId) {
            console.warn("[anyMediaRPC] No Application ID configured! Go to Settings > Plugins > anyMediaRPC");
            return;
        }

        console.log("[anyMediaRPC] Starting with Application ID:", applicationId);
        if (!Native || !Native.startServer) {
            console.error("[anyMediaRPC] Native module not loaded!");
            return;
        }

        const result = await Native.startServer(port);
        if (!result?.success) {
            console.error("[anyMediaRPC] Failed to start HTTP server:", result?.error || "Unknown error");
            return;
        }

        pollInterval = setInterval(pollForUpdates, 1000);
    },

    stop() {
        console.log("[anyMediaRPC] Stopping...");

        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }

        Native?.stopServer?.();
        setActivity(null);
    },
});
