// A render semaphore shared by every lab process on the machine. Each check
// starts its own static server and Chromium, and more than a few at once time
// out, so a check takes one of SLOTS lock files before it renders and waits when
// all are taken. A slot is free when its owner process is gone or its file is
// older than STALE_MS. The wait ends with a LabError that says the lab is busy.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LabError, ROOT } from "./common.mjs";

export const SLOT_DIR = process.env.LAB_SLOT_DIR || path.join(ROOT, "output", "primitives", ".render-slots");
export const SLOTS = Number(process.env.LAB_SLOTS) || 5;
export const STALE_MS = Number(process.env.LAB_SLOT_STALE_MS) || 3 * 60 * 1000;
export const WAIT_MS = Number(process.env.LAB_SLOT_WAIT_MS) || 6 * 60 * 1000;
const POLL_MS = 250;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const slotFile = (i) => path.join(SLOT_DIR, `slot-${i}.lock`);

function readOwner(file) {
  try {
    return { ...JSON.parse(fs.readFileSync(file, "utf8")), mtime: fs.statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

// A slot whose file cannot be read yet (its owner is mid-write) counts as taken
// until it is older than STALE_MS.
function isStale(file, now) {
  const owner = readOwner(file);
  if (!owner) {
    try {
      return now - fs.statSync(file).mtimeMs > STALE_MS;
    } catch {
      return false;
    }
  }
  return now - owner.mtime > STALE_MS || !(Number.isInteger(owner.pid) && alive(owner.pid));
}

function tryTake(i, token) {
  const file = slotFile(i);
  try {
    const fd = fs.openSync(file, "wx");
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }));
    fs.closeSync(fd);
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if (!isStale(file, Date.now())) return false;
  // Two waiters may find the same stale file; rename lets only one remove it.
  try {
    fs.renameSync(file, `${file}.${token}.stale`);
    fs.rmSync(`${file}.${token}.stale`, { force: true });
  } catch {
    return false;
  }
  return false;
}

export async function acquireSlot({ waitMs = WAIT_MS, onWait } = {}) {
  fs.mkdirSync(SLOT_DIR, { recursive: true });
  const token = crypto.randomBytes(6).toString("hex");
  const started = Date.now();
  let told = false;
  for (;;) {
    for (let i = 0; i < SLOTS; i += 1) {
      if (!tryTake(i, token)) continue;
      const file = slotFile(i);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        process.off("exit", release);
        // Remove the file only while it is still ours: a stale one may have been replaced.
        if (readOwner(file)?.token === token) fs.rmSync(file, { force: true });
      };
      process.on("exit", release);
      return { slot: i, release, waitedMs: Date.now() - started };
    }
    if (Date.now() - started > waitMs) {
      throw new LabError(`Стенд проверки перегружен: за ${Math.round(waitMs / 60000)} мин не освободилось место для отрисовки (занято ${SLOTS} из ${SLOTS}). Это сбой стенда, не вашего ответа, и попытка не засчитана. Подождите минуту и запустите ту же команду ещё раз.`);
    }
    if (!told && Date.now() - started > 2000) {
      told = true;
      onWait?.();
    }
    await sleep(POLL_MS + Math.floor(Math.random() * 250));
  }
}

export async function withSlot(fn, options) {
  const held = await acquireSlot(options);
  try {
    return await fn(held);
  } finally {
    held.release();
  }
}
