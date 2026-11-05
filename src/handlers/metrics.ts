import { Hono, type Context } from 'hono'
import type { Bindings } from '../types'
import { isHotCompany } from '../constants/hotCompanies'
import { hasPayload, normalizeSymbol } from '../util'

/**
 * 處理快取邏輯的通用 Hono Handler。
 * 這個函數不再需要傳入端點字串，而是動態地從請求中獲取路徑。
 */
export const createDynamicCachedHandler = async (c: Context<{ Bindings: Bindings }>) => {

    // 定義一個快取過期時間（單位：秒）
    const CACHE_TTL = 3600 * 20

  // 代號格式已在 metricsAccess 驗證過；一律轉大寫，tsla / TSLA 共用同一份快取
  const symbol = normalizeSymbol(c.req.param('symbol'));

  // 熱門公司是公開資料，可讓瀏覽器／CDN 共用快取；
  // 其餘公司要登入才拿得到，用 private 避免被共用快取存下來發給沒登入的人
  const cacheScope = isHotCompany(symbol) ? 'public' : 'private';

  // 快取鍵只用代號，不含 query string：這支 handler 不看 days（永遠向上游要 days=60），
  // 如果把整個網址當 key，?days=1、?x=1 之類的網址就會各自打一次上游、各寫一份 KV
  const cacheKey = `data:metrics:${symbol}`;
  const kv = c.env.URTRADE_KV;

  // 1. 檢查 KV 快取
  const cachedData = await kv.get(cacheKey);
  if (cachedData !== null) {
    // 找到了 KV 快取，回傳並設定 Edge Cache
    return c.text(cachedData, 200, {
      'Cache-Control': `${cacheScope}, max-age=${CACHE_TTL}`,
    });
  }

  // 2. 如果 KV 沒有快取，向原始 API 請求資料
  let apiResponse: string;
  try {
    // 上游固定要 60 天；代號用驗證過的大寫版本，不直接拼使用者傳來的原始字串
    const response = await fetch(`${c.env.API_HOST}/company-metrics/${symbol}?days=60`);

    if (!response.ok) {
      throw new Error(`Failed to fetch from original API. Status: ${response.status}`);
    }

    apiResponse = await response.text();
  } catch (error: any) {
    // 處理請求失敗
    return c.text(`Error fetching data: ${error.message}`, 500);
  }

  // 上游回 200 但其實沒資料：照實回給呼叫端，但不寫 KV、也不讓瀏覽器／CDN 存下來
  if (!hasPayload(apiResponse)) {
    return c.text(apiResponse, 200, {
      'Cache-Control': 'no-store',
    });
  }

  // 3. 取得資料後寫入 KV，並設定過期時間
  // 放背景寫入、不 await：KV 寫入失敗或被限流時，不要讓已經拿到資料的請求跟著變 500
  c.executionCtx.waitUntil(
    kv.put(cacheKey, apiResponse, { expirationTtl: CACHE_TTL * 1.3 })
  );

  // 回傳資料並設定 Edge Cache 標頭
  return c.text(apiResponse, 200, {
    'Cache-Control': `${cacheScope}, max-age=${CACHE_TTL}`,
  });
};