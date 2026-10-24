export const AUDIO_CACHE = 'portuguese-cards-audio-v1'

export async function cachedAudioCount(urls) {
  const cache = await caches.open(AUDIO_CACHE)
  const keys = new Set((await cache.keys()).map(request => request.url))
  return urls.filter(url => keys.has(url)).length
}

export async function downloadAudio(urls, { signal, onProgress }) {
  const cache = await caches.open(AUDIO_CACHE)
  const existing = new Set((await cache.keys()).map(request => request.url))
  let completed = urls.filter(url => existing.has(url)).length
  let failed = 0
  let index = 0
  const remaining = urls.filter(url => !existing.has(url))
  onProgress({ completed, failed })
  async function worker() {
    while (index < remaining.length && !signal.aborted) {
      const url = remaining[index++]
      try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit', signal })
        if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('Invalid audio')
        const blob = await response.blob()
        if (!blob.size) throw new Error('Empty audio')
        if (signal.aborted) return
        await cache.put(url, new Response(blob, { headers: { 'Content-Type': blob.type } }))
        completed++
      } catch (error) {
        if (error.name === 'AbortError' || signal.aborted) return
        failed++
      }
      onProgress({ completed, failed })
    }
  }
  await Promise.all(Array.from({ length: 3 }, worker))
  return { completed, failed, cancelled: signal.aborted }
}
