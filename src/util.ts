// KV 的絕對過期時間（expiration）必須在 60 秒以後，不足的會直接寫入失敗。
// 多留 5 秒，避免送出請求時剛好不足 60 秒。
const KV_MIN_LIFETIME_SECONDS = 65;

export const getNextDailyUpdateTimestamp = (targetUtcHour: number): number => {
    const now = new Date();
    const nextUpdate = new Date(now);
  
    nextUpdate.setUTCHours(targetUtcHour, 0, 0, 0);
  
    // 如果現在已經過了今天的更新時間，就把目標設為明天
    if (now >= nextUpdate) {
      nextUpdate.setUTCDate(nextUpdate.getUTCDate() + 1);
    }
  
    // 離更新點不到 65 秒時，KV 會拒絕這個過期時間（整個寫入失敗、這一輪沒有快取）；
    // 改成至少再活 65 秒，最多比更新點晚一分多鐘過期。
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return Math.max(Math.floor(nextUpdate.getTime() / 1000), nowSeconds + KV_MIN_LIFETIME_SECONDS);
};

// 公司代號格式：英數、點、減號，最長 10 碼（例如 BRK.B）。
// 代號會進 KV 快取 key 和上游網址，格式不對的一律不處理。
export const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,10}$/;

// 代號一律轉大寫，tsla / TSLA 共用同一份快取
export const normalizeSymbol = (raw: string | undefined): string => (raw ?? '').trim().toUpperCase();

const isEmptyValue = (value: unknown): boolean =>
  value === null ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);

/**
 * 上游回 200 不代表真的有資料。下面這些都當作「沒資料」，不要寫進 KV：
 *  - 空 body（空字串、只有空白）
 *  - JSON 本身是 null / [] / {}
 *  - JSON 物件有 data 欄位，但 data 是 null / [] / {}（例如 {"success":true,"data":[]}）
 * 不是 JSON 的內容只要不是空的就當作有資料。
 */
export const hasPayload = (text: string): boolean => {
  const body = text.trim();
  if (!body) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return true;
  }

  if (isEmptyValue(parsed)) return false;
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'data' in parsed) {
    return !isEmptyValue((parsed as { data: unknown }).data);
  }
  return true;
};