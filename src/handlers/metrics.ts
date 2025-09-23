import { Hono, type Context } from 'hono'
import type { Bindings } from '../types'

/**
 * 處理快取邏輯的通用 Hono Handler。
 * 這個函數不再需要傳入端點字串，而是動態地從請求中獲取路徑。
 */
export const createDynamicCachedHandler = async (c: Context<{ Bindings: Bindings }>) => {

    // 定義一個快取過期時間（單位：秒）
    const CACHE_TTL = 3600 * 24 

  // 從請求中獲取完整的 URL (包含路徑和查詢參數)，作為快取鍵
  const cacheKey = `data:${c.req.url}`;
  const kv = c.env.URTRADE_KV;

  // 1. 檢查 KV 快取
  const cachedData = await kv.get(cacheKey);
  if (cachedData !== null) {
    // 找到了 KV 快取，回傳並設定 Edge Cache
    return c.text(cachedData, 200, {
      'Cache-Control': `public, max-age=${CACHE_TTL}`,
    });
  }

  // 2. 如果 KV 沒有快取，向原始 API 請求資料
  let apiResponse: string;
  try {
    const originalApiUrl = `${c.env.API_HOST}${c.req.path}`;
    // 原始 API 請求需要同時帶上查詢參數
    const response = await fetch(`${originalApiUrl}?days=60`);

    if (!response.ok) {
      throw new Error(`Failed to fetch from original API. Status: ${response.status}`);
    }

    apiResponse = await response.text();
  } catch (error: any) {
    // 處理請求失敗
    return c.text(`Error fetching data: ${error.message}`, 500);
  }

  // 3. 取得資料後，同時寫入 KV 和 Edge Cache
  // 將資料寫入 KV，並設定過期時間
  await kv.put(cacheKey, apiResponse, { expirationTtl: CACHE_TTL * 2 });

  // 回傳資料並設定 Edge Cache 標頭
  return c.text(apiResponse, 200, {
    'Cache-Control': `public, max-age=${CACHE_TTL}`,
  });
};