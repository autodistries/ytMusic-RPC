/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { ApplicationAssetUtils, FluxDispatcher } from "@webpack/common";

const logger = new Logger("anyMediaRPC");

const Native = VencordNative.pluginHelpers.anyMediaRPC as PluginNative<typeof import("./native")>;
let applicationId = "";
let pollInterval: ReturnType<typeof setInterval> | null = null;

let lastDataHash = "";
function hashData(data: Record<string, unknown>) {
    return [
        data.title,
        data.artist,
        data.isPaused,
        Math.floor(data.currentTime as number),
        Math.floor(data.duration as number),
        data.url
    ].join("|");
}

async function getApplicationAsset(key: string): Promise<string> {
    if (!applicationId) return "";
    return (await ApplicationAssetUtils.fetchAssetIds(applicationId, [key]))[0];
}

function setActivity(activity: Record<string, unknown> | null) {
    try {
        FluxDispatcher.dispatch({
            type: "LOCAL_ACTIVITY_UPDATE",
            activity: activity,
            socketId: "anyMediaRPC",
        });
    } catch (e) {
        logger.error("Failed to set activity:", e);
    }
}

async function createActivity(data: Record<string, unknown>) {
    if (!applicationId) return null;
    let largeImage: string | undefined;
    if (data.thumbnail) {
        let url = String(data.thumbnail).replace("http://", "https://");
        if (url.includes("lh3.googleusercontent.com") && !url.includes("-rj")) {
            url = url.replace(/=w\d+(-h\d+)?/, "=w544-h544-rj");
        }
        try {
            largeImage = await getApplicationAsset(url);
            logger.log("Asset ID:", largeImage);
        } catch (e) {
            logger.error("Failed to fetch asset:", e);
            largeImage = url;
        }
    }

    const songUrl = String(data.url ?? "https://music.youtube.com");
    const buttonUrls = [songUrl];
    const activity: Record<string, unknown> = {
        application_id: applicationId,
        name: data.forceMain || `${data.title} − ${data.artist}` || "music!!" as string,
            type: 2,
        details: String(data.title ?? "Unknown name").substring(0, 128),
        state: String(data.artist ?? "Unknown Artist").substring(0, 128),
        assets: {
            large_image: largeImage,
            large_text: String(data.album ?? "unknown album sry"),
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

    if (!data.isPaused && (data.duration as number) > 0) {
        const now = Date.now();
        activity.timestamps = {
            start: Math.floor(now - ((data.currentTime as number) * 1000)),
            end: Math.floor(now + (((data.duration as number) - (data.currentTime as number)) * 1000)),
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
        if (hash === lastDataHash) return;
        lastDataHash = hash;
        const activity = await createActivity(data);
        setActivity(activity);
        logger.log("Updated:", data.title);
    } catch (e) {
        logger.error("Poll error:", e);
    }
}

export default definePlugin({
    name: "anyMediaRPC",
    description: "Display your media activity as Discord status. Works with the companion script or the browser extension for ytm.",
    authors: [{name: "catsoft", id:532967505438965780n}],
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
            logger.warn("No Application ID configured! Go to Settings > Plugins > anyMediaRPC");
            return;
        }

        logger.log("Starting with Application ID:", applicationId);
        if (!Native || !Native.startServer) {
            logger.error("Native module not loaded!");
            return;
        }

        const result = await Native.startServer(port);
        if (!result?.success) {
            logger.error("Failed to start HTTP server:", result?.error || "Unknown error");
            return;
        }

        pollInterval = setInterval(pollForUpdates, 1000);
    },

    stop() {
        logger.log("Stopping...");

        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }

        Native?.stopServer?.();
        setActivity(null);
    },
});
