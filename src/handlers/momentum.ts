import { type Context } from 'hono'
import type { Bindings } from '../types'
import { getNextDailyUpdateTimestamp } from '../util'

// Hono context with bindings
type AppContext = Context<{ Bindings: Bindings }>

// 處理動能排行資料的通用函式 (需身份驗證)
export const getMomentumRangeData = async (c: AppContext, range: number) => {
	const cacheKey = `momentum_range_${range}_data`
	const kv = c.env.URTRADE_KV

	// 驗證已通過，檢查 KV 快取
	const cachedData = await kv.get(cacheKey)
	if (cachedData) {
		return c.text(cachedData, 200, {
			"Cache-Control": `public, max-age=3600`,
			"X-Cache": "HIT-KV" // 方便除錯
		})
	}

	// 從原始 API 獲取資料
	let apiResponse: string
	try {
		const originalApiUrl = `${c.env.API_HOST}/market/momentum/range/${range}`
		const headers = new Headers()
		const authHeader = c.req.header('Authorization')
		if (authHeader) {
			headers.append('authorization', authHeader)
		}

		const response = await fetch(originalApiUrl, { headers })

		if (!response.ok) {
			throw new Error('從原始 API 獲取資料失敗')
		}
		apiResponse = await response.text()
	} catch (error: any) {
		return c.text(`獲取資料時發生錯誤: ${error.message}`, 500)
	}

	// 3. 計算過期設定
	let browserMaxAge: number;

	// 固定模式：每天特定時間點過期 寫死UTC0點更新
	const expireAt = getNextDailyUpdateTimestamp(0);

	// 計算現在距離過期點還剩多少秒，作為瀏覽器 Cache-Control
	browserMaxAge = Math.max(0, expireAt - Math.floor(Date.now() / 1000));

	// await kv.put(cacheKey, apiResponse, kvPutOptions);

	// 【關鍵優化】：不要 await kv.put，直接放入後台執行
	c.executionCtx.waitUntil(
		kv.put(cacheKey, apiResponse, { expiration: expireAt })
	);

	return c.text(apiResponse, 200, {
		"Cache-Control": `public, max-age=${browserMaxAge}`,
		"X-Cache": "MISS"
	});
}
