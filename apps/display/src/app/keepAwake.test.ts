import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDockDate } from './Clock';
import { awakeLabel, useKeepAwake } from './keepAwake';

describe('keep the screen on', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('holds for a while, survives a reload, then lets go by itself', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 2, 9, 0));
    const { result } = renderHook(() => useKeepAwake());
    expect(result.current.held).toBe(false);
    act(() => result.current.hold(60));
    expect(result.current.held).toBe(true);
    expect(awakeLabel(result.current.until, new Date())).toBe('until 10:00 am');
    // A reload reads it back.
    expect(renderHook(() => useKeepAwake()).result.current.held).toBe(true);
    act(() => void vi.advanceTimersByTime(60 * 60_000 + 10));
    expect(result.current.held).toBe(false);
  });

  it('holds until turned off', () => {
    const { result } = renderHook(() => useKeepAwake());
    act(() => result.current.hold(null));
    expect(awakeLabel(result.current.until)).toBe('until you turn it off');
    act(() => result.current.release());
    expect(result.current.held).toBe(false);
  });

  it('formats the dock date', () => {
    const d = new Date(2026, 10, 2, 9, 0);
    expect(formatDockDate(d, 'off')).toBeUndefined();
    expect(formatDockDate(d, 'day')).toBe('Mon 2');
    expect(formatDockDate(d, 'date')).toBe('Mon, Nov 2');
  });
});
