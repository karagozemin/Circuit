import { Component, type ReactNode } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Brand } from './shared'

export default class WorkspaceErrorBoundary extends Component<
  { children: ReactNode; onHome: () => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children

    return <main id="main-content" className="workspace-loading workspace-load-error" role="alert">
      <Brand />
      <div>
        <h1>Let’s reopen your workspace.</h1>
        <p>Something interrupted loading. Reload to try again; your saved drafts will stay in this browser.</p>
      </div>
      <div className="workspace-recovery-actions">
        <button className="btn btn-primary" onClick={() => window.location.reload()}><RefreshCw size={16} /> Reload workspace</button>
        <button className="btn btn-white" onClick={this.props.onHome}><ArrowLeft size={16} /> Back to home</button>
      </div>
    </main>
  }
}
