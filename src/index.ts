import { Hono, type Context } from "hono";
import { cors } from "hono/cors"; // 導入 cors
import type { Bindings } from "./types";
import { auth } from "./middleware/auth";
import { getMomentumRangeData } from "./handlers/momentum";
import { createDynamicCachedHandler } from "./handlers/metrics";

// 將 Bindings 介面作為 Hono 應用程式的泛型參數
const app = new Hono<{ Bindings: Bindings }>();

// 啟用 CORS 中介軟體
app.use(
  cors({
    origin: (origin, c) => {
      const allowedOrigins = c.env.ALLOWED_ORIGINS.split(",");
      if (allowedOrigins.includes(origin)) {
        return origin;
      }
      return undefined; // or a default origin
    },
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
  })
);

// 定義一個快取過期時間（單位：秒）
const CACHE_TTL = 3600; // 3 小時

// 建立一個處理快取邏輯的通用 Hono Handler
const createCachedHandler = (endpoint: string, hours: number) => {
  return async (c: Context<{ Bindings: Bindings }>) => {
    const cacheKey = `data:${endpoint}`;
    const kv = c.env.URTRADE_KV;

    // 1. 檢查 KV 快取
    const cachedData = await kv.get(cacheKey);
    if (cachedData !== null) {
      // 找到了 KV 快取，回傳並設定 Edge Cache
      return c.text(cachedData, 200, {
        "Cache-Control": `public, max-age=${CACHE_TTL * hours}`,
      });
    }

    // 2. 如果 KV 沒有快取，向原始 API 請求資料
    let apiResponse: string;
    try {
      const originalApiUrl = `${c.env.API_HOST}${endpoint}`;
      const response = await fetch(originalApiUrl);

      if (!response.ok) {
        throw new Error("Failed to fetch from original API.");
      }

      apiResponse = await response.text();
    } catch (error: any) {
      // 處理請求失敗
      return c.text(`Error fetching data: ${error.message}`, 500);
    }

    // 3. 取得資料後，同時寫入 KV 和 Edge Cache
    // 將資料寫入 KV，並設定過期時間
    await kv.put(cacheKey, apiResponse, { expirationTtl: CACHE_TTL * hours * 1.3 });

    // 回傳資料並設定 Edge Cache 標頭
    return c.text(apiResponse, 200, {
      "Cache-Control": `public, max-age=${CACHE_TTL * hours}`,
    });
  };
};

app.get(
  "/market/momentum/range/1",
  createCachedHandler("/market/momentum/range/1", 1)
);
app.get("/stock/breadth", createCachedHandler("/stock/breadth", 20));
app.get("/stock/symbols", createCachedHandler("/stock/symbols", 720));
app.get("/stock/today", createCachedHandler("/stock/today", 20));
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
app.get("/market/momentum/range/3", auth, (c) => getMomentumRangeData(c, 3));
app.get("/market/momentum/range/7", auth, (c) => getMomentumRangeData(c, 7));
app.get("/market/momentum/range/30", auth, (c) => getMomentumRangeData(c, 30));

export default app;
