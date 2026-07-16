import type {
  InstrumentCandidateContract,
  TargetSettingsSnapshotContract,
} from "@portfolio-rebalancer/contracts";

export type EditableAssetClass = "SAFE" | "CORE" | "SATELLITE";
export type CompositionMode = "PRESERVE_CURRENT" | "EQUAL";

export type EditableInstrument = {
  readonly instrumentKey: string;
  readonly label: string;
  readonly description: string;
  readonly isHolding: boolean;
  readonly assetClass: EditableAssetClass | "";
};

export type CompositionModes = Record<EditableAssetClass, CompositionMode>;

export function buildEditableInstruments(
  settings: TargetSettingsSnapshotContract,
): EditableInstrument[] {
  const editable = settings.draftVersion ?? settings.activeVersion;
  const holdingKeys = new Set(settings.holdings.map(({ instrumentKey }) => instrumentKey));
  const result = settings.holdings.map((holding) => ({
    instrumentKey: holding.instrumentKey,
    label: holding.label,
    description: holding.description,
    isHolding: true,
    assetClass: assignedAssetClass(editable, holding.instrumentKey),
  }));

  editable?.allocations.forEach((allocation) => {
    if (!isEditableAssetClass(allocation.assetKey)) return;
    const assetClass = allocation.assetKey;
    allocation.instruments.forEach((instrument) => {
      if (holdingKeys.has(instrument.instrumentKey)) return;
      result.push({
        instrumentKey: instrument.instrumentKey,
        label: instrument.name,
        description: [
          instrument.marketCountry,
          instrument.listingMarket,
          instrument.currency,
          "현재 미보유",
        ]
          .filter(Boolean)
          .join(" · "),
        isHolding: false,
        assetClass,
      });
    });
  });
  return result;
}

export function buildInitialCompositionModes(
  settings: TargetSettingsSnapshotContract,
  instruments: readonly EditableInstrument[],
): CompositionModes {
  const editable = settings.draftVersion ?? settings.activeVersion;
  const modes: CompositionModes = {
    SAFE: storedCompositionMode(editable, "SAFE"),
    CORE: storedCompositionMode(editable, "CORE"),
    SATELLITE: storedCompositionMode(editable, "SATELLITE"),
  };
  instruments.forEach((instrument) => {
    if (!instrument.isHolding && instrument.assetClass !== "") {
      modes[instrument.assetClass] = "EQUAL";
    }
  });
  return modes;
}

export function candidateToEditableInstrument(
  candidate: InstrumentCandidateContract,
  assetClass: EditableAssetClass,
): EditableInstrument {
  return {
    instrumentKey: candidate.instrumentKey,
    label: candidate.name,
    description: [
      candidate.marketCountry,
      candidate.listingMarket,
      candidate.currency,
      "현재 미보유",
    ].join(" · "),
    isHolding: false,
    assetClass,
  };
}

export function isEditableAssetClass(value: string): value is EditableAssetClass {
  return value === "SAFE" || value === "CORE" || value === "SATELLITE";
}

function assignedAssetClass(
  version: TargetSettingsSnapshotContract["draftVersion"],
  instrumentKey: string,
): EditableAssetClass | "" {
  const allocation = version?.allocations.find(
    ({ assetKey, instruments }) =>
      isEditableAssetClass(assetKey) &&
      instruments.some((instrument) => instrument.instrumentKey === instrumentKey),
  );
  return allocation && isEditableAssetClass(allocation.assetKey) ? allocation.assetKey : "";
}

function storedCompositionMode(
  version: TargetSettingsSnapshotContract["draftVersion"],
  assetClass: EditableAssetClass,
): CompositionMode {
  const policy = version?.allocations.find(
    ({ assetKey }) => assetKey === assetClass,
  )?.compositionPolicy;
  return policy?.mode === "EQUAL" ? "EQUAL" : "PRESERVE_CURRENT";
}
