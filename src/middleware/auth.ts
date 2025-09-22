import { type Context, type Next } from 'hono'
import type { Bindings } from '../types'

// Hono context with bindings
type AppContext = Context<{ Bindings: Bindings }>

// 身份驗證中介軟體
export const auth = async (c: AppContext, next: Next) => {
	const authHeader = c.req.header('Authorization')
	if (!authHeader) {
		return c.json({ error: '未授權', message: '缺少 Authorization 標頭' }, 401)
	}

	// 您的使用者登入狀態驗證 API
	const authApiUrl = `${c.env.API_HOST}/users/is-login`

	try {
		const authResponse = await fetch(authApiUrl, {
			method: 'GET',
			headers: {
				Authorization: authHeader,
			},
		})

		if (!authResponse.ok) {
			// 如果 HTTP 狀態不是 2xx，直接視為失敗
			return c.json(
				{ error: '未授權', message: '驗證服務回應錯誤' },
				authResponse.status as any
			)
		}

		// 解析 JSON 回應
		const result: { success: boolean; data: any } = await authResponse.json()

		// 檢查 data 欄位是否為 true
		if (result.data !== true) {
			return c.json({ error: '未授權', message: '無效的 token 或驗證失敗' }, 401)
		}

		// 驗證成功，繼續處理請求
		await next()
	} catch (error) {
		console.error(`身份驗證 API 請求失敗: ${error}`)
		return c.json({ error: '內部伺服器錯誤', message: '無法連接驗證服務' }, 500)
	}
}
