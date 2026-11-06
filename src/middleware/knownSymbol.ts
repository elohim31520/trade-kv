import { type Context, type Next } from 'hono'
import type { Bindings } from '../types'
import { isHotCompany } from '../constants/hotCompanies'
import { getKnownSymbols } from '../symbols'
import { normalizeSymbol } from '../util'

type AppContext = Context<{ Bindings: Bindings }>

/**
 * /company-metrics/:symbol 的白名單：代號不在站上公司清單（/stock/symbols）裡就直接 404，
 * 不讀 KV、不寫 KV、不打上游，亂打的代號不會在 KV 留下任何東西。
 *
 *  - 熱門公司：直接放行（熱門公司不一定在清單裡，不能被擋）
 *  - 清單暫時讀不到（KV 沒有、上游也失敗）：回 503，寧可暫時不能看，也不要放行亂碼去寫 KV
 *
 * 要排在 metricsAccess 之後：沒登入的人在上一關就被擋下，不會觸發這裡的清單讀取。
 */
export const knownSymbol = async (c: AppContext, next: Next) => {
	const symbol = normalizeSymbol(c.req.param('symbol'))
	if (isHotCompany(symbol)) return next()

	const symbols = await getKnownSymbols(c.env, c.executionCtx)
	if (!symbols) {
		return c.json({ success: false, error: '服務暫時無法使用', message: '公司清單暫時讀不到，請稍後再試' }, 503)
	}

	if (!symbols.has(symbol)) {
		return c.json({ success: false, error: '找不到公司', message: '找不到這個公司代號' }, 404)
	}

	return next()
}
