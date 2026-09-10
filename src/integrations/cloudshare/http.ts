import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Socket } from "node:net";
import type { CipherNameAndProtocol, TLSSocket } from "node:tls";

/**
 * Minimal HTTP seam the CloudShare adapter depends on. Both the live `fetch`
 * client and the fixture replay client implement {@link HttpClient}, so the
 * adapter's request/auth/validation code runs identically in either mode —
 * that's the live-vs-fixture toggle requirement, satisfied by substitution
 * rather than branching through the call path.
 */

export interface HttpRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly url: string;
  readonly headers?: Record<string, string>;
  /** Serialised request body, if any. */
  readonly body?: string;
  readonly timeoutMs?: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
  readonly headers?: Record<string, string | string[]>;
  readonly network?: {
    readonly localAddress?: string;
    readonly localFamily?: string;
    readonly localPort?: number;
    readonly remoteAddress?: string;
    readonly remoteFamily?: string;
    readonly remotePort?: number;
    readonly transport?: string;
  };
  readonly tls?: {
    readonly protocol?: string;
    readonly cipher?: CipherNameAndProtocol;
    readonly authorized?: boolean;
    readonly authorizationError?: string | null;
  };
}

export interface HttpClient {
  send(request: HttpRequest): Promise<HttpResponse>;
}

/** A transport failure with the socket evidence available before a response exists. */
export class HttpTransportError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
    readonly network?: HttpResponse["network"],
    readonly tls?: HttpResponse["tls"],
  ) {
    super(message);
    this.name = "HttpTransportError";
  }
}

function readNetwork(socket: Socket | TLSSocket | null | undefined):
  | HttpResponse["network"]
  | undefined {
  if (!socket) {
    return undefined;
  }

  return {
    localAddress: socket.localAddress,
    localFamily: socket.localFamily,
    localPort: socket.localPort,
    remoteAddress: socket.remoteAddress,
    remoteFamily: socket.remoteFamily,
    remotePort: socket.remotePort,
    transport: "encrypted" in socket && socket.encrypted ? "tls" : "tcp",
  };
}

function readTls(socket: Socket | TLSSocket | null | undefined): HttpResponse["tls"] | undefined {
  if (!socket || !("encrypted" in socket) || !socket.encrypted) {
    return undefined;
  }

  return {
    protocol: socket.getProtocol() ?? undefined,
    cipher: socket.getCipher(),
    authorized: socket.authorized,
    authorizationError: socket.authorizationError
      ? String(socket.authorizationError)
      : null,
  };
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined),
  );
}

/** Live HTTP client backed by Node's HTTP/TLS sockets so diagnostics can capture network details. */
export function createFetchHttpClient(): HttpClient {
  return {
    async send(request: HttpRequest): Promise<HttpResponse> {
      const url = new URL(request.url);
      const send = url.protocol === "https:" ? httpsRequest : httpRequest;

      return new Promise<HttpResponse>((resolve, reject) => {
        const req = send(
          url,
          {
            method: request.method,
            headers: request.headers,
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            });
            response.on("end", () => {
              resolve({
                status: response.statusCode ?? 0,
                body: Buffer.concat(chunks).toString("utf8"),
                headers: normalizeHeaders(response.headers),
                network: readNetwork(response.socket),
                tls: readTls(response.socket),
              });
            });
          },
        );

        req.on("error", (error) => reject(new HttpTransportError(
          error.message,
          error,
          readNetwork(req.socket),
          readTls(req.socket),
        )));
        if (request.timeoutMs && request.timeoutMs > 0) req.setTimeout(request.timeoutMs, () => { const error = new Error(`HTTP request timed out after ${request.timeoutMs}ms`); (error as Error & { code?: string }).code = "ETIMEDOUT"; req.destroy(error); });

        if (request.body) {
          req.write(request.body);
        }
        req.end();
      });
    },
  };
}
