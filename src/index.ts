import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import { auth } from "./middleware/auth";
import { getMomentumRangeData } from "./handlers/momentum";
import { createDynamicCachedHandler } from "./handlers/metrics";
import { getNextDailyUpdateTimestamp } from './util'

// 將 Bindings 介面作為 Hono 應用程式的泛型參數
const app = new Hono<{ Bindings: Bindings }>();

app.use(
  cors({
    origin: (origin, c) => {
      const allowedOrigins = c.env.ALLOWED_ORIGINS.split(",");
      if (allowedOrigins.includes(origin)) {
        return origin;
      }
      return undefined;
    },
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
  })
);

type CacheOptions = 
  | number                     // 傳統的滾動小時數
  | { type: 'daily', utcHour: number }; // 固定每天幾點過期

const createCachedHandler = (endpoint: string, options: CacheOptions) => {
  return async (c: Context<{ Bindings: Bindings }>) => {
    const cacheKey = `data:${endpoint}`;
    const kv = c.env.URTRADE_KV;

    // 1. 檢查 KV 快取
    const cachedData = await kv.get(cacheKey);
    if (cachedData !== null) {
      return c.text(cachedData, 200, {
        "Cache-Control": `public, max-age=3600`, // Edge/Browser 緩存可以設短一點，讓它頻繁回來看 KV
      });
    }

    // 2. 請求 API
    let apiResponse: string;
    try {
      const originalApiUrl = `${c.env.API_HOST}${endpoint}`;
      const response = await fetch(originalApiUrl);
      if (!response.ok) throw new Error("Failed to fetch");
      apiResponse = await response.text();
    } catch (error: any) {
      return c.text(`Error: ${error.message}`, 500);
    }

    // 3. 計算過期設定
    let kvPutOptions: { expirationTtl?: number; expiration?: number } = {};
    let browserMaxAge: number;

    if (typeof options === 'number') {
      // 傳統模式：滾動 TTL
      const ttlSeconds = options * 3600;
      kvPutOptions.expirationTtl = ttlSeconds * 1.3; // KV 存久一點點作為緩衝
      browserMaxAge = ttlSeconds;
    } else {
      // 固定模式：每天特定時間點過期
      const expireAt = getNextDailyUpdateTimestamp(options.utcHour);
      kvPutOptions.expiration = expireAt;
      
      // 計算現在距離過期點還剩多少秒，作為瀏覽器 Cache-Control
      browserMaxAge = Math.max(0, expireAt - Math.floor(Date.now() / 1000));
    }

    // 寫入 KV
    await kv.put(cacheKey, apiResponse, kvPutOptions);

    return c.text(apiResponse, 200, {
      "Cache-Control": `public, max-age=${browserMaxAge}`,
    });
  };
};

// 滾動 1 小時 (適合更新頻繁的資料)
app.get(
  "/market/momentum/range/1",
  createCachedHandler("/market/momentum/range/1", 1)
);

app.get("/stock/symbols", createCachedHandler("/stock/symbols", 720));

//每天固定時間更新：(適合每日收盤資料)
// 假設台灣時間 08:00 (UTC 00:00) 更新，我們就把 KV 設在該時間點失效
app.get("/stock/today", createCachedHandler("/stock/today", { 
  type: 'daily', 
  utcHour: 0 
}));

app.get("/stock/breadth", createCachedHandler("/stock/breadth", { 
  type: 'daily', 
  utcHour: 0 
}));

app.get("/market/quotes", createCachedHandler("/market/quotes", 1));

app.get("/statements/:symbol", createDynamicCachedHandler);

app.get("/news", async (c) => {
  const page = c.req.query("page");
  const size = c.req.query("size");

  if (page === "1" && size === "10") {
    return createCachedHandler("/news?page=1&size=10", 1)(c);
  }
});

// 新增需要身份驗證的 API 端點
app.get("/market/momentum/range/3", (c) => getMomentumRangeData(c, 3)); //3天改成不需登入驗證
app.get("/market/momentum/range/7", auth, (c) => getMomentumRangeData(c, 7));
app.get("/market/momentum/range/30", auth, (c) => getMomentumRangeData(c, 30));

export default app;
