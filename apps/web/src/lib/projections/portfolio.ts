import type { PortfolioSourceAdapter, PositionObservation } from "@/lib/providers/contracts";

export type PortfolioProjection = {
  schemaVersion: 1;
  subjectReference: string;
  rebuiltAt: string;
  disposable: true;
  authoritativeSources: string[];
  positions: PositionObservation[];
};

export async function rebuildPortfolioProjection(
  subjectReference: string,
  adapters: PortfolioSourceAdapter[],
): Promise<PortfolioProjection> {
  const positionSets = await Promise.all(
    adapters.map((adapter) => adapter.listPositions(subjectReference)),
  );

  return {
    schemaVersion: 1,
    subjectReference,
    rebuiltAt: new Date().toISOString(),
    disposable: true,
    authoritativeSources: adapters.map((adapter) => adapter.name),
    positions: positionSets.flat(),
  };
}

