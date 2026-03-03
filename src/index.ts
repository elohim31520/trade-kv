import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import { auth } from "./middleware/auth";
import { getMomentumRangeData } from "./handlers/momentum";
import { createDynamicCachedHandler } from "./handlers/metrics";
import { getNextDailyUpdateTimestamp } from './util';

const app = new Hono<{ Bindings: Bindings }>();

// --- 類型定義 ---
type DailyExpiration = { type: 'daily'; utcHour: number };
type CacheOptions = {
  expiration: number | DailyExpiration; // 數字代表小時，物件代表每日固定點
};

// --- 通用快取處理器 ---
const createCachedHandler = (endpoint: string, options: CacheOptions) => {
  return async (c: Context<{ Bindings: Bindings }>) => {
    const url = new URL(c.req.url);
    // 自動組合 path + query params 作為唯一 Key
    // 如果 endpoint 已經帶有 query string，這裡要小心處理，通常建議傳入純路徑
    const fullPath = endpoint.includes('?') ? endpoint : `${endpoint}${url.search}`;
    const cacheKey = `data:cache:${fullPath}`;
    const kv = c.env.URTRADE_KV;

    // 1. 嘗試從 KV 讀取
    const cachedData = await kv.get(cacheKey);
    if (cachedData !== null) {
      return c.text(cachedData, 200, {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": "public, max-age=3600",
        "X-Cache": "HIT-KV"
      });
    }

    // 2. 請求原始 API (不強制驗證，但如果有傳 Authorization 就會帶過去)
    try {
      const originalApiUrl = `${c.env.API_HOST}${fullPath}`;
      const headers = new Headers();
      const authHeader = c.req.header('Authorization');
      if (authHeader) headers.set('Authorization', authHeader);

      const response = await fetch(originalApiUrl, { headers });
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

      const apiResponse = await response.text();

      // 3. 計算過期設定
      let kvPutOptions: { expiration?: number; expirationTtl?: number } = {};
      let browserMaxAge: number;

      if (typeof options.expiration === 'number') {
        // 滾動小時模式
        const ttlSeconds = options.expiration * 3600;
        kvPutOptions.expirationTtl = Math.max(60, ttlSeconds); // KV 最小限制 60s
        browserMaxAge = ttlSeconds;
      } else {
        // 每日固定點模式
        const expireAt = getNextDailyUpdateTimestamp(options.expiration.utcHour);
        kvPutOptions.expiration = expireAt;
        browserMaxAge = Math.max(0, expireAt - Math.floor(Date.now() / 1000));
      }

      // 4. 背景寫入 KV
      c.executionCtx.waitUntil(
        kv.put(cacheKey, apiResponse, kvPutOptions)
      );

      return c.text(apiResponse, 200, {
        "Content-Type": "application/json; charset=UTF-8",
        "Cache-Control": `public, max-age=${browserMaxAge}`,
        "X-Cache": "MISS"
      });

    } catch (error: any) {
      return c.text(`Backend Error: ${error.message}`, 502);
    }
  };
};

// --- 中介軟體 ---
app.use(cors({
  origin: (origin, c) => {
    const allowed = c.env.ALLOWED_ORIGINS.split(",");
    return allowed.includes(origin) ? origin : undefined;
  },
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ["GET", "POST", "PUT", "DELETE"],
}));

// --- 路由設定 ---

// 1. 滾動時間快取 (小時)
app.get("/market/momentum/range/1", createCachedHandler("/market/momentum/range/1", { expiration: 1 }));
app.get("/market/quotes", createCachedHandler("/market/quotes", { expiration: 1 }));
app.get("/stock/symbols", createCachedHandler("/stock/symbols", { expiration: 720 }));

// 2. 每日固定時間快取 (UTC 03:00)
const dailyStockOptions: CacheOptions = { expiration: { type: 'daily', utcHour: 3 } };
app.get("/stock/today", createCachedHandler("/stock/today", dailyStockOptions));
app.get("/stock/breadth", createCachedHandler("/stock/breadth", dailyStockOptions));

// 3. 特殊邏輯路由
app.get("/company-metrics/:symbol", createDynamicCachedHandler);

app.get("/news", async (c) => {
  const page = c.req.query("page");
  const size = c.req.query("size");
  // 僅快取第一頁新聞，過期時間 1 小時
  if (page === "1" && size === "10") {
    return createCachedHandler("/news", { expiration: 1 })(c);
  }
});

// 4. 動能排行系列 (3天不需驗證，其餘需要)
app.get("/market/momentum/range/3", (c) => getMomentumRangeData(c, 3));
app.get("/market/momentum/range/7", auth, (c) => getMomentumRangeData(c, 7));
app.get("/market/momentum/range/30", auth, (c) => getMomentumRangeData(c, 30));

export default app;