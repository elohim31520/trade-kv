import type { KVNamespace } from '@cloudflare/workers-types'

// 定義環境變數的介面 (Bindings)
// 這樣 TypeScript 才能知道 c.env 裡有哪些屬性
export interface Bindings {
	URTRADE_KV: KVNamespace
	API_HOST: string
	ALLOWED_ORIGINS: string
}
