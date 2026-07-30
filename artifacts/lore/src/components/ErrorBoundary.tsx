import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Lightweight class-based error boundary.
 * Wraps a subtree and renders a visible error card instead of a blank screen
 * when any child component throws during render.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary] Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "60vh",
            padding: "32px 20px",
            textAlign: "center",
            fontFamily: "var(--app-font-display, 'Archivo Narrow', sans-serif)",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "hsl(var(--destructive, 4 68% 48%))",
              marginBottom: 8,
            }}
          >
            Something went wrong
          </div>
          <div
            style={{
              fontSize: 11,
              color: "hsl(var(--faint, 33 6% 33%))",
              maxWidth: 320,
              lineHeight: 1.5,
            }}
          >
            {this.state.error.message || "An unexpected error occurred."}
          </div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: 20,
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              border: "1px solid hsl(var(--border, 33 8% 18%))",
              borderRadius: 3,
              padding: "7px 14px",
              background: "hsl(var(--secondary, 33 8% 14%))",
              color: "hsl(var(--dim, 33 10% 62%))",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
