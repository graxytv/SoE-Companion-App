<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { emit, listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { Button, HotkeyInput, SubTabs, Toggle } from '../components';
  import { settingsStore, type HotkeyConfig, type OverlayPosition } from '../stores';
  import {
    DROP_TRACKER_CATEGORIES,
    RUNE_NAMES,
    categoryLabel,
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

  type OverlayTab =
    | 'global'
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

  const UNBOUND: HotkeyConfig = { keyCode: 0, modifiers: 0, display: 'None' };

  let activeOverlayTab = $state<OverlayTab>('global');
  let overlayLayoutEditing = $state(false);
  let overlayLayoutMessage = $state('');
  let materialSearch = $state('');
  let fateCardSearch = $state('');

  let achievementSettings = $derived(settingsStore.settings.achievementSettings);
  let dropsTrackerCategories = $derived(settingsStore.settings.dropsTrackerCategories);
  let totalDropsTrackerCategories = $derived(settingsStore.settings.totalDropsTrackerCategories);
  let holyGrailOverlayCategories = $derived(settingsStore.settings.holyGrailOverlayCategories);
  let materialTrackerOverlayMaterials = $derived(settingsStore.settings.materialTrackerOverlayMaterials);
  let materialTrackerCounts = $derived(settingsStore.settings.materialTrackerCounts);
  let runeTrackerOverlayRunes = $derived(settingsStore.settings.runeTrackerOverlayRunes);
  let runeTrackerCounts = $derived(settingsStore.settings.runeTrackerCounts);
  let fateCardTrackerOverlayCards = $derived(settingsStore.settings.fateCardTrackerOverlayCards);
  let fateCardTrackerOverlayTiers = $derived(settingsStore.settings.fateCardTrackerOverlayTiers);
  let fateCardDropCounts = $derived(settingsStore.settings.fateCardDropCounts);

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
    overlayLayoutEditing = active;
    if (active) overlayLayoutMessage = '';
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

  function fateCardDropCount(name: string): number {
    return fateCardDropCounts[name] ?? 0;
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
              <strong>{SOE_13_FATE_CARD_INFO.filter((card) => card.tier === tier).reduce((sum, card) => sum + fateCardDropCount(card.name), 0)}</strong>
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
              <em>{fateCardDropCount(card.name)}</em>
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
  }
</style>
