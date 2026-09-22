/**
 * NotFoundPage — unknown route or unknown workspace link.
 * Says what happened and offers every sensible way back.
 */

import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Callout, Panel } from '../components/ui/Panel.jsx';
import { Button } from '../components/ui/Button.jsx';
import { PRIMARY_NAV, routeBuilders } from '../app/navigation.js';
import { useAppState, useAppStore } from '../app/AppProvider.jsx';

export function NotFoundPage() {
  const state = useAppStore();
  const { loadDemoWorkspace } = useAppState();

  return (
    <Panel title="That page does not exist">
      <div className="flex items-start gap-3">
        <FileQuestion aria-hidden="true" className="mt-0.5 h-5 w-5 text-ink-400" />
        <div>
          <p className="text-sm text-ink-700">
            The link you followed does not match any route in this workspace. Document workspaces
            live in memory for the current session, so links from a previous session stop working.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRIMARY_NAV.map((item) => (
              <Link key={item.id} to={item.to}>
                <Button size="sm">{item.label}</Button>
              </Link>
            ))}
            {state.activeDocumentId ? (
              <Link to={routeBuilders.workspace(state.activeDocumentId)}>
                <Button size="sm" variant="primary">
                  Back to the active document
                </Button>
              </Link>
            ) : (
              <Button size="sm" variant="primary" onClick={() => loadDemoWorkspace()}>
                Load the demo agreement
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <Callout tone="info">
          If you expected content here, check the document id in the URL: ids are derived from the
          file name and size, so re-importing the same file produces the same id.
        </Callout>
      </div>
    </Panel>
  );
}

export default NotFoundPage;
