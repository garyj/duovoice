import { SESSION_CONFIG } from "./session-config";

interface Env {
  OPENAI_API_KEY?: string;
}

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

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

  if (!request.headers.get("Content-Type")?.startsWith("application/sdp")) {
    return jsonResponse({ error: "Content-Type must be application/sdp" }, 415);
  }

  const offer = await request.text();
  if (!offer.trim()) {
    return jsonResponse({ error: "The SDP offer must not be empty" }, 400);
  }

  const body = new FormData();
  body.set("sdp", offer);
  body.set("session", JSON.stringify(SESSION_CONFIG));

  const response = await fetch(OPENAI_REALTIME_CALLS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body,
  });

  if (!response.ok) {
    const details = await response.text();
    let message = "OpenAI could not create the interpreter session";
    try {
      const payload = JSON.parse(details) as { error?: { message?: unknown } };
      if (typeof payload.error?.message === "string") {
        message = payload.error.message;
      }
    } catch {
      if (details.trim()) {
        message = details.trim();
      }
    }
    return jsonResponse(
      {
        error: message,
        status: response.status,
      },
      502,
    );
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": response.headers.get("Content-Type") ?? "application/sdp",
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
