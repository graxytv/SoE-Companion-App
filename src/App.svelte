<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import {
    MainWindow,
    MulingBannerWindow,
    OverlayWindow,
    TrackerOverlayCardWindow,
  } from './views';
  import { settingsStore } from './stores';
  import { OVERLAY_LAYOUT_WINDOW_LABELS, isOverlayLayoutWindowLabel } from './lib/overlay-layout';

  // Determine which window we're in
  type WindowType =
    | 'main'
    | 'overlay'
    | 'tracker-overlay'
    | 'muling-banner'
    | 'tracker-card-overlay'
    | null;

  let windowType = $state<WindowType>(null);
  let isReady = $state(false);
  let startupStep = $state('Starting');
  let startupError = $state<string | null>(null);
  let showStartupFallback = $state(false);
  let overlayLayoutEditing = $state(false);
  let overlayEditorWindowsHidden = false;

  function isUtilityOverlayWindow(): boolean {
    return windowType === 'muling-banner' ||
      windowType === 'tracker-card-overlay';
  }

  function shouldShowStartupFallbackForWindow(type: WindowType): boolean {
    return type === 'main' || type === 'tracker-overlay';
  }

  function syncMulingBannerWindow(visible: boolean): void {
    if (!windowType || isUtilityOverlayWindow()) return;
    invoke('set_muling_banner_window_visible', { visible }).catch((err) => {
      console.error('[App] Failed to sync muling banner window:', err);
    });
  }


  function syncOverlayEditorWindows(): void {
    if (!windowType || isUtilityOverlayWindow()) return;
    if (overlayLayoutEditing) return;
    if (overlayEditorWindowsHidden) return;

    overlayEditorWindowsHidden = true;
    for (const label of OVERLAY_LAYOUT_WINDOW_LABELS) {
      invoke('set_overlay_editor_window_visible', {
        label,
        visible: false,
      }).catch((err) => {
        console.error(`[App] Failed to hide overlay editor window ${label}:`, err);
      });
    }
  }

  $effect(() => {
    if (!isReady || !settingsStore.isLoaded) return;
    syncMulingBannerWindow(
      settingsStore.settings.dropsTrackerMulingMode &&
      settingsStore.settings.mulingIndicatorOverlayEnabled,
    );
    syncOverlayEditorWindows();
    invoke('set_always_show_overlays', { enabled: settingsStore.settings.alwaysShowOverlays }).catch((err) => {
      console.error('[App] Failed to sync always-show overlays:', err);
    });
  });

  onMount(async () => {
    const current = getCurrentWebviewWindow();
    const resolvedWindowType = current.label === 'overlay'
      ? 'overlay'
      : current.label === 'tracker-overlay'
        ? 'tracker-overlay'
        : current.label === 'muling-banner'
          ? 'muling-banner'
          : isOverlayLayoutWindowLabel(current.label)
              ? 'tracker-card-overlay'
              : 'main';
    windowType = resolvedWindowType;
    if (shouldShowStartupFallbackForWindow(windowType)) {
      showStartupFallback = true;
    }
    const startupFallbackTimer = window.setTimeout(() => {
      showStartupFallback = shouldShowStartupFallbackForWindow(windowType);
    }, 1200);

    // Add class to html element for overlay styling
    if (windowType === 'overlay') {
      document.documentElement.classList.add('overlay-mode');
      document.body.style.background = 'transparent';
    } else if (windowType === 'tracker-overlay') {
      document.documentElement.classList.add('tracker-overlay-mode');
    } else if (windowType === 'muling-banner') {
      document.documentElement.classList.add('muling-banner-mode');
      document.body.style.background = 'transparent';
    } else if (windowType === 'tracker-card-overlay') {
      document.documentElement.classList.add('overlay-editor-window-mode');
      document.body.style.background = 'transparent';
    }

    // Desktop-feel: suppress the browser context menu except inside the
    // rules editor, inputs/textareas, and the DSL help content where users
    // legitimately need copy/paste.
    window.addEventListener('contextmenu', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest('.cm-editor') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('.syntax-help') ||
        target.closest('.help-content')
      ) {
        return;
      }
      e.preventDefault();
    });

    try {
      // Load settings from backend (applies theme automatically).
      startupStep = 'Loading settings';
      await settingsStore.load();
    } catch (err) {
      startupError = err instanceof Error ? err.message : String(err);
      console.error('[App] Failed during startup settings load:', err);
    } finally {
      isReady = true;
      startupStep = startupError ? 'Loaded with fallback settings' : 'Ready';
      window.clearTimeout(startupFallbackTimer);
    }

    // Cross-window sync: each webview has its own store instance, so without
    // this a change in one window would be clobbered by a stale save from the other.
    // Do not block window rendering on this listener; a failed listener should
    // never leave utility windows as a black native shell.
    settingsStore.initSync().catch((err) => {
      startupError = err instanceof Error ? err.message : String(err);
      console.error('[App] Failed to initialize settings sync:', err);
    });

    const unlistenEditMode = await listen<{ active: boolean }>('overlay-edit-mode', (event) => {
      overlayLayoutEditing = event.payload.active;
      if (event.payload.active) {
        overlayEditorWindowsHidden = false;
      }
    });

    window.setInterval(() => {
      syncMulingBannerWindow(
        settingsStore.settings.dropsTrackerMulingMode &&
        settingsStore.settings.mulingIndicatorOverlayEnabled,
      );
      syncOverlayEditorWindows();
    }, 5000);

    void unlistenEditMode;
  });
</script>

{#if isReady && windowType === 'overlay'}
  <OverlayWindow mode="game" />
{:else if isReady && windowType === 'tracker-overlay'}
  <OverlayWindow mode="tracker" />
{:else if isReady && windowType === 'muling-banner'}
  <MulingBannerWindow />
{:else if isReady && windowType === 'tracker-card-overlay'}
  <TrackerOverlayCardWindow />
{:else if isReady && windowType === 'main'}
  <MainWindow />
{:else if showStartupFallback}
  <div class="startup-fallback" class:utility={windowType !== 'main'}>
    <strong>SoE Companion</strong>
    <span>{windowType === 'tracker-overlay' ? 'Loading tracker overlay...' : 'Loading window...'}</span>
    <small>{startupError ?? startupStep}</small>
  </div>
{/if}

<style>
  .startup-fallback {
    min-height: 100vh;
    box-sizing: border-box;
    display: grid;
    place-content: center;
    gap: 8px;
    padding: 20px;
    background: var(--bg-primary, #080303);
    color: var(--text-primary, #f6e7c4);
    font-family: var(--font-body, system-ui, sans-serif);
    text-align: center;
  }

  .startup-fallback.utility {
    background: #050303;
  }

  .startup-fallback strong {
    color: var(--accent-gold, #ffb02e);
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .startup-fallback span {
    color: var(--text-primary, #f6e7c4);
    font-weight: 700;
  }

  .startup-fallback small {
    max-width: 320px;
    color: var(--text-muted, #b48b69);
    overflow-wrap: anywhere;
  }
</style>
