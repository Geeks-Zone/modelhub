import type { ProviderModel } from './provider-core'

type CacheEntry = {
  models: ProviderModel[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

/** Default TTL: 1 hour */
const DEFAULT_TTL_MS = 60 * 60 * 1000

/**
 * Get cached models for a provider, or fetch them dynamically.
 * Falls back to `fallbackModels` if the upstream fetch fails.
 */
export async function getCachedModels(
  providerId: string,
  fetchFn: () => Promise<ProviderModel[]>,
  fallbackModels: readonly ProviderModel[],
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<ProviderModel[]> {
  const entry = cache.get(providerId)
  const now = Date.now()

  // Return cached if still valid
  if (entry && now - entry.fetchedAt < ttlMs) {
    return entry.models
  }

  // Fetch in background if cache is stale but exists (serve stale while refreshing)
  if (entry) {
    refreshInBackground(providerId, fetchFn)
    return entry.models
  }

  // No cache at all — fetch synchronously
  try {
    const models = await fetchFn()
    if (models.length > 0) {
      cache.set(providerId, { models, fetchedAt: now })
      return models
    }
  } catch (error) {
    console.warn(`[ModelCache] Failed to fetch models for ${providerId}:`, error instanceof Error ? error.message : error)
  }

  // Return fallback
  return [...fallbackModels]
}

function refreshInBackground(
  providerId: string,
  fetchFn: () => Promise<ProviderModel[]>,
) {
  fetchFn()
    .then((models) => {
      if (models.length > 0) {
        cache.set(providerId, { models, fetchedAt: Date.now() })
        console.log(`[ModelCache] Refreshed ${providerId}: ${models.length} models`)
      }
    })
    .catch((error) => {
      console.warn(`[ModelCache] Background refresh failed for ${providerId}:`, error instanceof Error ? error.message : error)
    })
}
