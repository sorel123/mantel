import { Component, type ReactNode } from 'react';

/**
 * Keeps one screen's crash from blanking the wall. The other screens, the dock and Ambient keep
 * working; the broken screen shows a card with a retry, and tries again on its own after a minute.
 */
export class ScreenBoundary extends Component<
  { children: ReactNode; name?: string },
  { error: Error | null }
> {
  override state = { error: null as Error | null };
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error(`[mantel] screen "${this.props.name ?? '?'}" crashed`, error);
    clearTimeout(this.timer);
    this.timer = setTimeout(this.reset, 60_000);
  }

  override componentWillUnmount() {
    clearTimeout(this.timer);
  }

  reset = () => {
    clearTimeout(this.timer);
    this.setState({ error: null });
  };

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="placeholder card" role="alert">
        <div>
          <div className="eyebrow">Something went wrong</div>
          <h1 className="h2" style={{ marginTop: 10 }}>
            This screen hit a problem
          </h1>
          <p>{this.state.error.message}</p>
          <button className="btn primary" style={{ marginTop: 18 }} onClick={this.reset}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
