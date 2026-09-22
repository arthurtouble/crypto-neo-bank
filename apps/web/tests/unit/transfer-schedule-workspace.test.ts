import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ due: [{ occurrenceId: "occ-1", scheduleId: "sched-1", dueAt: "2026-09-22T09:00:00.000Z", reminderState: "due", destinationLabel: "Alice", amount: "10", asset: "USDC", timeZone: "Europe/Lisbon" }], scheduleStatus: "approval_required" }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ user: { id: "subject-a" }, getAccessToken: async () => "token" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: async () => undefined }),
  useMutation: () => ({ mutate: () => undefined, isPending: false, isError: false }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "recipients") return { isPending: false, isError: false, data: { recipients: [{ id: "rec-1", kind: "wallet", name: "Alice", destination: "0x1111111111111111111111111111111111111111", detail: "0x1111…1111", verified: true }] } };
    if (queryKey[0] === "transfer-schedules") return { isPending: false, isError: false, data: { schedules: [{ scheduleId: "sched-1", scheduleType: "weekly", destinationKind: "wallet", destinationReference: "0x1111111111111111111111111111111111111111", destinationLabel: "Alice", amount: "10", asset: "USDC", nextRunAt: "2026-09-29T08:00:00.000Z", timeZone: "Europe/Lisbon", status: state.scheduleStatus }] } };
    return { isPending: false, isError: false, data: { occurrences: state.due } };
  }
}));

import { RecipientScheduleWorkspace } from "@/components/recipient-schedule-workspace";

describe("scheduled transfer workspace", () => {
  it("shows due reminders as a review action, not an automatic payment", () => {
    const html = renderToStaticMarkup(React.createElement(RecipientScheduleWorkspace));
    expect(html).toContain("Review transfer");
    expect(html).toContain("10 USDC");
    expect(html).toContain("No money moves until you review and confirm");
    expect(html).toContain("Europe/Lisbon");
  });

  it("shows a paused schedule without offering a due review", () => {
    state.scheduleStatus = "paused";
    state.due = [];
    const html = renderToStaticMarkup(React.createElement(RecipientScheduleWorkspace));
    expect(html).toContain("Resume schedule");
    expect(html).not.toContain("Review transfer");
  });
});
