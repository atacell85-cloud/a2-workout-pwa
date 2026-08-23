const TTL_MS = 168 * 60 * 60 * 1000;

export function createYouTubeSearchService(repository, { apiKey = globalThis.A2_YOUTUBE_API_KEY || '' } = {}) {
  return {
    async search(exercise) {
      if (!exercise?.id || !exercise?.nameEn) return { status: 'unavailable', message: 'Bu hareket için video aranamaz.' };
      const query = `${exercise.nameEn} proper form`;
      const cached = await repository.getYoutubeCache(exercise.id, query);
      if (cached && new Date(cached.expiresAt) > new Date()) return { status: 'ok', cached: true, ...cached };
      if (!navigator.onLine) return cached ? { status: 'ok', cached: true, stale: true, ...cached } : { status: 'offline', message: 'İnternet yok; önbellekte video sonucu bulunamadı.' };
      if (!apiKey) return cached ? { status: 'ok', cached: true, stale: true, ...cached } : { status: 'search', query, url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}` };
      try {
        const url = new URL('https://www.googleapis.com/youtube/v3/search');
        Object.entries({ key: apiKey, q: query, part: 'snippet', type: 'video', videoEmbeddable: 'true', safeSearch: 'strict', maxResults: '5', relevanceLanguage: 'en' }).forEach(([key, value]) => url.searchParams.set(key, value));
        const response = await fetch(url);
        if (!response.ok) throw new Error(`YOUTUBE_${response.status}`);
        const payload = await response.json();
        const entry = { exerciseId: exercise.id, query, fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TTL_MS).toISOString(), videos: (payload.items || []).slice(0, 5).map(item => ({ videoId: item.id.videoId, title: item.snippet.title, channelTitle: item.snippet.channelTitle, thumbnailUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url })).filter(item => item.videoId && item.thumbnailUrl) };
        await repository.saveYoutubeCache(entry);
        return entry.videos.length ? { status: 'ok', ...entry } : { status: 'empty', message: 'Bu hareket için uygun video sonucu bulunamadı.' };
      } catch {
        return cached ? { status: 'ok', cached: true, stale: true, ...cached } : { status: 'unavailable', message: 'Form Videosu geçici olarak kullanılamıyor.' };
      }
    }
  };
}
