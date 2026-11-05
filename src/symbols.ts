import type { Bindings } from './types'
import { normalizeSymbol } from './util'

/**
 * 站上的公司清單（/stock/symbols），拿來當 /company-metrics 的白名單：
 * 不在清單裡的代號不讀 KV、不寫 KV、也不打上游。
 */

// /stock/symbols 由 createCachedHandler 寫進 KV 的 key（index.ts 的 createCachedHandler("/stock/symbols")，
// 沒有 query string 時就是這個）。改 index.ts 那邊的路徑或 key 格式時，這裡要一起改。
const SYMBOLS_CACHE_KEY = 'data:cache:/stock/symbols'

// 與 index.ts 裡 /stock/symbols 的 expiration: 720（小時）一致
const SYMBOLS_TTL_SECONDS = 720 * 3600

// isolate 內的記憶體快取：同一個 isolate 的連續請求不用每次都讀 KV
const MEMORY_TTL_MS = 10 * 60 * 1000

let memory: { symbols: Set<string>; expiresAt: number } | null = null

// 回應格式：{ data: [{ symbol: 'AAPL', name: '...' }, ...] }；清單是空的或格式不對一律當作讀不到
const parseSymbols = (text: string): Set<string> | null => {
	try {
		const list = JSON.parse(text)?.data
		if (!Array.isArray(list)) return null
		const symbols = new Set<string>()
		for (const item of list) {
			if (typeof item?.symbol === 'string') symbols.add(normalizeSymbol(item.symbol))
		}
		return symbols.size > 0 ? symbols : null
	} catch {
		return null
	}
}

/**
 * 取得公司代號清單，順序：isolate 記憶體 → KV → 上游。
 * 讀不到（KV 沒有、上游也失敗）回 null，由呼叫端決定怎麼處理。
 */
export const getKnownSymbols = async (env: Bindings, ctx: ExecutionContext): Promise<Set<string> | null> => {
	if (memory && memory.expiresAt > Date.now()) return memory.symbols

	// 1. KV：平常 /stock/symbols 的快取就在這裡，不用多打一次上游
	let symbols: Set<string> | null = null
	const cached = await env.URTRADE_KV.get(SYMBOLS_CACHE_KEY)
	if (cached !== null) symbols = parseSymbols(cached)

	// 2. KV 沒有（過期或還沒被請求過）：向上游要一次，並用和 createCachedHandler 相同的 key／TTL 寫回去
	if (!symbols) {
		try {
			const response = await fetch(`${env.API_HOST}/stock/symbols`)
			if (response.ok) {
				const text = await response.text()
				symbols = parseSymbols(text)
				if (symbols) {
					ctx.waitUntil(env.URTRADE_KV.put(SYMBOLS_CACHE_KEY, text, { expirationTtl: SYMBOLS_TTL_SECONDS }))
				}
			}
		} catch {
			// 上游失敗：下面回 null
		}
	}

	if (symbols) memory = { symbols, expiresAt: Date.now() + MEMORY_TTL_MS }
	return symbols
}
