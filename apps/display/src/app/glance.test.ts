import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GLANCE_DWELL_MS,
  GLANCE_PAUSE_MS,
  nextScreenId,
  resolveGlance,
  setGlance,
  useGlance,
  useGlanceRotation,
} from './glance';

describe('glance mode setting', () => {
  afterEach(() => {
    setGlance(false);
    localStorage.clear();
  });

  it('lets the URL parameter win over what is stored', () => {
    expect(resolveGlance('', null)).toBe(false);
    expect(resolveGlance('', '1')).toBe(true);
    expect(resolveGlance('?glance=1', null)).toBe(true);
    expect(resolveGlance('?glance=0', '1')).toBe(false);
  });

  it('sets data-glance on <html>, remembers it and tells hooks', () => {
    const { result } = renderHook(() => useGlance());
    expect(result.current).toBe(false);
    act(() => setGlance(true));
    expect(result.current).toBe(true);
    expect(document.documentElement.hasAttribute('data-glance')).toBe(true);
    expect(localStorage.getItem('mantel.glance')).toBe('1');
    act(() => setGlance(false));
    expect(document.documentElement.hasAttribute('data-glance')).toBe(false);
    expect(localStorage.getItem('mantel.glance')).toBeNull();
  });
});

describe('glance rotation', () => {
  afterEach(() => vi.useRealTimers());
  const ids = ['today', 'month', 'lists'];

  it('picks the next screen, wrapping', () => {
    expect(nextScreenId(ids, 'today')).toBe('month');
    expect(nextScreenId(ids, 'lists')).toBe('today');
    expect(nextScreenId(ids, 'gone')).toBe('today');
    expect(nextScreenId([], 'today')).toBeUndefined();
  });

  const setup = (enabled = true, list = ids) => {
    vi.useFakeTimers();
    const go = vi.fn();
    const { rerender } = renderHook(
      ({ current }) => useGlanceRotation({ ids: list, current, go, enabled }),
      { initialProps: { current: 'today' } },
    );
    return { go, rerender };
  };

  it('moves on after the dwell time, then again from the new screen', () => {
    const { go, rerender } = setup();
    act(() => void vi.advanceTimersByTime(GLANCE_DWELL_MS - 1));
    expect(go).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(go).toHaveBeenLastCalledWith('month');
    rerender({ current: 'month' });
    act(() => void vi.advanceTimersByTime(GLANCE_DWELL_MS));
    expect(go).toHaveBeenLastCalledWith('lists');
  });

  it('does nothing when off or with a single screen', () => {
    const off = setup(false);
    act(() => void vi.advanceTimersByTime(GLANCE_DWELL_MS * 3));
    expect(off.go).not.toHaveBeenCalled();
    const one = setup(true, ['today']);
    act(() => void vi.advanceTimersByTime(GLANCE_DWELL_MS * 3));
    expect(one.go).not.toHaveBeenCalled();
  });

  it('pauses for a couple of minutes after a click or key press', () => {
    const { go } = setup();
    act(() => void vi.advanceTimersByTime(GLANCE_DWELL_MS - 100));
    act(() => void document.dispatchEvent(new Event('pointerdown')));
    act(() => void vi.advanceTimersByTime(GLANCE_PAUSE_MS - 1));
    expect(go).not.toHaveBeenCalled();
    act(() => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' })));
    act(() => void vi.advanceTimersByTime(GLANCE_PAUSE_MS - 1));
    expect(go).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(go).toHaveBeenCalledWith('month');
  });
});
