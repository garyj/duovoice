import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "../worker";
import { SESSION_CONFIG } from "../worker/session-config";

interface TestEnv {
  OPENAI_API_KEY?: string;
}

function sessionRequest(
  body = "v=0\r\no=browser 1 1 IN IP4 127.0.0.1",
  contentType = "application/sdp",
): Request {
  return new Request("https://sther.example/api/session", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
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
    const response = await handle(sessionRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("OPENAI_API_KEY"),
    });
  });

  it("requires a non-empty SDP offer", async () => {
    const invalidType = await handle(sessionRequest("offer", "application/json"), {
      OPENAI_API_KEY: "server-key",
    });
    const emptyOffer = await handle(sessionRequest("   "), {
      OPENAI_API_KEY: "server-key",
    });

    expect(invalidType.status).toBe(415);
    expect(emptyOffer.status).toBe(400);
  });

  it("forwards SDP and the single interpreter session configuration", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("answer-sdp", {
        status: 201,
        headers: { "Content-Type": "application/sdp" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handle(sessionRequest("offer-sdp"), {
      OPENAI_API_KEY: "server-key",
    });

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("answer-sdp");
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer server-key" });
    expect(init?.body).toBeInstanceOf(FormData);

    const form = init?.body as FormData;
    const sdp = form.get("sdp");
    const session = form.get("session");
    expect(sdp).toBe("offer-sdp");
    expect(session).toBe(JSON.stringify(SESSION_CONFIG));
  });

  it("uses the Playground-style interpreter behavior", () => {
    expect(SESSION_CONFIG).toMatchObject({
      type: "realtime",
      model: "gpt-realtime-2.1",
      output_modalities: ["audio"],
      audio: {
        input: {
          transcription: { model: "gpt-realtime-whisper" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "auto",
            create_response: false,
            interrupt_response: false,
          },
        },
        output: { voice: "marin" },
      },
      reasoning: { effort: "low" },
    });
    expect(SESSION_CONFIG.instructions).toContain(
      "English input must become natural Brazilian Portuguese",
    );
    expect(SESSION_CONFIG.instructions).toContain(
      "Brazilian Portuguese input must become natural English",
    );
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

    const response = await handle(sessionRequest(), {
      OPENAI_API_KEY: "server-key",
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "upstream detail",
      status: 429,
    });
  });
});
