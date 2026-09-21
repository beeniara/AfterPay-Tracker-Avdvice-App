// Sends a Wake-on-LAN magic packet when the backend asks for one.
//
// Runs with network_mode: host so the broadcast leaves the machine's real LAN
// interface (a Docker bridge would swallow it). There is deliberately no
// listening port: the backend drops /spool/wake.req and we answer in
// /spool/wake.res. The MAC and broadcast address come from THIS container's
// env only, so a request can never make us wake anything else.
//
// It also handles remote shutdown: the backend drops /spool/shutdown.req and we
// run ssh to the PC. The host/user/key come from THIS container's env and the
// key is locked on the PC to a single forced command (shutdown), so a request
// can never make us run anything else.
const dgram = require("dgram");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const SPOOL = process.env.WOL_SPOOL_DIR || "/spool";
const MAC = (process.env.PC_MAC_ADDRESS || "").replace(/[:-]/g, "");
const BROADCAST = process.env.WOL_BROADCAST || "192.168.1.255";
const REQ = path.join(SPOOL, "wake.req");
const RES = path.join(SPOOL, "wake.res");
const SD_REQ = path.join(SPOOL, "shutdown.req");
const SD_RES = path.join(SPOOL, "shutdown.res");
const SSH_HOST = process.env.PC_SSH_HOST || "";
const SSH_USER = process.env.PC_SSH_USER || "";
const SSH_DIR = process.env.PC_SSH_DIR || "/ssh";
const BEAT = path.join(SPOOL, "wol.heartbeat");

if (!/^[0-9a-fA-F]{12}$/.test(MAC)) {
  console.error("PC_MAC_ADDRESS is missing or invalid; wol sidecar has nothing to do.");
  process.exit(1);
}

const macBytes = Buffer.from(MAC, "hex");
const packet = Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => macBytes)]);

function send() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 9, BROADCAST, (err) => {
        socket.close();
        err ? reject(err) : resolve();
      });
    });
  });
}

function shutdown() {
  return new Promise((resolve, reject) => {
    if (!SSH_HOST || !SSH_USER) return reject(new Error("PC_SSH_HOST / PC_SSH_USER not set"));
    const args = [
      "-i", path.join(SSH_DIR, "id_ed25519"),
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      "-o", "ConnectTimeout=8",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", `UserKnownHostsFile=${path.join(SSH_DIR, "known_hosts")}`,
      `${SSH_USER}@${SSH_HOST}`,
      // Ignored by a locked key (its forced command wins); harmless otherwise.
      "shutdown /s /t 5",
    ];
    execFile("ssh", args, { timeout: 15000 }, (err, _out, stderr) =>
      err ? reject(new Error((stderr || err.message).trim().split("\n").pop())) : resolve(),
    );
  });
}

let shuttingDown = false;
async function handleShutdown() {
  if (shuttingDown || !fs.existsSync(SD_REQ)) return;
  shuttingDown = true;
  fs.rmSync(SD_REQ, { force: true });
  let reply = "ok";
  try {
    await shutdown();
    console.log(new Date().toISOString(), "shutdown sent to", SSH_HOST);
  } catch (err) {
    reply = "error: " + err.message;
    console.error(new Date().toISOString(), "shutdown failed:", err.message);
  }
  try {
    fs.writeFileSync(SD_RES, reply, { mode: 0o666 });
    fs.chmodSync(SD_RES, 0o666);
  } finally {
    shuttingDown = false;
  }
}

async function tick() {
  try {
    fs.writeFileSync(BEAT, String(Date.now()));
    void handleShutdown();
    if (!fs.existsSync(REQ)) return;
    fs.rmSync(REQ, { force: true });
    let reply = "ok";
    try {
      await send();
      console.log(new Date().toISOString(), "magic packet sent to", BROADCAST);
    } catch (err) {
      reply = "error: " + err.message;
      console.error(new Date().toISOString(), "send failed:", err.message);
    }
    fs.writeFileSync(RES, reply, { mode: 0o666 });
    fs.chmodSync(RES, 0o666);
  } catch (err) {
    console.error("tick failed:", err.message);
  }
}

setInterval(tick, 500);
console.log(`wol sidecar ready: MAC ${MAC.match(/../g).join(":")} via ${BROADCAST}`);
