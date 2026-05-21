/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const logger = new Logger("anyMediaRPC");

type MusicData = {
    title: string;
    artist: string;
    album: string;
    thumbnail: string;
    url: string;
    currentTime: number;
    duration: number;
    isPaused: boolean;
};

let server: Server | null = null;
let latestData: MusicData | null = null;
let shouldClear = false;

function resolvePort(arg1: unknown, arg2?: unknown): number {
    if (typeof arg1 === "number" && Number.isFinite(arg1)) {
        return arg1;
    }

    if (typeof arg2 === "number" && Number.isFinite(arg2)) {
        return arg2;
    }

    return 8766;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let raw = "";

        req.on("data", chunk => {
            raw += chunk.toString();
            if (raw.length > 1024 * 1024) {
                reject(new Error("Request body too large"));
                req.destroy();
            }
        });

        req.on("end", () => {
            if (!raw) {
                resolve({});
                return;
            }

            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error("Invalid JSON body"));
            }
        });

        req.on("error", reject);
    });
}

export async function startServer(arg1: unknown, arg2?: unknown): Promise<{ success: boolean; error?: string; }> {
    if (server) {
        return { success: true };
    }

    const port = resolvePort(arg1, arg2);

    return await new Promise(resolve => {
        const httpServer = createServer(async (req, res) => {
            try {
                const method = req.method || "";
                const path = req.url || "";

                if (method === "GET" && path === "/status") {
                    sendJson(res, 200, { ok: true });
                    return;
                }

                if (method === "POST" && path === "/update") {
                    const body = await readJsonBody(req);
                    latestData = body as MusicData;
                    shouldClear = false;
                    sendJson(res, 200, { success: true });
                    return;
                }

                if (method === "POST" && path === "/clear") {
                    latestData = null;
                    shouldClear = true;
                    sendJson(res, 200, { success: true });
                    return;
                }

                sendJson(res, 404, { error: "Not found" });
            } catch (e) {
                const message = e instanceof Error ? e.message : "Unknown error";
                sendJson(res, 400, { error: message });
            }
        });

        httpServer.once("error", (err: NodeJS.ErrnoException) => {
            const message = err?.code ? `${err.code}: ${err.message}` : (err?.message || "Unknown error");
            logger.error("Failed to start server:", message);
            resolve({ success: false, error: message });
        });

        httpServer.listen(port, "127.0.0.1", () => {
            server = httpServer;
            logger.log("HTTP server listening on 127.0.0.1:" + port);
            resolve({ success: true });
        });
    });
}

export async function stopServer(): Promise<void> {
    if (!server) return;

    await new Promise<void>((resolve) => {
        server?.close(() => resolve());
    });

    server = null;
    latestData = null;
    shouldClear = false;
    logger.log("HTTP server stopped");
}

export async function getLatestData(): Promise<{
    title: string;
    artist: string;
    album: string;
    thumbnail: string;
    url: string;
    currentTime: number;
    duration: number;
    isPaused: boolean;
} | null> {
    return latestData;
}

export async function getShouldClear(): Promise<boolean> {
    const value = shouldClear;
    shouldClear = false;
    return value;
}
