import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * A panel that throws must not take the annunciator down with it.
 *
 * The broker publishes whatever the services decide to publish, so a missing
 * field is a normal Tuesday. This boundary keeps one malformed panel local and
 * leaves the rest of the console - including the alert annunciator - usable.
 */
export class PanelBoundary extends Component<
  { name: string; children: ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console is the honest place for this: the operator gets a readable notice,
    // the developer gets the component stack.
    console.error(`panel "${this.props.name}" failed`, error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <div
          role="alert"
          style={{
            border: "1px solid #c77d1a",
            background: "rgba(199, 125, 26, 0.12)",
            color: "#8a5510",
            padding: "10px 12px",
            fontSize: 12
          }}
        >
          <strong>{this.props.name}</strong> could not render: {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}
