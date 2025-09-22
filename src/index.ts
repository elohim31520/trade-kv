import { Hono } from 'hono'
import { cors } from 'hono/cors' // 導入 cors
import type { Bindings } from './types'
import { auth } from './middleware/auth'
import { getMomentumRangeData } from './handlers/momentum'

// 將 Bindings 介面作為 Hono 應用程式的泛型參數
const app = new Hono<{ Bindings: Bindings }>()

// 啟用 CORS 中介軟體
app.use(
	cors({
		origin: (origin, c) => {
			const allowedOrigins = c.env.ALLOWED_ORIGINS.split(',')
			if (allowedOrigins.includes(origin)) {
				return origin
			}
			return undefined // or a default origin
		},
		allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
	})
)

// 定義一個快取過期時間（單位：秒）
const CACHE_TTL = 3600 * 3 // 3 小時

app.get('/market/momentum/range/1', async (c) => {
	const cacheKey = 'momentum_range_1_data'
	const kv = c.env.URTRADE_KV

	let apiResponse: string | null

	const cachedData = await kv.get(cacheKey)

	if (cachedData !== null) {
		// 找到了 KV 快取，回傳並設定 Edge Cache
		return c.text(cachedData, 200, {
			'Cache-Control': `public, max-age=${CACHE_TTL}`,
		})
	}

	// 2. 如果 KV 沒有快取，向原始 API 請求資料
	try {
		const originalApiUrl = `${c.env.API_HOST}/market/momentum/range/1`
		const response = await fetch(originalApiUrl)

		if (!response.ok) {
			throw new Error('Failed to fetch from original API.')
		}

		apiResponse = await response.text()
	} catch (error: any) {
		// 處理請求失敗
		return c.text(`Error fetching data: ${error.message}`, 500)
	}

	// 3. 取得資料後，同時寫入 KV 和 Edge Cache
	// 將資料寫入 KV，並設定過期時間
	await kv.put(cacheKey, apiResponse, { expirationTtl: CACHE_TTL * 2 })

	// 回傳資料並設定 Edge Cache 標頭
	return c.text(apiResponse, 200, {
		'Cache-Control': `public, max-age=${CACHE_TTL}`,
	})
})

// 新增需要身份驗證的 API 端點
app.get('/market/momentum/range/3', auth, (c) => getMomentumRangeData(c, 3))
app.get('/market/momentum/range/7', auth, (c) => getMomentumRangeData(c, 7))
app.get('/market/momentum/range/30', auth, (c) => getMomentumRangeData(c, 30))

export default app
