import {
  enterExamAttemptRuntime,
  type EnterExamAttemptRuntimeRequest,
  type ExamAttemptRuntimeDeps,
} from "./exam-attempt-runtime";

export type EnterExamDeps = ExamAttemptRuntimeDeps;
export type EnterExamRequest = EnterExamAttemptRuntimeRequest;

export interface EnterExamResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface EnterExamBlockedPageInput {
  readonly examAttemptId: string;
  readonly status: number;
  readonly message: string;
}

const inFlightEnterRequests = new Map<string, Promise<EnterExamResponse>>();

export async function handleEnterExam(
  deps: EnterExamDeps,
  request: EnterExamRequest,
): Promise<EnterExamResponse> {
  const requestKey = buildEnterRequestKey(request);
  const existing = inFlightEnterRequests.get(requestKey);
  if (existing) {
    return existing;
  }

  const pending = handleEnterExamOnce(deps, request).finally(() => {
    if (inFlightEnterRequests.get(requestKey) === pending) {
      inFlightEnterRequests.delete(requestKey);
    }
  });
  inFlightEnterRequests.set(requestKey, pending);
  return pending;
}

async function handleEnterExamOnce(
  deps: EnterExamDeps,
  request: EnterExamRequest,
): Promise<EnterExamResponse> {
  const result = await enterExamAttemptRuntime(deps, request);

  if (result.kind === "redirect") {
    return {
      status: 302,
      headers: {
        location: result.location,
        "cache-control": "no-store",
      },
      body: result.body,
    };
  }

  return textResponse(result.status, result.body.message);
}

function textResponse(status: number, body: string): EnterExamResponse {
  return {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
    body,
  };
}

function buildEnterRequestKey(request: EnterExamRequest): string {
  return `${request.candidateId}:${request.examAttemptId}`;
}

export function buildEnterExamBlockedPage(input: EnterExamBlockedPageInput): string {
  const payload = safeJson({
    type: "certalis:exam-entry-blocked",
    examAttemptId: input.examAttemptId,
    status: input.status,
    message: input.message,
  });
  const message = escapeHtml(input.message);
  const labHref = `/candidate/lab?examAttemptId=${encodeURIComponent(input.examAttemptId)}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Exam Entry Unavailable</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: Arial, sans-serif;
        background: #f7f9fc;
        color: #14213d;
      }
      main {
        width: min(520px, calc(100vw - 32px));
        border: 1px solid #f5c2c7;
        border-radius: 8px;
        background: #fff5f5;
        padding: 24px;
        box-shadow: 0 18px 45px rgba(20, 33, 61, 0.12);
      }
      p.label {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        color: #b42318;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        margin: 0;
        line-height: 1.5;
        color: #334e68;
      }
      a {
        display: inline-block;
        margin-top: 18px;
        color: #0b5d3b;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="label">Exam entry unavailable</p>
      <h1>Return to your exam page</h1>
      <p>${message}</p>
      <a href="${labHref}">Back to exam page</a>
    </main>
    <script>
      (function () {
        var payload = ${payload};
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
          window.setTimeout(function () { window.close(); }, 150);
        }
      }());
    </script>
  </body>
</html>`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
