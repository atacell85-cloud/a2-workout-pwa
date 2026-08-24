export function createSyncService(repository, onStatus = () => {}) {
  let user = null; let timer = null; let pushing = false; let syncVersion = 0;
  const setStatus = status => onStatus(status);
  async function request(path, options = {}) {
    const response = await fetch(`/api/sync${path}`, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.code || 'SYNC_FAILED'), { code: body.code || 'SYNC_FAILED' });
    return body;
  }
  return {
    async start(account) {
      user = account;
      repository.setSyncHandler(data => this.schedule(data));
      if (!navigator.onLine) return setStatus('offline');
      const remote = await request('/pull');
      const localMeta = await repository.getSyncMetadata();
      const localData = await repository.getData();
      const localIsEmpty = !localData.programs.length
        && !localData.sessions.length
        && !localData.draft
        && !localData.programBuilderDraft
        && !Object.keys(localData.importPreviews || {}).length;
      if (remote.data && (!localMeta.dirty || localIsEmpty)) await repository.replaceData(remote.data);
      syncVersion = remote.syncVersion || 0;
      setStatus('saved');
    },
    stop() { user = null; syncVersion = 0; clearTimeout(timer); repository.setSyncHandler(null); },
    async schedule(data) {
      if (!user) return;
      clearTimeout(timer);
      timer = setTimeout(() => this.push(data), 400);
    },
    async push(data) {
      if (!user || pushing) return;
      if (!navigator.onLine) return setStatus('offline');
      pushing = true; setStatus('syncing');
      try { const result = await request('/push', { method: 'POST', body: JSON.stringify({ data, syncVersion }) }); syncVersion = result.syncVersion; await repository.markSyncSucceeded(); setStatus('saved'); }
      catch (error) { await repository.markSyncFailed(error); setStatus(navigator.onLine ? 'pending' : 'offline'); if (error.code === 'SYNC_CONFLICT') console.warn('Sync conflict retained locally.'); }
      finally { pushing = false; }
    },
    async migrateLegacy() { const data = await repository.importLegacyDeviceData(); await this.push(data); return data; }
  };
}
