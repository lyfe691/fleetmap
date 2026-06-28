"use client"

import React from "react"

type Props = { fallback?: React.ReactNode; children: React.ReactNode }
type State = { failed: boolean }

/**
 * Minimal boundary for non-critical UI: on a render error it swaps in `fallback`
 * (default: nothing) instead of letting the throw unmount the surrounding tree.
 * Used to keep a WebGL failure in decorative children from taking out siblings.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}
