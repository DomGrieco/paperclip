#!/usr/bin/env node
import http from "node:http";
import net from "node:net";

const DOCKER_SOCKET_PATH = process.env.PAPERCLIP_DOCKER_SOCKET_PATH?.trim() || "/var/run/docker.sock";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

async function readStdinFully() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks);
}

function parseExecEnv() {
  const raw = requiredEnv("PAPERCLIP_AGENT_CONTAINER_EXEC_ENV_JSON");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("PAPERCLIP_AGENT_CONTAINER_EXEC_ENV_JSON must be a JSON object");
  }
  return Object.fromEntries(
    Object.entries(parsed).filter(([key, value]) => typeof key === "string" && typeof value === "string"),
  );
}

function dockerApiJson({ method, path, body }) {
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: DOCKER_SOCKET_PATH,
        path: `/v1.41${path}`,
        method,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
            }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function createDockerExec({ containerId, cmd, env, workdir }) {
  const response = await dockerApiJson({
    method: "POST",
    path: `/containers/${encodeURIComponent(containerId)}/exec`,
    body: {
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      WorkingDir: workdir,
      Env: Object.entries(env).map(([name, value]) => `${name}=${value}`),
      Cmd: cmd,
    },
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`docker exec create failed (${response.statusCode}): ${response.body}`);
  }
  const parsed = JSON.parse(response.body);
  if (!parsed?.Id) throw new Error("docker exec create returned no exec id");
  return parsed.Id;
}

function startDockerExec({ execId, stdin }) {
  const payload = JSON.stringify({ Detach: false, Tty: false });
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(DOCKER_SOCKET_PATH);
    let headerBuffer = Buffer.alloc(0);
    let streamBuffer = Buffer.alloc(0);
    let headersParsed = false;
    let rawStreamMode = false;
    let sentStdin = false;
    let statusCode = 0;
    let errorBody = Buffer.alloc(0);

    const flushFrames = () => {
      while (streamBuffer.length >= 8) {
        const frameSize = streamBuffer.readUInt32BE(4);
        if (streamBuffer.length < 8 + frameSize) return;
        const frameType = streamBuffer[0] === 2 ? "stderr" : "stdout";
        const framePayload = streamBuffer.subarray(8, 8 + frameSize);
        streamBuffer = streamBuffer.subarray(8 + frameSize);
        if (frameType === "stderr") process.stderr.write(framePayload);
        else process.stdout.write(framePayload);
      }
    };

    const maybeSendStdin = () => {
      if (sentStdin) return;
      sentStdin = true;
      if (stdin.length > 0) socket.write(stdin);
      socket.end();
    };

    socket.on("connect", () => {
      const request = [
        `POST /v1.41/exec/${encodeURIComponent(execId)}/start HTTP/1.1`,
        "Host: docker",
        "Connection: Upgrade",
        "Upgrade: tcp",
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(payload)}`,
        "",
        payload,
      ].join("\r\n");
      socket.write(request);
    });

    socket.on("data", (chunk) => {
      const bufferChunk = Buffer.from(chunk);
      if (!headersParsed) {
        headerBuffer = Buffer.concat([headerBuffer, bufferChunk]);
        const headerEnd = headerBuffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const rawHeaders = headerBuffer.subarray(0, headerEnd).toString("utf8");
        const remainder = headerBuffer.subarray(headerEnd + 4);
        headersParsed = true;
        const [statusLine] = rawHeaders.split("\r\n", 1);
        const match = /^HTTP\/1\.1\s+(\d{3})\b/.exec(statusLine ?? "");
        statusCode = match ? Number.parseInt(match[1], 10) : 0;
        if ((statusCode >= 200 && statusCode < 300) || statusCode === 101) {
          rawStreamMode = true;
          if (remainder.length > 0) {
            streamBuffer = Buffer.concat([streamBuffer, remainder]);
            flushFrames();
          }
          maybeSendStdin();
          return;
        }
        errorBody = remainder;
        return;
      }

      if (rawStreamMode) {
        streamBuffer = Buffer.concat([streamBuffer, bufferChunk]);
        flushFrames();
        return;
      }

      errorBody = Buffer.concat([errorBody, bufferChunk]);
    });

    socket.on("end", () => {
      if (!headersParsed) {
        reject(new Error("docker exec start failed: connection ended before response headers"));
        return;
      }
      if (!rawStreamMode) {
        reject(new Error(`docker exec start failed (${statusCode || 500}): ${errorBody.toString("utf8")}`));
        return;
      }
      resolve();
    });

    socket.on("error", reject);
  });
}

async function inspectDockerExec(execId) {
  const response = await dockerApiJson({
    method: "GET",
    path: `/exec/${encodeURIComponent(execId)}/json`,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) return null;
  const parsed = JSON.parse(response.body);
  return typeof parsed?.ExitCode === "number" ? parsed.ExitCode : null;
}

async function main() {
  const containerId = requiredEnv("PAPERCLIP_AGENT_CONTAINER_ID");
  const innerCommand = requiredEnv("PAPERCLIP_AGENT_CONTAINER_COMMAND");
  const workdir = process.env.PAPERCLIP_AGENT_CONTAINER_WORKDIR?.trim() || "/workspace";
  const env = parseExecEnv();
  const stdin = await readStdinFully();
  const execId = await createDockerExec({
    containerId,
    cmd: [innerCommand, ...process.argv.slice(2)],
    env,
    workdir,
  });
  await startDockerExec({ execId, stdin });
  const exitCode = await inspectDockerExec(execId);
  process.exit(typeof exitCode === "number" ? exitCode : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
