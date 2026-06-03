<script lang="ts">
  import { onMount } from 'svelte';
  import { updaterStore } from '../stores';
  import Button from './Button.svelte';

  const state = $derived(updaterStore.state);

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  onMount(() => {
    void updaterStore.initListeners();
    return () => updaterStore.destroyListeners();
  });
</script>

<div class="update-control">
  {#if state.kind === 'checking'}
    <Button variant="secondary" size="sm" disabled>Checking...</Button>
  {:else if state.kind === 'available'}
    <div class="update-message">v{state.latestVersion} available</div>
    <Button variant="primary" size="sm" onclick={() => updaterStore.install()}>Install Update</Button>
  {:else if state.kind === 'downloading'}
    <div class="update-message">Downloading {formatBytes(state.downloaded)}</div>
    <Button variant="secondary" size="sm" disabled>Installing...</Button>
  {:else if state.kind === 'ready'}
    <div class="update-message">v{state.latestVersion} ready</div>
    <Button variant="primary" size="sm" onclick={() => updaterStore.restart()}>Restart</Button>
  {:else}
    {#if state.kind === 'up_to_date'}
      <div class="update-message">v{state.currentVersion} is current</div>
    {:else if state.kind === 'error'}
      <div class="update-message error">{state.message}</div>
    {/if}
    <Button variant="secondary" size="sm" onclick={() => updaterStore.check(true)}>Check for Updates</Button>
  {/if}
</div>

<style>
  .update-control {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    min-width: 190px;
  }

  .update-message {
    max-width: 280px;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.3;
    text-align: right;
    overflow-wrap: anywhere;
  }

  .update-message.error {
    color: var(--accent-secondary);
  }
</style>
