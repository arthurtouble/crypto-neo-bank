"use client";

import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { exampleOverview } from "@/lib/example/data";
import type { Overview } from "@/lib/overview/read";
import { useApi } from "./api";
import type { ActionView } from "./use-action";

/**
 * Data for a screen. Signed in, it comes from the API. Signed out, it is the
 * labelled example in the same shape, and `isExample` is true: the screen must
 * say so. Screens never branch on sign-in state for their layout.
 */
export type ScreenQuery<T> = { data: T | undefined; isExample: boolean; isPending: boolean; error: Error | null; refetch: () => void };

function useScreenQuery<T>(key: string, path: string, example: T | null, options: { refetchInterval?: number } = {}): ScreenQuery<T> {
  const { ready, authenticated, user } = useAuth();
  const api = useApi();
  const live = ready && authenticated;
  const query = useQuery({ queryKey: [key, user?.id], queryFn: () => api<T>(path), enabled: live, refetchInterval: options.refetchInterval });
  if (!live && example !== null) return { data: example, isExample: true, isPending: !ready, error: null, refetch: () => undefined };
  return { data: query.data, isExample: false, isPending: query.isPending, error: query.error, refetch: () => void query.refetch() };
}

export const useOverview = () => useScreenQuery<Overview>("overview", "/api/overview", exampleOverview, { refetchInterval: 30_000 });
export const useActionDetail = (id: string) => useScreenQuery<{ action: ActionView; events: Array<{ type: string; evidence: Record<string, unknown>; occurredAt: string }> }>(
  `action:${id}`, `/api/actions/${encodeURIComponent(id)}`, null);

