import { Inject, Injectable } from "@nestjs/common";

import { ENGINE_CONFIG } from "../../../../config/engine-config.token";
import type { EngineConfig } from "../../../../config/engine.config";
import { CollectionError } from "../../domain/collection.error";
import { createTossReadSource, type TossReadSource } from "./toss-read-source.adapter";

export interface TossRuntime {
  readonly source: TossReadSource;
  readonly accountReferenceKey: string;
}

@Injectable()
export class TossRuntimeService {
  private runtime: TossRuntime | undefined;

  constructor(@Inject(ENGINE_CONFIG) private readonly config: EngineConfig) {}

  get(): TossRuntime {
    this.runtime ??= this.createRuntime();
    return this.runtime;
  }

  private createRuntime(): TossRuntime {
    if (!this.config.TOSSINVEST_CLIENT_ID || !this.config.TOSSINVEST_CLIENT_SECRET) {
      throw new CollectionError(
        "CREDENTIALS_MISSING",
        "토스증권 API 자격증명이 설정되지 않았습니다.",
        "engine 프로젝트의 환경변수에 토스증권 자격증명을 설정하세요.",
      );
    }
    return {
      source: createTossReadSource({
        clientId: this.config.TOSSINVEST_CLIENT_ID,
        clientSecret: this.config.TOSSINVEST_CLIENT_SECRET,
      }),
      accountReferenceKey:
        this.config.ACCOUNT_REFERENCE_KEY ?? this.config.TOSSINVEST_CLIENT_SECRET,
    };
  }
}
