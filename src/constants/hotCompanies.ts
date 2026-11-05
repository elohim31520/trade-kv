/**
 * 免登入可看 /company-metrics 的熱門公司（大寫代號）。
 * 不在名單內的公司，worker 會要求 Authorization（見 middleware/metricsAccess.ts）。
 *
 * ⚠️ 要和前端 u-nuxt-trade 的 app/constants/hotCompanies.ts（探索熱門公司）保持同步，
 *    兩邊的名單不一致會讓熱門公司被擋，或讓非熱門公司沒擋到。
 */
export const HOT_COMPANIES: ReadonlySet<string> = new Set([
	'SPCX', 'SNDK', 'MU', 'COHR', 'LITE', 'TSM', 'AMD', 'MSTR', 'HOOD', 'VST',
	'APP', 'SOFI', 'AVGO', 'CRWV', 'OKLO', 'TSLA', 'NVDA', 'PLTR', 'AMZN', 'GOOG',
	'META', 'MSFT', 'AAPL',
])

export const isHotCompany = (symbol: string | undefined): boolean =>
	!!symbol && HOT_COMPANIES.has(symbol.trim().toUpperCase())
