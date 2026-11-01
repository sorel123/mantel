import { DEFAULT_LAYOUT, type LayoutSettings } from '@mantel/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { LayoutSection } from '.';

function Harness({ onChange }: { onChange: (v: LayoutSettings) => void }) {
  const [value, setValue] = useState<LayoutSettings>({ ...DEFAULT_LAYOUT });
  return (
    <LayoutSection
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
    />
  );
}

describe('LayoutSection', () => {
  it('adds, orders and removes the rows under the agenda', () => {
    const changes: LayoutSettings[] = [];
    render(<Harness onChange={(v) => changes.push(v)} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Photo' }));
    expect(changes.at(-1)?.todayRows).toEqual(['tonight', 'week', 'photo']);
    fireEvent.click(screen.getByRole('button', { name: 'Move Photo up' }));
    expect(changes.at(-1)?.todayRows).toEqual(['tonight', 'photo', 'week']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tonight' }));
    expect(changes.at(-1)?.todayRows).toEqual(['photo', 'week']);
    fireEvent.click(screen.getByRole('radio', { name: /Family board/ }));
    expect(screen.queryByRole('list', { name: 'Rows under the agenda' })).toBeNull();
  });

  it('picks presets and a fit, and the slider only counts in Scale', () => {
    const changes: LayoutSettings[] = [];
    render(<Harness onChange={(v) => changes.push(v)} />);

    const today = screen.getByRole('radiogroup', { name: 'Today screen' });
    expect(today.querySelector('[aria-checked="true"]')?.textContent?.startsWith('Agenda')).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Family board/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Week strip/ }));
    expect(changes.at(-1)).toMatchObject({ todayPreset: 'family', monthPreset: 'week' });

    const slider = screen.getByRole('slider', { name: 'Size' }) as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /^Scale/ }));
    expect(slider.disabled).toBe(false);
    fireEvent.change(slider, { target: { value: '120' } });
    expect(changes.at(-1)).toMatchObject({ fit: 'scale', scale: 1.2 });
    expect(screen.getByText('120%')).toBeTruthy();

    // The preview follows: a 16:9 monitor at Scale 120% holds a 1215 by 683 panel.
    const monitor = screen.getByTestId('fit-preview-16:9 monitor');
    expect(monitor.dataset.width).toBe('1215');
    expect(monitor.dataset.height).toBe('683');
  });
});
