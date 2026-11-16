import { Component } from "react";
import { createRoot } from "react-dom/client";
import { App, FeedbackForm, ReportButton } from "./App.jsx";
// Atkinson Hyperlegible (SIL Open Font License) for the agent text. It is in the app, so it works with no network.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/atkinson-hyperlegible/latin-400-italic.css";
import "@fontsource/atkinson-hyperlegible/latin-700-italic.css";
import "./styles.css";

// An error in a component removes the whole page (a blank window). Show the error, "Report this error", and Reload
// instead. Nothing is sent before the student clicks Send in the form.
class ErrorScreen extends Component {
  state = { error: undefined, form: undefined, reportError: "" };
  async report() {
    const text = `Render error in the window: ${this.state.error?.stack ?? this.state.error}${this.componentStack ? `\n\nComponents:${this.componentStack}` : ""}`;
    const d = await window.catatui.feedbackOpen("error", undefined, { text });
    if (d.error) this.setState({ reportError: d.error }); else this.setState({ form: d });
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    this.componentStack = info?.componentStack ?? "";
    console.error("catai render error:", error?.stack ?? error, this.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-screen">
        <h2>catai stopped because of an error</h2>
        <pre>{String(this.state.error?.stack ?? this.state.error)}</pre>
        <div className="error-screen-buttons">
          <ReportButton onClick={() => this.report()} />
          <button className="btn primary" onClick={() => location.reload()}>Reload</button>
        </div>
        {this.state.reportError && <p className="error">{this.state.reportError}</p>}
        {this.state.form && <FeedbackForm data={this.state.form} onClose={() => this.setState({ form: undefined })} />}
      </div>
    );
  }
}

createRoot(document.getElementById("root")).render(<ErrorScreen><App /></ErrorScreen>);
