export { };

type AppConfig = {
    access_key?: string;
    unsplash_collection?: string;
    unsplash_query?: string;
    refresh_hour_utc?: number;
    refresh_minute_utc?: number;
};

type CachedImage = {
    url: string;
    author: string;
    fetchedAt: string;
    source: "startup" | "scheduled" | "manual";
};

const desktopImageWidth = 1920;
const desktopImageHeight = 1080;
const imageCacheControl = "public, max-age=86400, stale-while-revalidate=604800";
const corsHeaders: HeadersInit = {};

const port = 3000;
const statePath = "/data/current-image.json";
const optionsPath = "/data/options.json";

let currentImage: CachedImage | null = null;
let refreshTimer: Timer | null = null;
let refreshInFlight: Promise<void> | null = null;
let activeConfig: AppConfig = {};

async function readJsonFile<T>(path: string): Promise<T | null> {
    try {
        return JSON.parse(await Bun.file(path).text()) as T;
    } catch {
        return null;
    }
}

async function loadConfig(): Promise<AppConfig> {
    const config = await readJsonFile<AppConfig>(optionsPath);
    return config ?? {};
}

function sanitizeValue(value: string): string {
    return value.trim();
}

function buildUnsplashUrl(config: AppConfig): string {
    const accessKey = sanitizeValue(config.access_key ?? Bun.env.UNSPLASH_ACCESS_KEY ?? "");
    if (!accessKey) {
        throw new Error("Missing Unsplash access key. Set add-on option access_key or UNSPLASH_ACCESS_KEY.");
    }

    const query = sanitizeValue(config.unsplash_query ?? "nature") || "nature";
    const collection = sanitizeValue(config.unsplash_collection ?? "");
    const searchParams = new URLSearchParams({
        client_id: accessKey,
        query,
        orientation: "landscape",
    });

    if (collection) {
        searchParams.set("collections", collection);
    }

    return `https://api.unsplash.com/photos/random?${searchParams.toString()}`;
}

function buildDesktopImageUrl(sourceUrl: string): string {
    const url = new URL(sourceUrl);
    url.searchParams.set("w", String(desktopImageWidth));
    url.searchParams.set("h", String(desktopImageHeight));
    url.searchParams.set("fit", "crop");
    url.searchParams.set("crop", "entropy");
    url.searchParams.set("q", "85");
    url.searchParams.set("fm", "jpg");
    url.searchParams.set("auto", "format");
    return url.toString();
}

async function fetchFreshImage(source: CachedImage["source"]): Promise<CachedImage> {
    const response = await fetch(buildUnsplashUrl(activeConfig), {
        headers: {
            Accept: "application/json",
            "User-Agent": "oma-image-provider",
        },
    });

    if (!response.ok) {
        throw new Error(`Unsplash request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
        urls?: { regular?: string; full?: string; raw?: string };
        user?: { name?: string };
    };

    const sourceUrl = payload.urls?.raw ?? payload.urls?.full ?? payload.urls?.regular;
    if (!sourceUrl) {
        throw new Error("Unsplash response did not include an image URL");
    }

    const url = buildDesktopImageUrl(sourceUrl);

    currentImage = {
        url,
        author: payload.user?.name ?? "Unknown",
        fetchedAt: new Date().toISOString(),
        source,
    };

    await Bun.write(statePath, JSON.stringify(currentImage, null, 2));
    return currentImage;
}

function nextRefreshDelayMs(hourUtc: number, minuteUtc: number): number {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(hourUtc, minuteUtc, 0, 0);
    if (next.getTime() <= now.getTime()) {
        next.setUTCDate(next.getUTCDate() + 1);
    }
    return next.getTime() - now.getTime();
}

function cacheHeaders(): HeadersInit {
    return {
        "cache-control": imageCacheControl,
        vary: "accept",
        ...corsHeaders,
    };
}

async function scheduleNextRefresh(): Promise<void> {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    const config = await loadConfig();
    const hourUtc = config.refresh_hour_utc ?? 0;
    const minuteUtc = config.refresh_minute_utc ?? 0;
    const delay = nextRefreshDelayMs(hourUtc, minuteUtc);

    refreshTimer = setTimeout(async () => {
        try {
            await refreshImage("scheduled");
        } finally {
            await scheduleNextRefresh();
        }
    }, delay);
}

async function refreshImage(source: CachedImage["source"]): Promise<void> {
    if (refreshInFlight) {
        await refreshInFlight;
        return;
    }

    refreshInFlight = fetchFreshImage(source)
        .then(() => undefined)
        .finally(() => {
            refreshInFlight = null;
        });

    await refreshInFlight;
}

async function readCurrentImage(): Promise<CachedImage | null> {
    if (currentImage) {
        return currentImage;
    }

    const stored = await readJsonFile<CachedImage>(statePath);
    if (stored?.url) {
        currentImage = stored;
        return currentImage;
    }

    return currentImage;
}

const server = Bun.serve({
    port,
    fetch: async (request) => {
        const url = new URL(request.url);

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders,
            });
        }

        if (url.pathname === "/health") {
            return Response.json({ ok: true }, { headers: corsHeaders });
        }

        if (url.pathname === "/image") {
            const image = await readCurrentImage();
            if (!image) {
                return Response.json({ error: "Image not loaded yet" }, { status: 503 });
            }

            return Response.json(image, {
                headers: cacheHeaders(),
            });
        }

        if (url.pathname === "/image-url") {
            const image = await readCurrentImage();
            if (!image) {
                return new Response("Image not loaded yet", { status: 503 });
            }

            return new Response(image.url, {
                headers: {
                    "content-type": "text/plain; charset=utf-8",
                    ...cacheHeaders(),
                },
            });
        }

        if (url.pathname === "/") {
            const image = await readCurrentImage();
            if (!image) {
                return new Response("Starting image refresh...", { status: 503 });
            }

            return new Response(
                `<!doctype html><html><head><meta charset="utf-8"><title>OMA Image Provider</title></head><body><img src="${image.url}" alt="Unsplash image" style="max-width:100%;height:auto"></body></html>`,
                {
                    headers: {
                        "content-type": "text/html; charset=utf-8",
                        "cache-control": imageCacheControl,
                    },
                },
            );
        }

        return new Response("Not found", { status: 404 });
    },
});

activeConfig = await loadConfig();
await refreshImage("startup");
await scheduleNextRefresh();

console.log(`OMA Image Provider running on http://0.0.0.0:${server.port}`);
