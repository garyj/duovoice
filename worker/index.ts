interface Env {
  OPENAI_API_KEY?: string;
}

interface SessionRequest {
  target?: unknown;
  transcribe?: unknown;
}

const OPENAI_CLIENT_SECRETS_URL =
  "https://api.openai.com/v1/realtime/translations/client_secrets";

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function createSession(request: Request, env: Env): Promise<Response> {
  if (!env.OPENAI_API_KEY) {
    return jsonResponse(
      {
        error:
          "OPENAI_API_KEY is not configured on the credential bridge. Add it to .dev.vars for local use or set the Worker secret.",
      },
      503,
    );
  }

  let body: SessionRequest;
  try {
    body = (await request.json()) as SessionRequest;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON" }, 400);
  }

  if (body.target !== "en" && body.target !== "pt") {
    return jsonResponse({ error: "target must be en or pt" }, 400);
  }
  if (typeof body.transcribe !== "boolean") {
    return jsonResponse({ error: "transcribe must be a boolean" }, 400);
  }

  const transcription = body.transcribe
    ? { transcription: { model: "gpt-realtime-whisper" } }
    : {};
  const response = await fetch(OPENAI_CLIENT_SECRETS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        model: "gpt-realtime-translate",
        audio: {
          input: {
            noise_reduction: { type: "near_field" },
            ...transcription,
          },
          output: { language: body.target },
        },
      },
    }),
  });

  if (!response.ok) {
    return jsonResponse(
      {
        error: `OpenAI could not create the ${body.target} session`,
        status: response.status,
      },
      502,
    );
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/session") {
      return createSession(request, env);
    }
    return jsonResponse({ error: "Not found" }, 404);
  },
};
