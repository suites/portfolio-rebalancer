import { AsyncLocalStorage } from "node:async_hooks";

import {
  TOSS_OPERATIONS,
  type TossOperationId,
  type TossResponseMetadata,
} from "@portfolio-rebalancer/broker-toss";

export interface TossRequestAuditWorkflow {
  readonly workflowType: string;
  readonly correlationId: string;
}

export interface ResolvedTossRequestAudit {
  readonly workflowType: string;
  readonly correlationId: string;
  readonly collectionRunId: string | null;
  readonly ordinal: number;
  readonly redactedRequestSummary: {
    readonly method: string;
    readonly path: string;
  };
}

interface TossRequestAuditStore {
  readonly workflowType: string;
  readonly correlationId: string;
  collectionRunId: string | null;
  readonly ordinalByRequest: Map<TossOperationId, Map<number, number>>;
  readonly nextOrdinalByOperation: Map<TossOperationId, number>;
}

const operationSummary = new Map<
  TossOperationId,
  { readonly method: string; readonly path: string }
>(TOSS_OPERATIONS.map(({ operationId, method, path }) => [operationId, { method, path }]));

export class TossRequestAuditContext {
  readonly #storage = new AsyncLocalStorage<TossRequestAuditStore>();

  run<T>(workflow: TossRequestAuditWorkflow, callback: () => T): T {
    if (workflow.workflowType.trim().length === 0 || workflow.correlationId.trim().length === 0) {
      throw new Error("토스증권 요청 감사 workflow 식별자가 비어 있습니다.");
    }
    return this.#storage.run(
      {
        workflowType: workflow.workflowType,
        correlationId: workflow.correlationId,
        collectionRunId: null,
        ordinalByRequest: new Map(),
        nextOrdinalByOperation: new Map(),
      },
      callback,
    );
  }

  attachCollectionRunId(collectionRunId: string): void {
    const store = this.#requiredStore();
    if (collectionRunId.trim().length === 0) {
      throw new Error("토스증권 요청 감사 collectionRunId가 비어 있습니다.");
    }
    if (store.collectionRunId !== null && store.collectionRunId !== collectionRunId) {
      throw new Error("토스증권 요청 감사 collectionRunId를 다른 실행으로 변경할 수 없습니다.");
    }
    store.collectionRunId = collectionRunId;
  }

  resolve(metadata: TossResponseMetadata): ResolvedTossRequestAudit {
    const store = this.#requiredStore();
    if (!Number.isSafeInteger(metadata.requestSequence) || metadata.requestSequence < 0) {
      throw new Error("토스증권 requestSequence가 올바르지 않습니다.");
    }

    let requestOrdinals = store.ordinalByRequest.get(metadata.operationId);
    if (!requestOrdinals) {
      requestOrdinals = new Map();
      store.ordinalByRequest.set(metadata.operationId, requestOrdinals);
    }
    let ordinal = requestOrdinals.get(metadata.requestSequence);
    if (ordinal === undefined) {
      ordinal = store.nextOrdinalByOperation.get(metadata.operationId) ?? 0;
      requestOrdinals.set(metadata.requestSequence, ordinal);
      store.nextOrdinalByOperation.set(metadata.operationId, ordinal + 1);
    }

    const summary = operationSummary.get(metadata.operationId);
    if (!summary) {
      throw new Error(`토스증권 operation manifest가 없습니다: ${metadata.operationId}`);
    }
    return {
      workflowType: store.workflowType,
      correlationId: store.correlationId,
      collectionRunId: store.collectionRunId,
      ordinal,
      redactedRequestSummary: summary,
    };
  }

  currentWorkflow():
    (TossRequestAuditWorkflow & { readonly collectionRunId: string | null }) | null {
    const store = this.#storage.getStore();
    return store
      ? {
          workflowType: store.workflowType,
          correlationId: store.correlationId,
          collectionRunId: store.collectionRunId,
        }
      : null;
  }

  #requiredStore(): TossRequestAuditStore {
    const store = this.#storage.getStore();
    if (!store) {
      throw new Error("토스증권 요청 감사 workflow context가 없습니다.");
    }
    return store;
  }
}
