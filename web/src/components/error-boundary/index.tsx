// What shows in place of a part of the page that failed to render, such as one whose code could not
// be loaded, so the rest of the page stays.

import { Component, type ErrorInfo, type ReactNode } from 'react'

export class ErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('could not show this part of the page', error, info.componentStack)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
