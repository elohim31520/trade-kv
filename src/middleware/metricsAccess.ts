import { type Context, type Next } from 'hono'
import type { Bindings } from '../types'
import { auth } from './auth'
import { isHotCompany } from '../constants/hotCompanies'
import { normalizeSymbol, SYMBOL_PATTERN } from '../util'

type AppContext = Context<{ Bindings: Bindings }>

/**
 * /company-metrics/:symbol 的存取控制：
 *  - 代號格式不對：直接 400，不驗證、不讀 KV、不打上游
 *  - 熱門公司：公開，直接放行
 *  - 其他公司：必須登入（沿用 auth 中介軟體，向後端 /user/is-login 驗證 Authorization）
 *
 * 一定要掛在讀 KV 快取之前，否則已快取的資料會繞過驗證直接回傳。
 */
export const metricsAccess = async (c: AppContext, next: Next) => {
	const symbol = normalizeSymbol(c.req.param('symbol'))

	if (!SYMBOL_PATTERN.test(symbol)) {
		return c.json(
			{
				success: false,
				error: '代號格式不正確',
				message: '公司代號只能是英數、點、減號，最長 10 碼',
			},
			400
		)
	}

	if (isHotCompany(symbol)) return next()
	return auth(c, next)
}
