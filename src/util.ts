export const getNextDailyUpdateTimestamp = (targetUtcHour: number): number => {
    const now = new Date();
    const nextUpdate = new Date(now);
  
    nextUpdate.setUTCHours(targetUtcHour, 0, 0, 0);
  
    // 如果現在已經過了今天的更新時間，就把目標設為明天
    if (now >= nextUpdate) {
      nextUpdate.setUTCDate(nextUpdate.getUTCDate() + 1);
    }
  
    return Math.floor(nextUpdate.getTime() / 1000);
};

// 公司代號格式：英數、點、減號，最長 10 碼（例如 BRK.B）。
// 代號會進 KV 快取 key 和上游網址，格式不對的一律不處理。
export const SYMBOL_PATTERN = /^[A-Z0-9.-]{1,10}$/;

// 代號一律轉大寫，tsla / TSLA 共用同一份快取
export const normalizeSymbol = (raw: string | undefined): string => (raw ?? '').trim().toUpperCase();