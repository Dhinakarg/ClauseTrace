/**
 * ErrorBoundary.
 *
 * A render error must never leave a blank screen. Nothing is swallowed: the
 * message is shown and logged, and the user gets a way back.
 */

import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surfaced in the console for developers; the UI stays usable.
    console.error('ClauseGraph render error:', error, info?.componentStack ?? '');
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="panel p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 text-flag-500" />
            <div>
              <h1 className="font-serif text-xl text-ink-900">Something went wrong in this view</h1>
              <p className="mt-2 text-sm text-ink-700">
                The rest of the workspace is unaffected. Reloading usually clears a transient
                rendering problem.
              </p>
              <pre className="mt-3 max-h-40 overflow-auto rounded bg-ink-50 p-2 text-xs text-ink-700">
                {String(error?.message ?? error)}
              </pre>
              <div className="mt-4 flex gap-2">
                <Button variant="primary" onClick={() => window.location.reload()}>
                  Reload workspace
                </Button>
                <Button onClick={() => this.setState({ error: null })}>Try again</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
