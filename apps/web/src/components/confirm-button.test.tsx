import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmButton } from "./confirm-button";

afterEach(cleanup);

describe("ConfirmButton focus", () => {
  it("moves focus to Confirm when the question opens", () => {
    render(
      <ConfirmButton label="Delete" question="Delete it?" onConfirm={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Confirm" }),
    );
  });

  it("returns focus to the trigger when the question is cancelled", () => {
    render(
      <ConfirmButton label="Delete" question="Delete it?" onConfirm={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Delete" }),
    );
  });
});
