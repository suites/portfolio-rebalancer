import { describe, expect, it, vi } from "vitest";

import { createTimedFetch } from "./transport";

describe("createTimedFetch", () => {
  it("시간이 초과된 요청을 재제출 경고가 있는 안전 오류로 변환한다", async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted")), {
          once: true,
        });
      });
    });
    const timedFetch = createTimedFetch(fetchMock, 5);

    await expect(
      timedFetch("https://openapi.tossinvest.com/api/v1/accounts"),
    ).rejects.toMatchObject({
      code: "TOSS_API_TIMEOUT",
    });
  });
});
