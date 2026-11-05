import { type Context, type Next } from 'hono'
import type { Bindings } from '../types'
import { auth } from './auth'
import { isHotCompany } from '../constants/hotCompanies'

type AppContext = Context<{ Bindings: Bindings }>

/**
 * /company-metrics/:symbol 的存取控制：
 *  - 熱門公司：公開，直接放行
 *  - 其他公司：必須登入（沿用 auth 中介軟體，向後端 /user/is-login 驗證 Authorization）
 *
 * 一定要掛在讀 KV 快取之前，否則已快取的資料會繞過驗證直接回傳。
 */
export const metricsAccess = async (c: AppContext, next: Next) => {
	if (isHotCompany(c.req.param('symbol'))) return next()
	return auth(c, next)
}
