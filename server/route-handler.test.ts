import { describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("@/server/app", () => ({
  default: {
    fetch: fetchMock,
  },
}));

const { handleAppRoute } = await import("./route-handler");

describe("handleAppRoute", () => {
  it("encaminha a requisicao para o app Hono montado", async () => {
    const request = new Request("https://example.com/v1/models");
    const response = new Response("ok", { status: 200 });
    fetchMock.mockResolvedValueOnce(response);

    await expect(handleAppRoute(request)).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledWith(request);
  });
});
