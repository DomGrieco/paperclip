import net from "node:net";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

type RequestRecord = {
  method: string;
  path: string;
  body: Buffer;
  hijackedStdin?: Buffer;
};

const tempPaths: string[] = [];

afterEach(async () => {
  while (tempPaths.length > 0) {
    const target = tempPaths.pop();
    if (!target) continue;
    await fs.rm(target, { recursive: true, force: true });
  }
});

function dockerFrame(stream: "stdout" | "stderr", text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.alloc(8);
  header[0] = stream === "stderr" ? 2 : 1;
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function tryConsumeHttpRequest(buffer: Buffer):
  | { request: RequestRecord; remainder: Buffer }
  | null {
  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return null;
  const rawHeaders = buffer.subarray(0, headerEnd).toString("utf8");
  const lines = rawHeaders.split("\r\n");
  const [requestLine, ...headerLines] = lines;
  const requestMatch = /^(\S+)\s+(\S+)\s+HTTP\/1\.1$/.exec(requestLine ?? "");
  if (!requestMatch) throw new Error(`Malformed request line: ${requestLine ?? "<empty>"}`);
  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  const contentLength = Number.parseInt(headers.get("content-length") ?? "0", 10) || 0;
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd) return null;
  return {
    request: {
      method: requestMatch[1],
      path: requestMatch[2],
      body: buffer.subarray(bodyStart, bodyEnd),
    },
    remainder: buffer.subarray(bodyEnd),
  };
}

describe("agent-container-exec wrapper", () => {
  it("sends only JSON in exec start body and forwards prompt over the hijacked stream", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-agent-container-exec-"));
    tempPaths.push(root);
    const socketPath = path.join(root, "docker.sock");
    const scriptPath = path.resolve("/Users/eru/Documents/GitHub/paperclip/server/scripts/agent-container-exec.js");
    const prompt = "Investigate the websocket failure.\n";
    const requests: RequestRecord[] = [];

    const server = net.createServer((socket) => {
      let buffer = Buffer.alloc(0);
      let hijackRequest: RequestRecord | null = null;

      socket.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

        if (hijackRequest) {
          hijackRequest.hijackedStdin = Buffer.concat([
            hijackRequest.hijackedStdin ?? Buffer.alloc(0),
            buffer,
          ]);
          buffer = Buffer.alloc(0);
          return;
        }

        while (true) {
          const parsed = tryConsumeHttpRequest(buffer);
          if (!parsed) return;
          buffer = parsed.remainder;
          requests.push(parsed.request);

          if (parsed.request.path === "/v1.41/containers/container-123/exec") {
            socket.write(
              [
                "HTTP/1.1 201 Created",
                "Content-Type: application/json",
                `Content-Length: ${Buffer.byteLength('{"Id":"exec-123"}')}`,
                "",
                '{"Id":"exec-123"}',
              ].join("\r\n"),
            );
            continue;
          }

          if (parsed.request.path === "/v1.41/exec/exec-123/start") {
            hijackRequest = parsed.request;
            socket.write(
              [
                "HTTP/1.1 101 UPGRADED",
                "Connection: Upgrade",
                "Upgrade: tcp",
                "Content-Type: application/vnd.docker.raw-stream",
                "",
                "",
              ].join("\r\n"),
            );
            socket.write(dockerFrame("stdout", "container command finished\n"));
            return;
          }

          if (parsed.request.path === "/v1.41/exec/exec-123/json") {
            socket.write(
              [
                "HTTP/1.1 200 OK",
                "Content-Type: application/json",
                `Content-Length: ${Buffer.byteLength('{"ExitCode":0}')}`,
                "",
                '{"ExitCode":0}',
              ].join("\r\n"),
            );
            continue;
          }

          socket.write(
            [
              "HTTP/1.1 404 Not Found",
              "Content-Type: application/json",
              `Content-Length: ${Buffer.byteLength('{"error":"not found"}')}`,
              "",
              '{"error":"not found"}',
            ].join("\r\n"),
          );
          return;
        }
      });
    });

    server.listen(socketPath);
    await once(server, "listening");

    const child = spawn(process.execPath, [scriptPath, "exec", "--json", "-"], {
      cwd: "/Users/eru/Documents/GitHub/paperclip/server",
      env: {
        ...process.env,
        PAPERCLIP_DOCKER_SOCKET_PATH: socketPath,
        PAPERCLIP_AGENT_CONTAINER_ID: "container-123",
        PAPERCLIP_AGENT_CONTAINER_COMMAND: "/paperclip/runtime/codex-managed/bin/codex",
        PAPERCLIP_AGENT_CONTAINER_WORKDIR: "/workspace",
        PAPERCLIP_AGENT_CONTAINER_EXEC_ENV_JSON: JSON.stringify({ HOME: "/home/codex/.codex" }),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.end(prompt, "utf8");

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    const [exitCode] = (await once(child, "close")) as [number | null];
    server.close();
    await once(server, "close");

    expect(exitCode).toBe(0);
    expect(Buffer.concat(stderrChunks).toString("utf8")).toBe("");
    expect(Buffer.concat(stdoutChunks).toString("utf8")).toContain("container command finished");

    const startRequest = requests.find((request) => request.path === "/v1.41/exec/exec-123/start");
    expect(startRequest).toBeDefined();
    expect(startRequest?.body.toString("utf8")).toBe('{"Detach":false,"Tty":false}');
    expect(startRequest?.hijackedStdin?.toString("utf8")).toBe(prompt);
  });
});
