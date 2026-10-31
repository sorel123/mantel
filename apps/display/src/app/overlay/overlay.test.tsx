import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OverlayProvider, SheetHeader, useOverlay } from './index';

function Harness() {
  const o = useOverlay();
  return (
    <div>
      <button
        onClick={() =>
          o.openSheet((close) => (
            <>
              <SheetHeader title="31" subtitle="Friday" onClose={close} />
              <div className="sheet-body">Sheet body</div>
            </>
          ))
        }
      >
        sheet
      </button>
      <button
        onClick={() =>
          o
            .confirm({ title: 'Unlock?', confirmLabel: 'Unlock', cancelLabel: 'Keep' })
            .then((ok) => o.toast(ok ? 'unlocked' : 'kept'))
        }
      >
        confirm
      </button>
      <button onClick={() => o.showPopover(() => <div>Doorbell</div>, { durationMs: 50 })}>
        popover
      </button>
      <span data-testid="blocking">{String(o.blocking)}</span>
    </div>
  );
}

const setup = () =>
  render(
    <OverlayProvider>
      <Harness />
    </OverlayProvider>,
  );

describe('overlay layer', () => {
  it('opens and closes a sheet', async () => {
    setup();
    fireEvent.click(screen.getByText('sheet'));
    expect(await screen.findByText('Sheet body')).toBeTruthy();
    expect(screen.getByTestId('blocking').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => {});
    expect(screen.getByTestId('blocking').textContent).toBe('false');
  });

  it('resolves confirm with the choice and shows a toast', async () => {
    setup();
    fireEvent.click(screen.getByText('confirm'));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('unlocked')).toBeTruthy();
    fireEvent.click(screen.getByText('confirm'));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep' }));
    expect(await screen.findByText('kept')).toBeTruthy();
  });

  it('closes a timed pop-over by itself', async () => {
    setup();
    fireEvent.click(screen.getByText('popover'));
    expect(await screen.findByText('Doorbell')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(screen.getByTestId('blocking').textContent).toBe('false');
  });

  it('closes the top overlay with Escape', async () => {
    setup();
    fireEvent.click(screen.getByText('sheet'));
    await screen.findByText('Sheet body');
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => {});
    expect(screen.getByTestId('blocking').textContent).toBe('false');
  });
});
