import { describe, expect, it, vi } from "vitest";

import { TossTokenProvider } from "./token-provider";

describe("TossTokenProvider", () => {
  it("비어 있는 자격증명을 네트워크 요청 전에 거부한다", () => {
    expect(() => new TossTokenProvider({ clientId: "", clientSecret: "" })).toThrow(
      "자격증명이 설정되지 않았습니다",
    );
  });

  it("동시 요청에서 토큰을 한 번만 발급한다", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "synthetic-token", token_type: "Bearer", expires_in: 3600 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const provider = new TossTokenProvider(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      { fetch: fetchMock, now: () => 1_000 },
    );

    const tokens = await Promise.all([provider.getAccessToken(), provider.getAccessToken()]);

    expect(tokens).toEqual(["synthetic-token", "synthetic-token"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInput = fetchMock.mock.calls[0]?.[0];
    expect(requestInput).toBeInstanceOf(URL);
    if (!(requestInput instanceof URL)) throw new Error("토큰 요청 주소가 URL이 아닙니다.");
    expect(requestInput.href).toBe("https://openapi.tossinvest.com/oauth2/token");
  });

  it("오류에 자격증명을 포함하지 않는다", async () => {
    const provider = new TossTokenProvider(
      { clientId: "synthetic-client", clientSecret: "never-log-this-secret" },
      {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: "invalid_client",
              error_description: "synthetic-client / never-log-this-secret 자격증명을 확인하세요.",
            }),
            {
              status: 401,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
      },
    );

    const error: unknown = await provider.getAccessToken().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("인증 오류가 Error가 아닙니다.");
    expect(error.message).not.toContain("never-log-this-secret");
    expect(error.message).not.toContain("synthetic-client");
    expect(error.message).toContain("[REDACTED]");
  });

  it("JSON이 아닌 오류 응답도 안전한 인증 오류로 변환한다", async () => {
    const provider = new TossTokenProvider(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      {
        fetch: vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("upstream unavailable", { status: 502 })),
      },
    );

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      code: "TOSS_AUTHENTICATION_FAILED",
      httpStatus: 502,
    });
  });

  it.each([
    { access_token: "", token_type: "Bearer", expires_in: 3600 },
    { access_token: "token", token_type: "bearer", expires_in: 3600 },
    { access_token: "token", token_type: "Bearer", expires_in: 0 },
    { access_token: "token", token_type: "Bearer", expires_in: 1.5 },
  ])("비정상 토큰 응답을 거부한다: %o", async (payload) => {
    const provider = new TossTokenProvider(
      { clientId: "synthetic-client", clientSecret: "synthetic-secret" },
      {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      },
    );

    await expect(provider.getAccessToken()).rejects.toThrow("토큰 응답 형식");
  });
});
