import {
  STORAGE_CHAT_STATE,
  STORAGE_DEVICE_TOKEN,
  STORAGE_GATEWAY_TOKEN,
  STORAGE_SESSION_KEY,
  STORAGE_SETUP,
  STORAGE_URL
} from "./storage-keys"

const AUTH_KEYS = [
  STORAGE_URL,
  STORAGE_SETUP,
  STORAGE_GATEWAY_TOKEN,
  STORAGE_DEVICE_TOKEN,
  STORAGE_SESSION_KEY,
  STORAGE_CHAT_STATE
] as const

export type StoredAuth = Partial<Record<(typeof AUTH_KEYS)[number], unknown>>

export async function readStoredAuth(): Promise<StoredAuth> {
  const [syncData, localData] = await Promise.all([
    chrome.storage.sync.get(AUTH_KEYS),
    chrome.storage.local.get(AUTH_KEYS)
  ])

  const result: StoredAuth = {}
  for (const key of AUTH_KEYS) {
    if (localData[key] !== undefined) {
      result[key] = localData[key]
      continue
    }
    if (syncData[key] !== undefined) {
      result[key] = syncData[key]
    }
  }
  return result
}

export async function writeStoredAuth(values: StoredAuth): Promise<void> {
  await chrome.storage.local.set(values)
  try {
    await chrome.storage.sync.set(values)
  } catch {}
}
