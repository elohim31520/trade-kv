import { type Context } from 'hono'
import type { Bindings } from '../types'

// Hono context with bindings
type AppContext = Context<{ Bindings: Bindings }>
const CACHE_TTL = 3600 * 20

// 處理動能排行資料的通用函式 (需身份驗證)
export const getMomentumRangeData = async (c: AppContext, range: number) => {
	const cacheKey = `momentum_range_${range}_data`
	const kv = c.env.URTRADE_KV

	// 驗證已通過，檢查 KV 快取
	const cachedData = await kv.get(cacheKey)
	if (cachedData) {
		return c.text(cachedData, 200, {
			'Cache-Control': `public, max-age=${CACHE_TTL}`,
		})
	}

	// 從原始 API 獲取資料
	let apiResponse: string
	try {
		const originalApiUrl = `${c.env.API_HOST}/market/momentum/range/${range}`
		const headers = new Headers()
		const authHeader = c.req.header('Authorization')
		if (authHeader) {
			headers.append('Authorization', authHeader)
		}

		const response = await fetch(originalApiUrl, { headers })

		if (!response.ok) {
			throw new Error('從原始 API 獲取資料失敗')
		}
		apiResponse = await response.text()
	} catch (error: any) {
		return c.text(`獲取資料時發生錯誤: ${error.message}`, 500)
	}

	// 將資料存入 KV 並返回
	await kv.put(cacheKey, apiResponse, { expirationTtl: CACHE_TTL * 1.3 })
	return c.text(apiResponse, 200, {
		'Cache-Control': `public, max-age=${CACHE_TTL}`,
	})
}
