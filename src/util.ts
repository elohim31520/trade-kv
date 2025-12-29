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