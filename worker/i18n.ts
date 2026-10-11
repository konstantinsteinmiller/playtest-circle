import en from '../src/i18n/en.json'

type Dict = { [k: string]: string | Dict }

/** Server-side lookup into the same message files the SPA uses (emails, Discord posts). */
export function tr(key: string, params: Record<string, string | number> = {}): string {
  let node: string | Dict | undefined = en as Dict
  for (const part of key.split('.')) node = typeof node === 'object' ? node[part] : undefined
  if (typeof node !== 'string') return key
  return node.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`))
}
