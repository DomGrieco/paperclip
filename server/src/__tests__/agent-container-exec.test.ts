import http from "node:http";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

type CapturedRequest = {
  method: string;
  url: string;
  body: Buffer;
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

describe("agent-container-exec wrapper", () => {
  it("closes docker exec stdin after forwarding the prompt payload", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-agent-container-exec-"));
    tempPaths.push(root);
    const socketPath = path.join(root, "docker.sock");
    const scriptPath = path.resolve("/Users/eru/Documents/GitHub/paperclip/server/scripts/agent-container-exec.js");
    const prompt = "Investigate the websocket failure.\n";
    const requests: CapturedRequest[] = [];

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        requests.push({
          method: req.method ?? "GET",
          url: req.url ?? "/",
          body,
        });

        if (req.url === "/v1.41/containers/container-123/exec") {
          res.writeHead(201, { "content-type": "application/json" });
          res.end(JSON.stringify({ Id: "exec-123" }));
          return;
        }

        if (req.url === "/v1.41/exec/exec-123/start") {
          res.writeHead(200, { "content-type": "application/vnd.docker.raw-stream" });
          res.end(dockerFrame("stdout", "container command finished\n"));
          return;
        }

        if (req.url === "/v1.41/exec/exec-123/json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ExitCode: 0 }));
          return;
        }

        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
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

    const startRequest = requests.find((request) => request.url === "/v1.41/exec/exec-123/start");
    expect(startRequest).toBeDefined();
    const startBody = startRequest?.body ?? Buffer.alloc(0);
    const payloadPrefix = Buffer.from('{"Detach":false,"Tty":false}', "utf8");
    expect(startBody.subarray(0, payloadPrefix.length).toString("utf8")).toBe(payloadPrefix.toString("utf8"));
    expect(startBody.subarray(payloadPrefix.length).toString("utf8")).toBe(prompt);
  });
});
