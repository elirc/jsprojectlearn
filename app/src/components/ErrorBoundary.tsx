import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | undefined;
}

/**
 * A route that throws shows this instead of a blank app. Keyed on the
 * pathname by Layout, so navigating away clears it; "Try again" re-renders
 * the same route (enough for a transient failure). Deliberately imports
 * nothing from the app — a fallback that can itself throw is no fallback.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; home?: boolean }, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('DevPath: a screen failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <div className="banner" role="alert">
          <strong>This screen hit a bug.</strong>
          <p className="mt-1 m-0">{error.message}</p>
          <div className="row mt-2">
            <button className="btn sm" onClick={() => this.setState({ error: undefined })}>
              Try again
            </button>
            {this.props.home !== false && (
              <a className="btn sm ghost" href="#/">
                Back to Today
              </a>
            )}
            <button className="btn sm ghost" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
