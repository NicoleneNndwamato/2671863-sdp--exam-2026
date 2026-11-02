import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";

jest.mock("./api", () => ({
  fetchAlerts: jest.fn().mockResolvedValue([]),
  acknowledgeAlert: jest.fn(),
  resolveAlert: jest.fn(),
  fetchReadings: jest.fn()
}));

describe("App shell", () => {
  it("keeps an annunciator visible alongside the service panel", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "ARL Operations" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByLabelText("Alert annunciator")).toBeInTheDocument();

    expect(await screen.findByText("No alerts.")).toBeInTheDocument();
  });

  it("switches the active service panel", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Local Weather" }));

    expect(screen.getByRole("heading", { name: "Local Weather" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Local Weather" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
