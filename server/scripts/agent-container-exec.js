#!/usr/bin/env node
import http from "node:http";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
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
        socketPath: "/var/run/docker.sock",
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

function startDockerExec({ execId }) {
  const payload = JSON.stringify({ Detach: false, Tty: false });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: "/var/run/docker.sock",
        path: `/v1.41/exec/${encodeURIComponent(execId)}/start`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => reject(new Error(`docker exec start failed (${res.statusCode}): ${Buffer.concat(chunks).toString("utf8")}`)));
          return;
        }

        let buffer = Buffer.alloc(0);
        res.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
          while (buffer.length >= 8) {
            const frameSize = buffer.readUInt32BE(4);
            if (buffer.length < 8 + frameSize) return;
            const frameType = buffer[0] === 2 ? "stderr" : "stdout";
            const payload = buffer.subarray(8, 8 + frameSize);
            buffer = buffer.subarray(8 + frameSize);
            if (frameType === "stderr") process.stderr.write(payload);
            else process.stdout.write(payload);
          }
        });
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
    req.write(payload);
    process.stdin.on("data", (chunk) => req.write(chunk));
    process.stdin.on("end", () => req.end());
    process.stdin.resume();
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
  const execId = await createDockerExec({
    containerId,
    cmd: [innerCommand, ...process.argv.slice(2)],
    env,
    workdir,
  });
  await startDockerExec({ execId });
  const exitCode = await inspectDockerExec(execId);
  process.exit(typeof exitCode === "number" ? exitCode : 1);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
