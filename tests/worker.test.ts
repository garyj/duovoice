import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../worker";

interface TestEnv {
  OPENAI_API_KEY?: string;
}

function sessionRequest(body: unknown): Request {
  return new Request("https://sther.example/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function handle(request: Request, env: TestEnv = {}): Promise<Response> {
  return worker.fetch(request, env);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("credential Worker", () => {
  it("requires a server-side OpenAI key", async () => {
    const response = await handle(sessionRequest({ target: "pt", transcribe: true }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("OPENAI_API_KEY"),
    });
  });

  it.each([
    [{ target: "es", transcribe: true }, "target must be en or pt"],
    [{ target: "en", transcribe: "yes" }, "transcribe must be a boolean"],
  ])("rejects an invalid request", async (body, message) => {
    const response = await handle(sessionRequest(body), {
      OPENAI_API_KEY: "server-key",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
  });

  it("mints a configured short-lived translation secret", async () => {
    const upstreamPayload = {
      value: "ek_test",
      expires_at: 1_800_000_000,
      session: { expires_at: 1_800_003_600 },
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(upstreamPayload, {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handle(sessionRequest({ target: "pt", transcribe: true }), {
      OPENAI_API_KEY: "server-key",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(upstreamPayload);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/realtime/translations/client_secrets");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer server-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        model: "gpt-realtime-translate",
        audio: {
          input: {
            noise_reduction: { type: "near_field" },
            transcription: { model: "gpt-realtime-whisper" },
          },
          output: { language: "pt" },
        },
      },
    });
  });

  it("does not configure duplicate transcription on the second session", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ value: "ek_test", expires_at: 1_800_000_000 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await handle(sessionRequest({ target: "en", transcribe: false }), {
      OPENAI_API_KEY: "server-key",
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as {
      session: { audio: { input: Record<string, unknown> } };
    };
    expect(body.session.audio.input).not.toHaveProperty("transcription");
  });

  it("turns upstream failures into a concise bridge error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ error: { message: "upstream detail" } }, { status: 429 }),
        ),
    );

    const response = await handle(sessionRequest({ target: "en", transcribe: false }), {
      OPENAI_API_KEY: "server-key",
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI could not create the en session",
      status: 429,
    });
  });
});
