import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { Bindings } from "./types";
import { auth } from "./middleware/auth";
import { metricsAccess } from "./middleware/metricsAccess";
import { knownSymbol } from "./middleware/knownSymbol";
import { getMomentumRangeData } from "./handlers/momentum";
import { createDynamicCachedHandler } from "./handlers/metrics";
import { getNextDailyUpdateTimestamp, hasPayload } from './util';

const app = new Hono<{ Bindings: Bindings }>();

// --- 類型定義 ---
type DailyExpiration = { type: 'daily'; utcHour: number };
type CacheOptions = {
  expiration: number | DailyExpiration; // 數字代表小時，物件代表每日固定點
};

// --- 通用快取處理器 ---
// 快取 key 和上游網址都只由 endpoint 決定，請求自己帶的 query string 一律忽略：
// 否則 ?a=1、?a=2 ... 每一個都會各打一次上游、各寫一份 KV。
// 路由需要固定的 query 時，直接寫在 endpoint 裡（例如 /news?page=1&size=10）。
const createCachedHandler = (endpoint: string, options: CacheOptions) => {
  const cacheKey = `data:cache:${endpoint}`;

  return async (c: Context<{ Bindings: Bindings }>) => {
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
      const originalApiUrl = `${c.env.API_HOST}${endpoint}`;
      const headers = new Headers();
      const authHeader = c.req.header('Authorization');
      if (authHeader) headers.set('Authorization', authHeader);

      const response = await fetch(originalApiUrl, { headers });
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

      const apiResponse = await response.text();

      // 上游回 200 但其實沒資料：照實回給呼叫端，但不寫 KV、也不讓瀏覽器快取
      if (!hasPayload(apiResponse)) {
        return c.text(apiResponse, 200, {
          "Content-Type": "application/json; charset=UTF-8",
          "Cache-Control": "no-store",
          "X-Cache": "BYPASS-EMPTY"
        });
      }

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
// 改這裡的 expiration 時，src/symbols.ts 的 SYMBOLS_TTL_SECONDS 要一起改
app.get("/stock/symbols", createCachedHandler("/stock/symbols", { expiration: 24 }));

// 2. 每日固定時間快取 (UTC 03:00)
const dailyStockOptions: CacheOptions = { expiration: { type: 'daily', utcHour: 3 } };
app.get("/stock/today", createCachedHandler("/stock/today", dailyStockOptions));
app.get("/stock/breadth", createCachedHandler("/stock/breadth", dailyStockOptions));

// 3. 特殊邏輯路由
// 熱門公司公開，其餘公司要登入（Authorization 由 BFF 從 httpOnly cookie 帶入）；
// 代號不在站上公司清單（/stock/symbols）的直接 404，不讀也不寫 KV
app.get("/company-metrics/:symbol", metricsAccess, knownSymbol, createDynamicCachedHandler);

// 只提供第一頁新聞（過期時間 1 小時）；其他頁前端直接走原始 API，不經過這裡。
// key 和上游網址固定是 /news?page=1&size=10，額外帶的 query 一律忽略，不會多寫 KV。
const newsFirstPage = createCachedHandler("/news?page=1&size=10", { expiration: 1 });
app.get("/news", async (c) => {
  if (c.req.query("page") === "1" && c.req.query("size") === "10") {
    return newsFirstPage(c);
  }
  return c.json(
    { success: false, error: "不支援的參數", message: "此端點只提供第一頁新聞（page=1&size=10）" },
    400
  );
});

// 4. 動能排行系列 (3天不需驗證，其餘需要)
app.get("/market/momentum/range/3", (c) => getMomentumRangeData(c, 3));
app.get("/market/momentum/range/7", auth, (c) => getMomentumRangeData(c, 7));
app.get("/market/momentum/range/30", auth, (c) => getMomentumRangeData(c, 30));

export default app;