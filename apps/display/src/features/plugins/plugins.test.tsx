import { PluginBlocks } from '@mantel/shared';
import { pluginBlocks } from '@mantel/shared/fixtures';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverlayProvider } from '../../app/overlay';
import { BlocksView, formatCountdown } from './Blocks';

describe('plugin blocks', () => {
  it('formats countdowns as m:ss or h:mm:ss, never below zero', () => {
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(3_723_000)).toBe('1:02:03');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(formatCountdown(400)).toBe('0:01');
  });

  it('draws a card: title, rows with their tone, and no buttons on Ambient', () => {
    const blocks = PluginBlocks.parse(pluginBlocks()['trash/card']);
    const { container, unmount } = render(
      <OverlayProvider>
        <BlocksView plugin="trash" blocks={blocks} variant="card" />
      </OverlayProvider>,
    );
    expect(screen.getByText('Trash and recycling tonight')).toBeTruthy();
    expect(container.querySelectorAll('li[data-tone="warn"]')).toHaveLength(2);
    expect(container.querySelector('.pb')?.getAttribute('data-tone')).toBe('warn');
    unmount();
  });

  it('draws a sheet with presets and the dial', () => {
    const blocks = PluginBlocks.parse(pluginBlocks()['timers/sheet']);
    render(
      <OverlayProvider>
        <BlocksView plugin="timers" blocks={blocks} variant="sheet" hideTitle />
      </OverlayProvider>,
    );
    expect(screen.getByRole('button', { name: '5 min' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Or set your own' })).toBeTruthy();
    expect(screen.queryByText('Kitchen timers')).toBeNull();
  });
});
