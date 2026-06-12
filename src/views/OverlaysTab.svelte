<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emit, listen } from '@tauri-apps/api/event';
  import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { onMount } from 'svelte';
  import { Button, HotkeyInput, SubTabs, Toggle } from '../components';
  import { lootHistoryStore, settingsStore, type HotkeyConfig, type OverlayPosition } from '../stores';
  import {
    DROP_TRACKER_CATEGORIES,
    RUNE_NAMES,
    categoryLabel,
    countTotal,
    type DropTrackerCategoryKey,
    type RuneName,
  } from '../lib/drop-tracker-categories';
  import {
    HOLY_GRAIL_CATEGORIES,
    holyGrailCategoryLabel,
    type HolyGrailCategoryKey,
  } from '../lib/holy-grail';
  import { MATERIAL_TRACKER_NAMES, type MaterialTrackerName } from '../lib/material-tracker';
  import {
    SOE_13_FATE_CARD_INFO,
    SOE_13_FATE_CARD_TIERS,
    fateCardTierKey,
    fateCardTierLabel,
  } from '../lib/soe-13-items';
  import { OVERLAY_LAYOUT_WINDOWS, type OverlayLayoutKind } from '../lib/overlay-layout';

  type OverlayTab =
    | 'global'
    | 'diagnostics'
    | 'notifications'
    | 'drops'
    | 'total'
    | 'grail'
    | 'fate-cards'
    | 'materials'
    | 'runes'
    | 'achievements'
    | 'achievement-popup'
    | 'kills'
    | 'muling';

  const overlayTabs: Array<{ id: OverlayTab; label: string }> = [
    { id: 'global', label: 'Global' },
    { id: 'diagnostics', label: 'Diagnostics' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'drops', label: 'Drops Tracker' },
    { id: 'total', label: 'Total Drops' },
    { id: 'grail', label: 'Grail Progress' },
    { id: 'fate-cards', label: 'Fate Cards' },
    { id: 'materials', label: 'Mats Tracker' },
    { id: 'runes', label: 'Rune Tracker' },
    { id: 'achievements', label: 'Achievement Progress' },
    { id: 'achievement-popup', label: 'Achievement Popup' },
    { id: 'kills', label: 'Monster Kills' },
    { id: 'muling', label: 'Muling Indicator' },
  ];

  interface GameWindowRect {
    left: number;
    top: number;
    width: number;
    height: number;
  }

  interface OverlayWindowDiagnostic {
    label: string;
    exists: boolean;
    visible: boolean;
    topmost: boolean;
    click_through: boolean;
    no_activate: boolean;
    tool_window: boolean;
    layered: boolean;
    rect: GameWindowRect | null;
    error: string | null;
  }

  interface OverlayDiagnostics {
    game_found: boolean;
    game_alive: boolean;
    game_foreground: boolean;
    game_rect: GameWindowRect | null;
    monitor_rect: GameWindowRect | null;
    game_matches_monitor: boolean;
    always_show_overlays: boolean;
    overlay_click_through: boolean;
    overlay_was_visible: boolean;
    overlay_styles_applied: boolean;
    main_overlay: OverlayWindowDiagnostic;
    editor_windows: OverlayWindowDiagnostic[];
    warnings: string[];
    error: string | null;
  }

  const UNBOUND: HotkeyConfig = { keyCode: 0, modifiers: 0, display: 'None' };

  let activeOverlayTab = $state<OverlayTab>('global');
  let overlayLayoutEditing = $state(false);
  let overlayLayoutMessage = $state('');
  let diagnostics = $state<OverlayDiagnostics | null>(null);
  let diagnosticsBusy = $state(false);
  let diagnosticsMessage = $state('');
  let materialSearch = $state('');
  let fateCardSearch = $state('');

  let achievementSettings = $derived(settingsStore.settings.achievementSettings);
  let dropsTrackerCounts = $derived(settingsStore.settings.dropsTrackerCounts);
  let totalDropsTrackerCounts = $derived(settingsStore.settings.totalDropsTrackerCounts);
  let dropsTrackerRunCount = $derived(settingsStore.settings.dropsTrackerRunCount);
  let dropsTrackerRunElapsedMs = $derived(settingsStore.settings.dropsTrackerRunElapsedMs);
  let dropsTrackerSessionElapsedMs = $derived(settingsStore.settings.dropsTrackerSessionElapsedMs);
  let dropsTrackerCategories = $derived(settingsStore.settings.dropsTrackerCategories);
  let totalDropsTrackerCategories = $derived(settingsStore.settings.totalDropsTrackerCategories);
  let holyGrailOverlayCategories = $derived(settingsStore.settings.holyGrailOverlayCategories);
  let materialTrackerOverlayMaterials = $derived(settingsStore.settings.materialTrackerOverlayMaterials);
  let materialTrackerCounts = $derived(settingsStore.settings.materialTrackerCounts);
  let runeTrackerOverlayRunes = $derived(settingsStore.settings.runeTrackerOverlayRunes);
  let runeTrackerCounts = $derived(settingsStore.settings.runeTrackerCounts);
  let fateCardTrackerOverlayCards = $derived(settingsStore.settings.fateCardTrackerOverlayCards);
  let fateCardTrackerOverlayTiers = $derived(settingsStore.settings.fateCardTrackerOverlayTiers);
  let fateCardTrackerCounts = $derived(settingsStore.settings.fateCardTrackerCounts);

  let visibleMaterials = $derived(
    MATERIAL_TRACKER_NAMES
      .filter((material) => matchesSearch(material, materialSearch))
      .toSorted((a, b) => a.localeCompare(b)),
  );
  let visibleFateCards = $derived(
    SOE_13_FATE_CARD_INFO
      .filter((card) =>
        matchesSearch(card.name, fateCardSearch) ||
        matchesSearch(card.reward, fateCardSearch) ||
        matchesSearch(fateCardTierLabel(card.tier), fateCardSearch),
      )
      .toSorted((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
  );

  function sameChord(a: HotkeyConfig, b: HotkeyConfig): boolean {
    return a.keyCode === b.keyCode && a.modifiers === b.modifiers;
  }

  function isBound(hotkey: HotkeyConfig): boolean {
    return hotkey.keyCode !== 0 || hotkey.modifiers !== 0;
  }

  function handleEditOverlayHotkeyChange(hotkey: HotkeyConfig): void {
    if (isBound(hotkey) && sameChord(settingsStore.settings.toggleWindowHotkey, hotkey)) {
      void settingsStore.setToggleWindowHotkey(UNBOUND);
    }
    void settingsStore.setEditOverlayHotkey(hotkey);
  }

  function matchesSearch(value: unknown, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return String(value ?? '').toLowerCase().includes(q);
  }

  function clampNumber(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }

  function safeScaleFactor(scaleFactor: number): number {
    return Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  }

  function logicalGameRect(gameRect: GameWindowRect, scaleFactor: number): GameWindowRect {
    const scale = safeScaleFactor(scaleFactor);
    return {
      ...gameRect,
      width: Math.max(1, Math.round(gameRect.width / scale)),
      height: Math.max(1, Math.round(gameRect.height / scale)),
    };
  }

  function overlayLayoutEnabled(kind: OverlayLayoutKind): boolean {
    if (kind === 'notifications') return settingsStore.settings.notificationOverlayEnabled;
    if (kind === 'drops') return settingsStore.settings.dropsTrackerEnabled;
    if (kind === 'total') return settingsStore.settings.totalDropsTrackerEnabled;
    if (kind === 'grail') return settingsStore.settings.holyGrailOverlayEnabled;
    if (kind === 'materials') return settingsStore.settings.materialTrackerOverlayEnabled;
    if (kind === 'runes') return settingsStore.settings.runeTrackerOverlayEnabled;
    if (kind === 'fate-cards') return settingsStore.settings.fateCardTrackerOverlayEnabled;
    if (kind === 'achievements') return settingsStore.settings.achievementProgressOverlayEnabled;
    if (kind === 'achievement-popup') return settingsStore.settings.achievementSettings.overlayEnabled;
    if (kind === 'kills') return settingsStore.settings.monsterKillsOverlayEnabled;
    return settingsStore.settings.mulingIndicatorOverlayEnabled;
  }

  function overlayLayoutPosition(kind: OverlayLayoutKind): OverlayPosition {
    if (kind === 'drops') return settingsStore.settings.dropsTrackerOverlayPosition;
    if (kind === 'total') return settingsStore.settings.totalDropsOverlayPosition;
    if (kind === 'grail') return settingsStore.settings.holyGrailOverlayPosition;
    if (kind === 'materials') return settingsStore.settings.materialTrackerOverlayPosition;
    if (kind === 'runes') return settingsStore.settings.runeTrackerOverlayPosition;
    if (kind === 'fate-cards') return settingsStore.settings.fateCardTrackerOverlayPosition;
    if (kind === 'achievements') return settingsStore.settings.achievementProgressOverlayPosition;
    if (kind === 'achievement-popup') return settingsStore.settings.achievementPopupOverlayPosition;
    if (kind === 'kills') return settingsStore.settings.monsterKillsOverlayPosition;
    if (kind === 'muling') return settingsStore.settings.mulingIndicatorOverlayPosition;
    return { x: settingsStore.settings.notificationX, y: settingsStore.settings.notificationY };
  }

  function overlayLayoutWidth(kind: OverlayLayoutKind): number {
    if (kind === 'notifications') return settingsStore.settings.notificationWidth;
    if (kind === 'drops') return settingsStore.settings.dropsTrackerOverlayWidth;
    if (kind === 'total') return settingsStore.settings.totalDropsOverlayWidth;
    if (kind === 'grail') return settingsStore.settings.holyGrailOverlayWidth;
    if (kind === 'materials') return settingsStore.settings.materialTrackerOverlayWidth;
    if (kind === 'runes') return settingsStore.settings.runeTrackerOverlayWidth;
    if (kind === 'fate-cards') return settingsStore.settings.fateCardTrackerOverlayWidth;
    if (kind === 'achievements') return settingsStore.settings.achievementProgressOverlayWidth;
    if (kind === 'achievement-popup') return settingsStore.settings.achievementPopupOverlayWidth;
    if (kind === 'kills') return settingsStore.settings.monsterKillsOverlayWidth;
    return settingsStore.settings.mulingIndicatorOverlayWidth;
  }

  function overlayLayoutHeight(kind: OverlayLayoutKind): number {
    if (kind === 'notifications') return settingsStore.settings.notificationHeight;
    if (kind === 'drops') return settingsStore.settings.dropsTrackerOverlayHeight;
    if (kind === 'total') return settingsStore.settings.totalDropsOverlayHeight;
    if (kind === 'grail') return settingsStore.settings.holyGrailOverlayHeight;
    if (kind === 'materials') return settingsStore.settings.materialTrackerOverlayHeight;
    if (kind === 'runes') return settingsStore.settings.runeTrackerOverlayHeight;
    if (kind === 'fate-cards') return settingsStore.settings.fateCardTrackerOverlayHeight;
    if (kind === 'achievements') return settingsStore.settings.achievementProgressOverlayHeight;
    if (kind === 'achievement-popup') return settingsStore.settings.achievementPopupOverlayHeight;
    if (kind === 'kills') return settingsStore.settings.monsterKillsOverlayHeight;
    return settingsStore.settings.mulingIndicatorOverlayHeight;
  }

  function fallbackOverlayLayoutPosition(kind: OverlayLayoutKind, gameRect: GameWindowRect, width: number, height: number): OverlayPosition {
    if (kind === 'total' || kind === 'runes') {
      return { x: Math.max(0, gameRect.width - width - 12), y: kind === 'total' ? Math.max(0, gameRect.height - height - 12) : 12 };
    }
    if (kind === 'drops') return { x: 12, y: Math.max(0, gameRect.height - height - 12) };
    if (kind === 'grail') return { x: 12, y: Math.max(0, gameRect.height - height - 220) };
    if (kind === 'achievement-popup') return { x: Math.max(0, Math.round((gameRect.width - width) / 2)), y: 18 };
    if (kind === 'muling') return { x: 12, y: Math.max(0, gameRect.height - height - 80) };
    return { x: 12, y: 12 };
  }

  function overlayLayoutEditorEntry(definition: typeof OVERLAY_LAYOUT_WINDOWS[number], gameRect: GameWindowRect) {
    const width = overlayLayoutWidth(definition.kind);
    const height = overlayLayoutHeight(definition.kind);
    if (definition.kind === 'notifications') {
      return {
        ...definition,
        enabled: overlayLayoutEnabled(definition.kind),
        x: Math.round((settingsStore.settings.notificationX / 100) * gameRect.width),
        y: Math.round((settingsStore.settings.notificationY / 100) * gameRect.height),
        width,
        height,
      };
    }
    const position = overlayLayoutPosition(definition.kind);
    const fallback = fallbackOverlayLayoutPosition(definition.kind, gameRect, width, height);
    return {
      ...definition,
      enabled: overlayLayoutEnabled(definition.kind),
      x: typeof position.x === 'number' ? position.x : fallback.x,
      y: typeof position.y === 'number' ? position.y : fallback.y,
      width,
      height,
    };
  }

  async function hideOverlayLayoutEditorWindowsFromMain(): Promise<void> {
    await Promise.all(
      OVERLAY_LAYOUT_WINDOWS.map((definition) =>
        invoke('set_overlay_editor_window_visible', {
          label: definition.windowLabel,
          visible: false,
        }).catch((error) => {
          console.error(`[OverlaysTab] Failed to hide ${definition.windowLabel}:`, error);
        }),
      ),
    );
  }

  async function setOverlayLayoutEditorWindowsVisibleFromMain(visible: boolean): Promise<boolean> {
    if (!visible) {
      await hideOverlayLayoutEditorWindowsFromMain();
      overlayLayoutMessage = '';
      return true;
    }

    try {
      const [physicalGameRect, scaleFactor] = await Promise.all([
        invoke<GameWindowRect>('get_game_window_rect'),
        getCurrentWebviewWindow().scaleFactor(),
      ]);
      const gameRect = logicalGameRect(physicalGameRect, scaleFactor);
      const entries = OVERLAY_LAYOUT_WINDOWS.map((definition) => overlayLayoutEditorEntry(definition, gameRect));
      for (const entry of entries) {
        await invoke('set_overlay_editor_window_visible', {
          label: entry.windowLabel,
          visible: true,
          x: entry.x,
          y: entry.y,
          width: entry.width,
          height: entry.height,
        });
      }
      overlayLayoutMessage = '';
      return true;
    } catch (error) {
      await hideOverlayLayoutEditorWindowsFromMain();
      overlayLayoutMessage = `Start Diablo II to edit overlay layout by dragging. ${error}`;
      return false;
    }
  }

  function setNotificationDuration(value: number): void {
    settingsStore.set('notificationDuration', Math.floor(clampNumber(value, 1000, 30000)));
  }

  function setNotificationFontSize(value: number): void {
    settingsStore.set('notificationFontSize', Math.floor(clampNumber(value, 10, 24)));
  }

  function setNotificationOpacity(value: number): void {
    settingsStore.set('notificationOpacity', clampNumber(value, 0, 1));
  }

  function setAchievementDuration(value: number): void {
    settingsStore.setAchievementSettings({ overlayDuration: Math.floor(clampNumber(value, 1500, 20000)) });
  }

  function setAchievementFontSize(value: number): void {
    settingsStore.setAchievementSettings({ overlayFontSize: Math.floor(clampNumber(value, 11, 28)) });
  }

  function setAchievementOpacity(value: number): void {
    settingsStore.setAchievementSettings({ overlayOpacity: clampNumber(value, 0.25, 1) });
  }

  async function toggleOverlayLayoutEditor(): Promise<void> {
    const active = !overlayLayoutEditing;
    const ok = await setOverlayLayoutEditorWindowsVisibleFromMain(active);
    if (!ok) {
      overlayLayoutEditing = false;
      await emit('overlay-edit-mode', { active: false });
      return;
    }
    overlayLayoutEditing = active;
    await emit('overlay-edit-mode', { active });
  }

  async function refreshTrackerOverlays(): Promise<void> {
    try {
      await emit('refresh-tracker-overlays');
      await invoke('sync_overlay_with_game').catch(() => {});
      await invoke('set_overlay_interactive', { active: false }).catch(() => {});
      window.setTimeout(() => {
        void emit('refresh-tracker-overlays');
        void invoke('sync_overlay_with_game').catch(() => {});
      }, 120);
      overlayLayoutMessage = 'Overlay windows refreshed.';
    } catch (error) {
      overlayLayoutMessage = `Could not refresh overlays: ${error}`;
    }
  }

  function resetOverlayLayout(): void {
    settingsStore.resetDropTrackerOverlayPositions();
    void refreshTrackerOverlays();
  }

  function enabledOverlayCount(): number {
    return [
      settingsStore.settings.notificationOverlayEnabled,
      settingsStore.settings.dropsTrackerEnabled,
      settingsStore.settings.totalDropsTrackerEnabled,
      settingsStore.settings.holyGrailOverlayEnabled,
      settingsStore.settings.fateCardTrackerOverlayEnabled,
      settingsStore.settings.materialTrackerOverlayEnabled,
      settingsStore.settings.runeTrackerOverlayEnabled,
      settingsStore.settings.achievementProgressOverlayEnabled,
      settingsStore.settings.achievementSettings.overlayEnabled,
      settingsStore.settings.monsterKillsOverlayEnabled,
      settingsStore.settings.mulingIndicatorOverlayEnabled,
    ].filter(Boolean).length;
  }

  function formatBool(value: boolean): string {
    return value ? 'Yes' : 'No';
  }

  function formatRect(rect: GameWindowRect | null | undefined): string {
    if (!rect) return '-';
    return `${rect.left}, ${rect.top} | ${rect.width} x ${rect.height}`;
  }

  function diagnosticStatusClass(value: boolean): string {
    return value ? 'ok' : 'warn';
  }

  function diagnosticWindowTitle(label: string): string {
    const names: Record<string, string> = {
      overlay: 'Main Transparent Overlay',
      'notification-card-overlay': 'Notifications',
      'drops-card-overlay': 'Drops Tracker',
      'total-card-overlay': 'Total Drops',
      'grail-card-overlay': 'Grail Progress',
      'runes-card-overlay': 'Rune Tracker',
      'mats-card-overlay': 'Mats Tracker',
      'fate-cards-card-overlay': 'Fate Cards',
      'achievement-card-overlay': 'Achievement Progress',
      'achievement-popup-overlay': 'Achievement Popup',
      'kills-card-overlay': 'Monster Kills',
      'muling-card-overlay': 'Muling Indicator',
    };
    return names[label] ?? label;
  }

  async function runOverlayDiagnostics(repairFirst = false): Promise<void> {
    if (diagnosticsBusy) return;
    diagnosticsBusy = true;
    diagnosticsMessage = '';
    try {
      if (repairFirst) {
        await refreshTrackerOverlays();
      }
      diagnostics = await invoke<OverlayDiagnostics>('get_overlay_diagnostics');
      diagnosticsMessage = `Diagnostics refreshed at ${new Date().toLocaleTimeString()}.`;
    } catch (error) {
      diagnosticsMessage = `Diagnostics failed: ${error}`;
    } finally {
      diagnosticsBusy = false;
    }
  }

  async function testOverlayPulse(): Promise<void> {
    diagnosticsMessage = '';
    try {
      await refreshTrackerOverlays();
      await emit('overlay-test-notification', {});
      diagnosticsMessage = settingsStore.settings.alwaysShowOverlays
        ? 'Test overlay pulse sent. If nothing appears, run diagnostics and ask the player to try windowed/borderless mode.'
        : 'Test overlay pulse sent. Always Show Overlays is off, so Diablo II may need to be foreground to see it.';
      void runOverlayDiagnostics(false);
    } catch (error) {
      diagnosticsMessage = `Could not send test overlay pulse: ${error}`;
    }
  }

  async function copyOverlayDiagnostics(): Promise<void> {
    if (!diagnostics) {
      await runOverlayDiagnostics(false);
    }
    if (!diagnostics) return;
    const payload = {
      capturedAt: new Date().toISOString(),
      enabledOverlayCount: enabledOverlayCount(),
      settings: {
        alwaysShowOverlays: settingsStore.settings.alwaysShowOverlays,
        trackerOverlaysSeparateWindow: settingsStore.settings.trackerOverlaysSeparateWindow,
        notifications: settingsStore.settings.notificationOverlayEnabled,
        dropsTracker: settingsStore.settings.dropsTrackerEnabled,
        totalDrops: settingsStore.settings.totalDropsTrackerEnabled,
        grailProgress: settingsStore.settings.holyGrailOverlayEnabled,
        fateCards: settingsStore.settings.fateCardTrackerOverlayEnabled,
        matsTracker: settingsStore.settings.materialTrackerOverlayEnabled,
        runeTracker: settingsStore.settings.runeTrackerOverlayEnabled,
        achievementProgress: settingsStore.settings.achievementProgressOverlayEnabled,
        achievementPopup: settingsStore.settings.achievementSettings.overlayEnabled,
        monsterKills: settingsStore.settings.monsterKillsOverlayEnabled,
        mulingIndicator: settingsStore.settings.mulingIndicatorOverlayEnabled,
      },
      diagnostics,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      diagnosticsMessage = 'Diagnostics copied to clipboard.';
    } catch (error) {
      diagnosticsMessage = `Could not copy diagnostics: ${error}`;
    }
  }

  function setAlwaysShowOverlays(enabled: boolean): void {
    settingsStore.set('alwaysShowOverlays', enabled);
  }

  function handleTrackerOverlayWindowChange(enabled: boolean): void {
    settingsStore.setTrackerOverlaysSeparateWindow(enabled);
    invoke('set_tracker_overlay_window_visible', { visible: enabled }).catch((error) => {
      console.error('[OverlaysTab] Failed to toggle tracker overlay window:', error);
    });
  }

  function setMulingIndicatorOverlayEnabled(enabled: boolean): void {
    settingsStore.setMulingIndicatorOverlayEnabled(enabled);
    invoke('set_muling_banner_window_visible', {
      visible: enabled && settingsStore.settings.dropsTrackerMulingMode,
    }).catch((error) => {
      console.error('[OverlaysTab] Failed to update muling indicator window:', error);
    });
  }

  function setAllDropsCategories(enabled: boolean): void {
    for (const category of DROP_TRACKER_CATEGORIES) {
      settingsStore.setDropsTrackerCategory(category.key, enabled);
    }
  }

  function setAllTotalCategories(enabled: boolean): void {
    for (const category of DROP_TRACKER_CATEGORIES) {
      settingsStore.setTotalDropsTrackerCategory(category.key, enabled);
    }
  }

  function setAllHolyGrailCategories(enabled: boolean): void {
    for (const category of HOLY_GRAIL_CATEGORIES) {
      settingsStore.setHolyGrailOverlayCategory(category.key, enabled);
    }
  }

  function materialCount(material: MaterialTrackerName): number {
    return materialTrackerCounts[material] ?? 0;
  }

  function runeCount(rune: RuneName): number {
    return runeTrackerCounts[rune] ?? 0;
  }

  function fateCardSessionCount(name: string): number {
    return fateCardTrackerCounts[name] ?? 0;
  }

  function materialTotal(): number {
    return MATERIAL_TRACKER_NAMES.reduce((sum, material) => sum + materialCount(material), 0);
  }

  function runeTotal(): number {
    return RUNE_NAMES.reduce((sum, rune) => sum + runeCount(rune), 0);
  }

  function fateCardSessionTotal(): number {
    return Object.values(fateCardTrackerCounts).reduce<number>((sum, count) => sum + Math.max(0, Math.floor(count ?? 0)), 0);
  }

  function formatRunTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  function formatSessionTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  async function resetDropsTrackerSessionCounts(): Promise<void> {
    settingsStore.resetDropsTrackerCounts();
    await lootHistoryStore.clear();
  }

  function resetDropsTrackerRunsAndTimers(): void {
    settingsStore.resetDropsTrackerRunCount();
    settingsStore.resetDropsTrackerTimers();
  }

  function resetTotalDropsTrackerSessionCounts(): void {
    settingsStore.resetTotalDropsTrackerCounts();
  }

  function resetMaterialTrackerSessionCounts(): void {
    settingsStore.resetMaterialTrackerCounts();
  }

  function resetRuneTrackerSessionCounts(): void {
    settingsStore.resetRuneTrackerCounts();
  }

  function resetFateCardTrackerSessionCounts(): void {
    settingsStore.resetFateCardTrackerCounts();
  }

  function formatPosition(position: OverlayPosition): string {
    const x = position.x == null ? 'default' : `${Math.round(position.x)}px`;
    const y = position.y == null ? 'default' : `${Math.round(position.y)}px`;
    return `${x}, ${y}`;
  }

  function layoutSummary(position: OverlayPosition, width: number, height: number): string {
    return `Position ${formatPosition(position)} | Size ${Math.round(width)} x ${Math.round(height)}px`;
  }

  onMount(() => {
    const unlisteners: Array<() => void> = [];
    listen<{ active: boolean }>('overlay-edit-mode', (event) => {
      overlayLayoutEditing = event.payload.active;
    }).then((unlisten) => unlisteners.push(unlisten));
    listen<{ message: string }>('overlay-layout-message', (event) => {
      overlayLayoutMessage = event.payload.message;
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  });
</script>

<section class="tab-content overlays-tab">
  <div class="overlay-hero">
    <div>
      <h2 class="section-title">Overlays</h2>
      <p class="section-description">Every movable overlay setting is grouped here by overlay.</p>
    </div>
    <div class="overlay-hero-actions">
      <Button variant={overlayLayoutEditing ? 'secondary' : 'primary'} size="sm" onclick={toggleOverlayLayoutEditor}>
        {overlayLayoutEditing ? 'Done Editing' : 'Edit Layout'}
      </Button>
      <Button variant="secondary" size="sm" onclick={refreshTrackerOverlays}>Refresh</Button>
    </div>
  </div>

  <SubTabs tabs={overlayTabs} bind:activeTab={activeOverlayTab} ariaLabel="Overlay sections" />

  {#if activeOverlayTab === 'global'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Global Overlay Controls</h2>
        <p class="section-description">Use these controls before tuning individual overlay cards.</p>
      </div>

      <div class="settings-grid">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Always Show Overlays</span>
            <span class="setting-hint">Keep notification and tracker overlays visible even when Diablo II is not in focus.</span>
          </div>
          <Toggle checked={settingsStore.settings.alwaysShowOverlays} onchange={setAlwaysShowOverlays} />
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Edit Overlay Layout</span>
            <span class="setting-hint">Drag and resize every movable overlay in native windows over the Diablo II window.</span>
          </div>
          <Button variant={overlayLayoutEditing ? 'secondary' : 'primary'} size="sm" onclick={toggleOverlayLayoutEditor}>
            {overlayLayoutEditing ? 'Done Editing' : 'Move / Resize'}
          </Button>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Edit Layout Hotkey</span>
            <span class="setting-hint">Opens the same draggable layout mode from in game.</span>
          </div>
          <HotkeyInput value={settingsStore.settings.editOverlayHotkey} onchange={handleEditOverlayHotkeyChange} />
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Tracker Overlay Window</span>
            <span class="setting-hint">Move tracker-style overlays into a separate scrollable overlay window.</span>
          </div>
          <Toggle checked={settingsStore.settings.trackerOverlaysSeparateWindow} onchange={handleTrackerOverlayWindowChange} />
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Reset Overlay Layout</span>
            <span class="setting-hint">Restores default position and size for every movable overlay.</span>
          </div>
          <Button variant="secondary" size="sm" onclick={resetOverlayLayout}>Reset Layout</Button>
        </div>
      </div>

      {#if overlayLayoutMessage}
        <p class="status-message">{overlayLayoutMessage}</p>
      {/if}
    </div>
  {:else if activeOverlayTab === 'diagnostics'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Overlay Diagnostics</h2>
        <p class="section-description">Use this when overlays are enabled but do not appear over Diablo II. The report is designed to be screenshotted or copied.</p>
      </div>

      <div class="diagnostics-actions">
        <Button variant="primary" size="sm" disabled={diagnosticsBusy} onclick={() => runOverlayDiagnostics(false)}>
          {diagnosticsBusy ? 'Checking...' : 'Run Diagnostics'}
        </Button>
        <Button variant="secondary" size="sm" disabled={diagnosticsBusy} onclick={() => runOverlayDiagnostics(true)}>Repair + Check</Button>
        <Button variant="secondary" size="sm" onclick={testOverlayPulse}>Test Overlay</Button>
        <Button variant="secondary" size="sm" onclick={resetOverlayLayout}>Reset Layout</Button>
        <Button variant="secondary" size="sm" disabled={!diagnostics} onclick={copyOverlayDiagnostics}>Copy Report</Button>
      </div>

      {#if diagnosticsMessage}
        <p class="status-message">{diagnosticsMessage}</p>
      {/if}

      <div class="diagnostics-note">
        <strong>Fullscreen note</strong>
        <span>True exclusive fullscreen can render Diablo II above transparent overlay windows even when Windows reports the overlay as visible and topmost. Windowed or borderless fullscreen is the safest test.</span>
      </div>

      <div class="diagnostic-grid">
        <div class="diagnostic-card">
          <h3>Configured Overlays</h3>
          <strong>{enabledOverlayCount()}/11</strong>
          <span>Enabled in settings</span>
        </div>
        <div class="diagnostic-card">
          <h3>Always Show</h3>
          <strong>{formatBool(settingsStore.settings.alwaysShowOverlays)}</strong>
          <span>Needed when testing while this app is focused</span>
        </div>
        <div class="diagnostic-card">
          <h3>Tracker Window</h3>
          <strong>{formatBool(settingsStore.settings.trackerOverlaysSeparateWindow)}</strong>
          <span>Separate scrollable tracker mode</span>
        </div>
      </div>

      {#if diagnostics}
        {#if diagnostics.warnings.length > 0}
          <div class="diagnostics-warning-list">
            {#each diagnostics.warnings as warning}
              <p>{warning}</p>
            {/each}
          </div>
        {/if}

        <div class="diagnostics-panel">
          <div class="diagnostics-panel-heading">
            <h3>Game Window</h3>
            <span class="diag-pill {diagnosticStatusClass(diagnostics.game_found && diagnostics.game_alive)}">{diagnostics.game_found && diagnostics.game_alive ? 'Detected' : 'Problem'}</span>
          </div>
          <div class="diagnostics-facts">
            <div><span>Found</span><strong>{formatBool(diagnostics.game_found)}</strong></div>
            <div><span>Alive</span><strong>{formatBool(diagnostics.game_alive)}</strong></div>
            <div><span>Foreground</span><strong>{formatBool(diagnostics.game_foreground)}</strong></div>
            <div><span>Matches Monitor</span><strong>{formatBool(diagnostics.game_matches_monitor)}</strong></div>
            <div><span>Game Rect</span><strong>{formatRect(diagnostics.game_rect)}</strong></div>
            <div><span>Monitor Rect</span><strong>{formatRect(diagnostics.monitor_rect)}</strong></div>
          </div>
        </div>

        <div class="diagnostics-panel">
          <div class="diagnostics-panel-heading">
            <h3>Main Overlay</h3>
            <span class="diag-pill {diagnosticStatusClass(diagnostics.main_overlay.exists && diagnostics.main_overlay.visible && diagnostics.main_overlay.topmost)}">
              {diagnostics.main_overlay.exists && diagnostics.main_overlay.visible && diagnostics.main_overlay.topmost ? 'Ready' : 'Check'}
            </span>
          </div>
          <div class="diagnostics-facts">
            <div><span>Exists</span><strong>{formatBool(diagnostics.main_overlay.exists)}</strong></div>
            <div><span>Visible</span><strong>{formatBool(diagnostics.main_overlay.visible)}</strong></div>
            <div><span>Topmost</span><strong>{formatBool(diagnostics.main_overlay.topmost)}</strong></div>
            <div><span>Click Through</span><strong>{formatBool(diagnostics.main_overlay.click_through)}</strong></div>
            <div><span>No Activate</span><strong>{formatBool(diagnostics.main_overlay.no_activate)}</strong></div>
            <div><span>Layered</span><strong>{formatBool(diagnostics.main_overlay.layered)}</strong></div>
            <div><span>Rect</span><strong>{formatRect(diagnostics.main_overlay.rect)}</strong></div>
            <div><span>Error</span><strong>{diagnostics.main_overlay.error ?? '-'}</strong></div>
          </div>
        </div>

        <div class="diagnostics-panel">
          <div class="diagnostics-panel-heading">
            <h3>Overlay Runtime</h3>
            <span class="diag-pill {diagnosticStatusClass(diagnostics.overlay_styles_applied)}">{diagnostics.overlay_styles_applied ? 'Styled' : 'Waiting'}</span>
          </div>
          <div class="diagnostics-facts">
            <div><span>Backend Always Show</span><strong>{formatBool(diagnostics.always_show_overlays)}</strong></div>
            <div><span>Backend Click Through</span><strong>{formatBool(diagnostics.overlay_click_through)}</strong></div>
            <div><span>Was Visible</span><strong>{formatBool(diagnostics.overlay_was_visible)}</strong></div>
            <div><span>Styles Applied</span><strong>{formatBool(diagnostics.overlay_styles_applied)}</strong></div>
          </div>
        </div>

        <div class="diagnostics-panel">
          <div class="diagnostics-panel-heading">
            <h3>Edit Windows</h3>
            <span class="diag-pill ok">{diagnostics.editor_windows.filter((entry) => entry.exists).length}/{diagnostics.editor_windows.length}</span>
          </div>
          <div class="diagnostic-window-list">
            {#each diagnostics.editor_windows as entry}
              <div class="diagnostic-window-row">
                <strong>{diagnosticWindowTitle(entry.label)}</strong>
                <span>{entry.visible ? 'Visible' : 'Hidden'}</span>
                <span>{entry.topmost ? 'Topmost' : 'Not topmost'}</span>
                <span>{formatRect(entry.rect)}</span>
                <em>{entry.error ?? ''}</em>
              </div>
            {/each}
          </div>
        </div>
      {:else}
        <div class="diagnostics-empty">
          <p>Run diagnostics with Diablo II open. If the player uses fullscreen, have them test once in windowed or borderless mode too.</p>
        </div>
      {/if}
    </div>
  {:else if activeOverlayTab === 'notifications'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Notifications Overlay</h2>
        <p class="section-description">{layoutSummary({ x: settingsStore.settings.notificationX, y: settingsStore.settings.notificationY }, settingsStore.settings.notificationWidth, settingsStore.settings.notificationHeight)}</p>
      </div>

      <div class="settings-grid">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Show Notifications Overlay</span>
            <span class="setting-hint">Visual item popups. Sounds, history, and trackers keep working while hidden.</span>
          </div>
          <Toggle checked={settingsStore.settings.notificationOverlayEnabled} onchange={(enabled) => settingsStore.setNotificationOverlayEnabled(enabled)} />
        </div>

        <label class="field-row">
          <span>Display Duration</span>
          <div class="range-control">
            <input type="range" min="1000" max="30000" step="500" value={settingsStore.settings.notificationDuration} oninput={(event) => setNotificationDuration(Number((event.currentTarget as HTMLInputElement).value))} />
            <strong>{(settingsStore.settings.notificationDuration / 1000).toFixed(1)}s</strong>
          </div>
        </label>

        <label class="field-row">
          <span>Size</span>
          <div class="range-control">
            <input type="range" min="10" max="24" step="1" value={settingsStore.settings.notificationFontSize} oninput={(event) => setNotificationFontSize(Number((event.currentTarget as HTMLInputElement).value))} />
            <strong>{settingsStore.settings.notificationFontSize}px</strong>
          </div>
        </label>

        <label class="field-row">
          <span>Background Opacity</span>
          <div class="range-control">
            <input type="range" min="0" max="1" step="0.05" value={settingsStore.settings.notificationOpacity} oninput={(event) => setNotificationOpacity(Number((event.currentTarget as HTMLInputElement).value))} />
            <strong>{Math.round(settingsStore.settings.notificationOpacity * 100)}%</strong>
          </div>
        </label>

        <label class="field-row">
          <span>Stack Direction</span>
          <select value={settingsStore.settings.notificationStackDirection} onchange={(event) => settingsStore.set('notificationStackDirection', (event.currentTarget as HTMLSelectElement).value)}>
            <option value="up">Up</option>
            <option value="down">Down</option>
          </select>
        </label>
      </div>
    </div>
  {:else if activeOverlayTab === 'drops'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Drops Tracker Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.dropsTrackerOverlayPosition, settingsStore.settings.dropsTrackerOverlayWidth, settingsStore.settings.dropsTrackerOverlayHeight)}</p>
      </div>

      <div class="settings-grid">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Show Drops Tracker Overlay</span>
            <span class="setting-hint">Current resettable drop counts. Tracking continues while hidden.</span>
          </div>
          <Toggle checked={settingsStore.settings.dropsTrackerEnabled} onchange={(enabled) => settingsStore.setDropsTrackerEnabled(enabled)} />
        </div>

        <div class="switch-grid">
          <label><span>Run Counter</span><Toggle checked={settingsStore.settings.dropsTrackerRunCounterEnabled} onchange={(enabled) => settingsStore.setDropsTrackerRunCounterEnabled(enabled)} /></label>
          <label><span>Run Timer</span><Toggle checked={settingsStore.settings.dropsTrackerRunTimerEnabled} onchange={(enabled) => settingsStore.setDropsTrackerRunTimerEnabled(enabled)} /></label>
          <label><span>Session Timer</span><Toggle checked={settingsStore.settings.dropsTrackerSessionTimerEnabled} onchange={(enabled) => settingsStore.setDropsTrackerSessionTimerEnabled(enabled)} /></label>
        </div>

        <div class="reset-panel">
          <div class="reset-panel-heading">
            <h3>Session Resets</h3>
            <span>Clear the current Drops Tracker session without changing Total Drops.</span>
          </div>
          <div class="metric-actions">
            <div>
              <strong>{countTotal(dropsTrackerCounts, dropsTrackerCategories)}</strong>
              <span>Tracked Drops</span>
              <Button variant="danger" size="sm" onclick={resetDropsTrackerSessionCounts}>Reset Drops</Button>
            </div>
            <div>
              <strong>{dropsTrackerRunCount}</strong>
              <span>Runs</span>
              <Button variant="danger" size="sm" onclick={() => settingsStore.resetDropsTrackerRunCount()}>Reset Runs</Button>
            </div>
            <div>
              <strong>{formatRunTime(dropsTrackerRunElapsedMs)}</strong>
              <span>Run Timer</span>
              <Button variant="danger" size="sm" onclick={() => settingsStore.resetDropsTrackerRunTimer()}>Reset Timer</Button>
            </div>
            <div>
              <strong>{formatSessionTime(dropsTrackerSessionElapsedMs)}</strong>
              <span>Session Timer</span>
              <Button variant="danger" size="sm" onclick={() => settingsStore.resetDropsTrackerSessionTimer()}>Reset Session</Button>
            </div>
          </div>
          <Button variant="danger" size="sm" onclick={resetDropsTrackerRunsAndTimers}>Reset Runs + Timers</Button>
        </div>
      </div>

      <div class="selector-panel">
        <div class="selector-heading">
          <h3>Tracked Categories</h3>
          <div class="inline-actions">
            <Button variant="secondary" size="sm" onclick={() => setAllDropsCategories(true)}>All</Button>
            <Button variant="secondary" size="sm" onclick={() => setAllDropsCategories(false)}>None</Button>
          </div>
        </div>
        <div class="toggle-grid">
          {#each DROP_TRACKER_CATEGORIES as category}
            <label class="toggle-row">
              <span>{categoryLabel(category.key)}</span>
              <Toggle checked={dropsTrackerCategories[category.key]} onchange={(enabled) => settingsStore.setDropsTrackerCategory(category.key as DropTrackerCategoryKey, enabled)} />
            </label>
          {/each}
        </div>
      </div>
    </div>
  {:else if activeOverlayTab === 'total'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Total Drops Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.totalDropsOverlayPosition, settingsStore.settings.totalDropsOverlayWidth, settingsStore.settings.totalDropsOverlayHeight)}</p>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">Show Total Drops Overlay</span>
          <span class="setting-hint">Lifetime drop counts. Tracking continues while hidden.</span>
        </div>
        <Toggle checked={settingsStore.settings.totalDropsTrackerEnabled} onchange={(enabled) => settingsStore.setTotalDropsTrackerEnabled(enabled)} />
      </div>

      <div class="reset-panel">
        <div class="reset-panel-heading">
          <h3>Total Drops Reset</h3>
          <span>Clear the persistent Total Drops overlay counters.</span>
        </div>
        <div class="metric-actions">
          <div>
            <strong>{countTotal(totalDropsTrackerCounts, totalDropsTrackerCategories)}</strong>
            <span>Total Drops</span>
            <Button variant="danger" size="sm" onclick={resetTotalDropsTrackerSessionCounts}>Reset Total Drops</Button>
          </div>
        </div>
      </div>

      <div class="selector-panel">
        <div class="selector-heading">
          <h3>Tracked Categories</h3>
          <div class="inline-actions">
            <Button variant="secondary" size="sm" onclick={() => setAllTotalCategories(true)}>All</Button>
            <Button variant="secondary" size="sm" onclick={() => setAllTotalCategories(false)}>None</Button>
          </div>
        </div>
        <div class="toggle-grid">
          {#each DROP_TRACKER_CATEGORIES as category}
            <label class="toggle-row">
              <span>{categoryLabel(category.key)}</span>
              <Toggle checked={totalDropsTrackerCategories[category.key]} onchange={(enabled) => settingsStore.setTotalDropsTrackerCategory(category.key as DropTrackerCategoryKey, enabled)} />
            </label>
          {/each}
        </div>
      </div>
    </div>
  {:else if activeOverlayTab === 'grail'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Grail Progress Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.holyGrailOverlayPosition, settingsStore.settings.holyGrailOverlayWidth, settingsStore.settings.holyGrailOverlayHeight)}</p>
      </div>

      <div class="settings-grid">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Show Grail Progress Overlay</span>
            <span class="setting-hint">Compact completion progress for Holy Grail categories.</span>
          </div>
          <Toggle checked={settingsStore.settings.holyGrailOverlayEnabled} onchange={(enabled) => settingsStore.setHolyGrailOverlayEnabled(enabled)} />
        </div>
        <div class="switch-grid">
          <label><span>Total Progress</span><Toggle checked={settingsStore.settings.holyGrailOverlayShowTotal} onchange={(enabled) => settingsStore.setHolyGrailOverlayShowTotal(enabled)} /></label>
          <label><span>Latest Grail Drop</span><Toggle checked={settingsStore.settings.holyGrailOverlayShowLatest} onchange={(enabled) => settingsStore.setHolyGrailOverlayShowLatest(enabled)} /></label>
        </div>
      </div>

      <div class="selector-panel">
        <div class="selector-heading">
          <h3>Category Rows</h3>
          <div class="inline-actions">
            <Button variant="secondary" size="sm" onclick={() => setAllHolyGrailCategories(true)}>All</Button>
            <Button variant="secondary" size="sm" onclick={() => setAllHolyGrailCategories(false)}>None</Button>
          </div>
        </div>
        <div class="toggle-grid">
          {#each HOLY_GRAIL_CATEGORIES as category}
            <label class="toggle-row">
              <span>{holyGrailCategoryLabel(category.key)}</span>
              <Toggle checked={holyGrailOverlayCategories[category.key]} onchange={(enabled) => settingsStore.setHolyGrailOverlayCategory(category.key as HolyGrailCategoryKey, enabled)} />
            </label>
          {/each}
        </div>
      </div>
    </div>
  {:else if activeOverlayTab === 'fate-cards'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Fate Cards Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.fateCardTrackerOverlayPosition, settingsStore.settings.fateCardTrackerOverlayWidth, settingsStore.settings.fateCardTrackerOverlayHeight)}</p>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">Show Fate Cards Overlay</span>
          <span class="setting-hint">Live drop counters for selected cards and selected tiers.</span>
        </div>
        <Toggle checked={settingsStore.settings.fateCardTrackerOverlayEnabled} onchange={(enabled) => settingsStore.setFateCardTrackerOverlayEnabled(enabled)} />
      </div>

      <div class="reset-panel">
        <div class="reset-panel-heading">
          <h3>Fate Card Session Reset</h3>
          <span>Clears only the overlay session counts. Fate Card Grail stack progress is preserved.</span>
        </div>
        <div class="metric-actions">
          <div>
            <strong>{fateCardSessionTotal()}</strong>
            <span>Session Cards</span>
            <Button variant="danger" size="sm" onclick={resetFateCardTrackerSessionCounts}>Reset Fate Cards</Button>
          </div>
        </div>
      </div>

      <div class="selector-panel">
        <div class="selector-heading">
          <h3>Track Card Tiers</h3>
          <div class="inline-actions">
            <Button variant="secondary" size="sm" onclick={() => settingsStore.setAllFateCardTrackerOverlayTiers(true)}>All</Button>
            <Button variant="secondary" size="sm" onclick={() => settingsStore.setAllFateCardTrackerOverlayTiers(false)}>None</Button>
          </div>
        </div>
        <div class="fate-tier-grid">
          {#each SOE_13_FATE_CARD_TIERS as tier}
            {@const tierKey = fateCardTierKey(tier)}
            <label class="toggle-row tier-toggle-row">
              <span>{fateCardTierLabel(tier)}</span>
              <strong>{SOE_13_FATE_CARD_INFO.filter((card) => card.tier === tier).reduce((sum, card) => sum + fateCardSessionCount(card.name), 0)}</strong>
              <Toggle checked={fateCardTrackerOverlayTiers[tierKey] ?? true} onchange={(enabled) => settingsStore.setFateCardTrackerOverlayTier(tier, enabled)} />
            </label>
          {/each}
        </div>
      </div>

      <div class="selector-panel">
        <div class="selector-heading">
          <h3>Track Specific Cards</h3>
          <div class="inline-actions">
            <Button variant="secondary" size="sm" onclick={() => settingsStore.setAllFateCardTrackerOverlayCards(true)}>All</Button>
            <Button variant="secondary" size="sm" onclick={() => settingsStore.setAllFateCardTrackerOverlayCards(false)}>None</Button>
          </div>
        </div>
        <input class="filter-input" bind:value={fateCardSearch} placeholder="Search cards, tiers, or rewards..." />
        <div class="long-toggle-list">
          {#each visibleFateCards as card (card.name)}
            <label class="toggle-row detail-toggle-row">
              <span>
                <strong>{card.name}</strong>
                <small>{fateCardTierLabel(card.tier)} | {card.reward}</small>
              </span>
              <em>{fateCardSessionCount(card.name)}</em>
              <Toggle checked={fateCardTrackerOverlayCards[card.name] ?? false} onchange={(enabled) => settingsStore.setFateCardTrackerOverlayCard(card.name, enabled)} />
            </label>
          {/each}
        </div>
      </div>
    </div>
  {:else if activeOverlayTab === 'materials'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Mats Tracker Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.materialTrackerOverlayPosition, settingsStore.settings.materialTrackerOverlayWidth, settingsStore.settings.materialTrackerOverlayHeight)}</p>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">Show Mats Tracker Overlay</span>
          <span class="setting-hint">Live material drop counters for selected materials.</span>
        </div>
        <Toggle checked={settingsStore.settings.materialTrackerOverlayEnabled} onchange={(enabled) => settingsStore.setMaterialTrackerOverlayEnabled(enabled)} />
      </div>

      <div class="reset-panel">
        <div class="reset-panel-heading">
          <h3>Mats Session Reset</h3>
          <span>Clear the current Mats Tracker overlay counters.</span>
        </div>
        <div class="metric-actions">
          <div>
            <strong>{materialTotal()}</strong>
            <span>Materials</span>
            <Button variant="danger" size="sm" onclick={resetMaterialTrackerSessionCounts}>Reset Mats</Button>
          </div>
        </div>
      </div>

      <div class="selector-panel">
        <div class="selector-heading">
          <h3>Overlay Materials</h3>
          <div class="inline-actions">
            <Button variant="secondary" size="sm" onclick={() => settingsStore.setAllMaterialTrackerOverlayMaterials(true)}>All</Button>
            <Button variant="secondary" size="sm" onclick={() => settingsStore.setAllMaterialTrackerOverlayMaterials(false)}>None</Button>
          </div>
        </div>
        <input class="filter-input" bind:value={materialSearch} placeholder="Search materials..." />
        <div class="long-toggle-list compact-list">
          {#each visibleMaterials as material}
            <label class="toggle-row detail-toggle-row">
              <span>{material}</span>
              <em>{materialCount(material)}</em>
              <Toggle checked={materialTrackerOverlayMaterials[material]} onchange={(enabled) => settingsStore.setMaterialTrackerOverlayMaterial(material, enabled)} />
            </label>
          {/each}
        </div>
      </div>
    </div>
  {:else if activeOverlayTab === 'runes'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Rune Tracker Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.runeTrackerOverlayPosition, settingsStore.settings.runeTrackerOverlayWidth, settingsStore.settings.runeTrackerOverlayHeight)}</p>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">Show Rune Tracker Overlay</span>
          <span class="setting-hint">Live rune drop counters for selected runes.</span>
        </div>
        <Toggle checked={settingsStore.settings.runeTrackerOverlayEnabled} onchange={(enabled) => settingsStore.setRuneTrackerOverlayEnabled(enabled)} />
      </div>

      <div class="reset-panel">
        <div class="reset-panel-heading">
          <h3>Rune Session Reset</h3>
          <span>Clear the current Rune Tracker overlay counters.</span>
        </div>
        <div class="metric-actions">
          <div>
            <strong>{runeTotal()}</strong>
            <span>Runes</span>
            <Button variant="danger" size="sm" onclick={resetRuneTrackerSessionCounts}>Reset Runes</Button>
          </div>
        </div>
      </div>

      <div class="selector-panel">
        <div class="selector-heading">
          <h3>Overlay Runes</h3>
          <div class="inline-actions">
            <Button variant="secondary" size="sm" onclick={() => settingsStore.setAllRuneTrackerOverlayRunes(true)}>All</Button>
            <Button variant="secondary" size="sm" onclick={() => settingsStore.setAllRuneTrackerOverlayRunes(false)}>None</Button>
          </div>
        </div>
        <div class="rune-grid">
          {#each RUNE_NAMES as rune}
            <label class="toggle-row rune-toggle-row">
              <span>{rune}</span>
              <em>{runeCount(rune)}</em>
              <Toggle checked={runeTrackerOverlayRunes[rune]} onchange={(enabled) => settingsStore.setRuneTrackerOverlayRune(rune as RuneName, enabled)} />
            </label>
          {/each}
        </div>
      </div>
    </div>
  {:else if activeOverlayTab === 'achievements'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Achievement Progress Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.achievementProgressOverlayPosition, settingsStore.settings.achievementProgressOverlayWidth, settingsStore.settings.achievementProgressOverlayHeight)}</p>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">Show Achievement Progress Overlay</span>
          <span class="setting-hint">Shows unlocked achievements and total completion percentage.</span>
        </div>
        <Toggle checked={settingsStore.settings.achievementProgressOverlayEnabled} onchange={(enabled) => settingsStore.setAchievementProgressOverlayEnabled(enabled)} />
      </div>
    </div>
  {:else if activeOverlayTab === 'achievement-popup'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Achievement Popup Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.achievementPopupOverlayPosition, settingsStore.settings.achievementPopupOverlayWidth, settingsStore.settings.achievementPopupOverlayHeight)}</p>
      </div>

      <div class="settings-grid">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">Achievement Unlock Popups</span>
            <span class="setting-hint">Popups appear when an achievement reaches 100% for the first time.</span>
          </div>
          <Toggle checked={achievementSettings.overlayEnabled} onchange={(enabled) => settingsStore.setAchievementSettings({ overlayEnabled: enabled })} />
        </div>

        <label class="field-row">
          <span>Duration</span>
          <div class="range-control">
            <input type="range" min="1500" max="20000" step="500" value={achievementSettings.overlayDuration} oninput={(event) => setAchievementDuration(Number((event.currentTarget as HTMLInputElement).value))} />
            <strong>{(achievementSettings.overlayDuration / 1000).toFixed(1)}s</strong>
          </div>
        </label>

        <label class="field-row">
          <span>Font Size</span>
          <div class="range-control">
            <input type="range" min="11" max="28" step="1" value={achievementSettings.overlayFontSize} oninput={(event) => setAchievementFontSize(Number((event.currentTarget as HTMLInputElement).value))} />
            <strong>{achievementSettings.overlayFontSize}px</strong>
          </div>
        </label>

        <label class="field-row">
          <span>Opacity</span>
          <div class="range-control">
            <input type="range" min="0.25" max="1" step="0.05" value={achievementSettings.overlayOpacity} oninput={(event) => setAchievementOpacity(Number((event.currentTarget as HTMLInputElement).value))} />
            <strong>{Math.round(achievementSettings.overlayOpacity * 100)}%</strong>
          </div>
        </label>
      </div>
    </div>
  {:else if activeOverlayTab === 'kills'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Monster Kills Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.monsterKillsOverlayPosition, settingsStore.settings.monsterKillsOverlayWidth, settingsStore.settings.monsterKillsOverlayHeight)}</p>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">Show Monster Kills Overlay</span>
          <span class="setting-hint">Shows synced and live account-wide monster kills.</span>
        </div>
        <Toggle checked={settingsStore.settings.monsterKillsOverlayEnabled} onchange={(enabled) => settingsStore.setMonsterKillsOverlayEnabled(enabled)} />
      </div>
    </div>
  {:else if activeOverlayTab === 'muling'}
    <div class="settings-section overlay-section">
      <div class="section-heading">
        <h2 class="section-title">Muling Indicator Overlay</h2>
        <p class="section-description">{layoutSummary(settingsStore.settings.mulingIndicatorOverlayPosition, settingsStore.settings.mulingIndicatorOverlayWidth, settingsStore.settings.mulingIndicatorOverlayHeight)}</p>
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">Show Muling Indicator</span>
          <span class="setting-hint">Shows the compact hotkey/M indicator while Muling Mode is active.</span>
        </div>
        <Toggle checked={settingsStore.settings.mulingIndicatorOverlayEnabled} onchange={setMulingIndicatorOverlayEnabled} />
      </div>
    </div>
  {/if}
</section>

<style>
  .overlays-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    overflow: auto;
  }

  .overlay-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-5);
    border: 1px solid var(--border-primary);
    background: var(--bg-secondary);
    box-shadow: var(--shadow-sm);
  }

  .overlay-hero-actions,
  .inline-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .overlay-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .section-heading {
    display: grid;
    gap: 4px;
  }

  .section-description {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .settings-grid {
    display: grid;
    gap: var(--space-3);
  }

  .setting-row,
  .field-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3);
    border: 1px solid var(--border-primary);
    background: var(--bg-secondary);
  }

  .setting-info {
    display: grid;
    gap: 4px;
    min-width: 0;
  }

  .setting-label,
  .field-row > span,
  .selector-heading h3 {
    color: var(--text-primary);
    font-weight: 700;
  }

  .setting-hint {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .field-row {
    color: var(--text-secondary);
  }

  .field-row select {
    min-width: 180px;
    padding: 8px 10px;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .range-control {
    display: grid;
    grid-template-columns: minmax(160px, 1fr) 64px;
    align-items: center;
    gap: var(--space-3);
    min-width: min(340px, 48vw);
  }

  .range-control input {
    width: 100%;
  }

  .range-control strong,
  .toggle-row em,
  .tier-toggle-row strong {
    color: var(--accent-primary);
    font-family: var(--font-mono);
    font-style: normal;
    text-align: right;
  }

  .reset-panel {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border-primary);
    background: color-mix(in srgb, var(--bg-secondary) 82%, #000 18%);
  }

  .reset-panel-heading {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .reset-panel-heading h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-base);
  }

  .reset-panel-heading span {
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-align: right;
  }

  .metric-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--space-2);
  }

  .metric-actions > div {
    display: grid;
    gap: 6px;
    align-content: start;
    padding: var(--space-3);
    border: 1px solid var(--border-secondary);
    background: var(--bg-primary);
  }

  .metric-actions strong {
    color: var(--accent-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xl);
  }

  .metric-actions span {
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .switch-grid,
  .toggle-grid,
  .fate-tier-grid,
  .rune-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: var(--space-2);
  }

  .switch-grid label,
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-height: 42px;
    padding: 10px 12px;
    border: 1px solid var(--border-primary);
    background: color-mix(in srgb, var(--bg-secondary) 88%, transparent);
    color: var(--text-primary);
  }

  .selector-panel {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border-primary);
    background: color-mix(in srgb, var(--bg-secondary) 78%, transparent);
  }

  .selector-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .selector-heading h3 {
    margin: 0;
    font-size: var(--text-md);
  }

  .filter-input {
    width: 100%;
    padding: 9px 11px;
    border: 1px solid var(--border-primary);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .long-toggle-list {
    display: grid;
    gap: 6px;
    max-height: 390px;
    overflow: auto;
    padding-right: 4px;
  }

  .compact-list {
    max-height: 460px;
  }

  .detail-toggle-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 56px auto;
  }

  .detail-toggle-row span {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  .detail-toggle-row small {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rune-toggle-row {
    display: grid;
    grid-template-columns: minmax(40px, 1fr) 50px auto;
  }

  .tier-toggle-row {
    display: grid;
    grid-template-columns: minmax(90px, 1fr) 60px auto;
  }

  .status-message {
    margin: 0;
    color: var(--accent-primary);
    font-size: var(--text-sm);
  }

  .diagnostics-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .diagnostics-note,
  .diagnostics-empty {
    display: grid;
    gap: 4px;
    padding: var(--space-3);
    border: 1px solid var(--border-primary);
    background: color-mix(in srgb, var(--accent-primary) 9%, var(--bg-secondary));
    color: var(--text-secondary);
  }

  .diagnostics-note strong {
    color: var(--accent-primary);
  }

  .diagnostics-note span,
  .diagnostics-empty p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    line-height: 1.45;
  }

  .diagnostic-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3);
  }

  .diagnostic-card,
  .diagnostics-panel {
    border: 1px solid var(--border-primary);
    background: color-mix(in srgb, var(--bg-secondary) 84%, #000 16%);
  }

  .diagnostic-card {
    display: grid;
    gap: 6px;
    padding: var(--space-3);
  }

  .diagnostic-card h3,
  .diagnostics-panel h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--text-base);
  }

  .diagnostic-card strong {
    color: var(--accent-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xl);
  }

  .diagnostic-card span {
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .diagnostics-warning-list {
    display: grid;
    gap: var(--space-2);
  }

  .diagnostics-warning-list p {
    margin: 0;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--status-warning-text) 55%, var(--border-primary));
    background: color-mix(in srgb, var(--status-warning-text) 12%, var(--bg-primary));
    color: var(--status-warning-text);
    font-size: var(--text-sm);
    line-height: 1.4;
  }

  .diagnostics-panel {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .diagnostics-panel-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .diag-pill {
    min-width: 72px;
    padding: 4px 8px;
    border: 1px solid var(--border-secondary);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: center;
    text-transform: uppercase;
  }

  .diag-pill.ok {
    border-color: color-mix(in srgb, var(--status-success-text) 70%, var(--border-primary));
    color: var(--status-success-text);
  }

  .diag-pill.warn {
    border-color: color-mix(in srgb, var(--status-warning-text) 70%, var(--border-primary));
    color: var(--status-warning-text);
  }

  .diagnostics-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    gap: 8px;
  }

  .diagnostics-facts div {
    display: grid;
    gap: 3px;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid var(--border-secondary);
    background: var(--bg-primary);
  }

  .diagnostics-facts span {
    color: var(--text-muted);
    font-size: var(--text-xs);
    text-transform: uppercase;
  }

  .diagnostics-facts strong {
    min-width: 0;
    overflow: hidden;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .diagnostic-window-list {
    display: grid;
    gap: 6px;
    max-height: 320px;
    overflow: auto;
    padding-right: 4px;
  }

  .diagnostic-window-row {
    display: grid;
    grid-template-columns: minmax(150px, 1.1fr) 76px 92px minmax(140px, 1fr) minmax(0, 1fr);
    gap: var(--space-2);
    align-items: center;
    padding: 8px 10px;
    border: 1px solid var(--border-secondary);
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .diagnostic-window-row strong {
    color: var(--text-primary);
  }

  .diagnostic-window-row em {
    min-width: 0;
    overflow: hidden;
    color: var(--status-warning-text);
    font-style: normal;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 760px) {
    .overlay-hero,
    .setting-row,
    .field-row,
    .selector-heading {
      align-items: stretch;
      flex-direction: column;
    }

    .overlay-hero-actions,
    .inline-actions {
      justify-content: flex-start;
    }

    .range-control {
      min-width: 0;
      width: 100%;
    }

    .diagnostic-window-row {
      grid-template-columns: 1fr;
    }
  }
</style>
