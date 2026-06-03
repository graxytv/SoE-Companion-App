import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

interface UpdateCheckResult {
  status: 'up_to_date' | 'available';
  latest_version: string | null;
  current_version: string;
  asset_url: string | null;
}

interface ProgressPayload {
  downloaded: number;
}

export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up_to_date'; currentVersion: string }
  | { kind: 'available'; currentVersion: string; latestVersion: string; assetUrl: string }
  | { kind: 'downloading'; currentVersion: string; latestVersion: string; assetUrl: string; downloaded: number }
  | { kind: 'ready'; latestVersion: string }
  | { kind: 'error'; message: string };

class UpdaterStore {
  private _state = $state<UpdaterState>({ kind: 'idle' });
  private unlisteners: UnlistenFn[] = [];
  private listenersReady = false;

  get state(): UpdaterState {
    return this._state;
  }

  async initListeners(): Promise<void> {
    if (this.listenersReady) return;
    this.listenersReady = true;

    this.unlisteners.push(
      await listen<ProgressPayload>('updater-progress', (event) => {
        if (this._state.kind !== 'downloading') return;
        this._state = {
          ...this._state,
          downloaded: Number(event.payload.downloaded) || 0,
        };
      }),
    );

    this.unlisteners.push(
      await listen('updater-ready', () => {
        const latestVersion =
          this._state.kind === 'downloading' || this._state.kind === 'available'
            ? this._state.latestVersion
            : 'latest';
        this._state = { kind: 'ready', latestVersion };
      }),
    );

    this.unlisteners.push(
      await listen<string>('updater-error', (event) => {
        this._state = { kind: 'error', message: event.payload || 'Update failed.' };
      }),
    );
  }

  destroyListeners(): void {
    for (const unlisten of this.unlisteners.splice(0)) unlisten();
    this.listenersReady = false;
  }

  async check(manual = false): Promise<void> {
    await this.initListeners();
    this._state = { kind: 'checking' };

    try {
      const result = await invoke<UpdateCheckResult>('check_for_updates', { manual });
      if (result.status === 'available' && result.latest_version && result.asset_url) {
        this._state = {
          kind: 'available',
          currentVersion: result.current_version,
          latestVersion: result.latest_version,
          assetUrl: result.asset_url,
        };
        return;
      }

      this._state = { kind: 'up_to_date', currentVersion: result.current_version };
    } catch (error) {
      const message = String(error);
      this._state = message === 'silent' ? { kind: 'idle' } : { kind: 'error', message };
    }
  }

  async install(): Promise<void> {
    if (this._state.kind !== 'available') return;
    await this.initListeners();

    const { currentVersion, latestVersion, assetUrl } = this._state;
    this._state = { kind: 'downloading', currentVersion, latestVersion, assetUrl, downloaded: 0 };

    try {
      await invoke('start_update', { assetUrl });
    } catch (error) {
      this._state = { kind: 'error', message: String(error) };
    }
  }

  async restart(): Promise<void> {
    await invoke('restart_app');
  }
}

export const updaterStore = new UpdaterStore();
