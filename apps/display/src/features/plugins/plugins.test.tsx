import { PluginBlocks } from '@mantel/shared';
import { pluginBlocks, pluginPackSamples } from '@mantel/shared/fixtures';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('draws every plugin-pack sample card', () => {
    for (const [id, raw] of Object.entries(pluginPackSamples())) {
      const blocks = PluginBlocks.parse(raw);
      const { unmount } = render(
        <OverlayProvider>
          <BlocksView plugin={id} blocks={blocks} variant="card" />
        </OverlayProvider>,
      );
      expect(screen.getByText(blocks.title)).toBeTruthy();
      unmount();
    }
  });

  it('shows a lead line, and posts the text box with a suggestion', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, message: 'Asked: Park or pool?' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const blocks = PluginBlocks.parse({
      title: 'Family poll',
      lead: 'What should we do Saturday?',
      input: {
        action: 'ask',
        label: 'Ask the family',
        submit: 'Ask',
        suggestions: ['Park or pool?'],
      },
    });
    render(
      <OverlayProvider>
        <BlocksView plugin="poll" blocks={blocks} variant="card" />
      </OverlayProvider>,
    );
    expect(screen.getByText('What should we do Saturday?')).toBeTruthy();
    const ask = screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement;
    expect(ask.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Park or pool?' }));
    fireEvent.click(ask);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/plugins/poll/actions/ask');
    expect(JSON.parse(String(init.body))).toEqual({ args: { text: 'Park or pool?' } });
    vi.unstubAllGlobals();
  });
});
