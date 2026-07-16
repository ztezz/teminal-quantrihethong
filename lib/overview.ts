import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SQLITE_EXTENSIONS = new Set(['.sqlite', '.sqlite3', '.db']);
const MAX_SCAN_ENTRIES = 20_000;

export interface HostMetrics {
  cpu: number;
  memory: { usedMB: number; totalMB: number; percent: number };
  disk: { usedGB: number; totalGB: number; percent: number };
  loadAverage: number[];
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    for (const value of Object.values(cpu.times)) total += value;
  }
  return { idle, total };
}

// Global cached CPU usage calculated in background interval
let cachedCpu = 0;
let lastCpuTimes = cpuTimes();

setInterval(() => {
  const currentTimes = cpuTimes();
  const idleDiff = currentTimes.idle - lastCpuTimes.idle;
  const totalDiff = currentTimes.total - lastCpuTimes.total;
  if (totalDiff > 0) {
    cachedCpu = Math.round((1 - idleDiff / totalDiff) * 100);
  }
  lastCpuTimes = currentTimes;
}, 3000).unref();

export async function collectHostMetrics(): Promise<HostMetrics> {
  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  const diskRoot = path.parse(process.cwd()).root;
  const disk = await fs.promises.statfs(diskRoot);
  const diskTotal = Number(disk.blocks) * Number(disk.bsize);
  const diskUsed = diskTotal - Number(disk.bavail) * Number(disk.bsize);
  return {
    cpu: cachedCpu,
    memory: {
      usedMB: Math.round(usedMemory / 1024 / 1024),
      totalMB: Math.round(totalMemory / 1024 / 1024),
      percent: totalMemory ? Math.round(usedMemory / totalMemory * 100) : 0,
    },
    disk: {
      usedGB: Math.round(diskUsed / 1024 / 1024 / 1024 * 10) / 10,
      totalGB: Math.round(diskTotal / 1024 / 1024 / 1024 * 10) / 10,
      percent: diskTotal ? Math.round(diskUsed / diskTotal * 100) : 0,
    },
    loadAverage: os.loadavg().map(value => Math.round(value * 100) / 100),
  };
}

export async function collectSystemSummary() {
  if (process.platform === 'win32') {
    return {
      services: { supported: false, total: null, active: null, failed: null },
      processes: { supported: false, total: null },
    };
  }
  const [serviceResult, processResult] = await Promise.allSettled([
    execFileAsync('systemctl', ['list-units', '--type=service', '--all', '--no-legend', '--no-pager', '--plain'], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }),
    execFileAsync('ps', ['-e', '-o', 'pid='], { timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }),
  ]);
  const serviceLines = serviceResult.status === 'fulfilled' ? serviceResult.value.stdout.split(/\r?\n/).filter(Boolean) : [];
  const processLines = processResult.status === 'fulfilled' ? processResult.value.stdout.split(/\r?\n/).filter(Boolean) : [];
  return {
    services: {
      supported: serviceResult.status === 'fulfilled',
      total: serviceResult.status === 'fulfilled' ? serviceLines.length : null,
      active: serviceResult.status === 'fulfilled' ? serviceLines.filter(line => /^\s*(?:[●*]\s*)?\S+\s+\S+\s+active\s+/.test(line)).length : null,
      failed: serviceResult.status === 'fulfilled' ? serviceLines.filter(line => /^\s*(?:[●*]\s*)?\S+\s+\S+\s+failed\s+/.test(line)).length : null,
    },
    processes: { supported: processResult.status === 'fulfilled', total: processResult.status === 'fulfilled' ? processLines.length : null },
  };
}

export async function collectSqliteHealth(rootDirectory: string, protectedDatabase?: string) {
  const root = path.resolve(rootDirectory);
  const queue = [root];
  const files = new Set<string>();
  let scanned = 0;
  while (queue.length && scanned < MAX_SCAN_ENTRIES) {
    const directory = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      scanned++;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(target);
      else if (entry.isFile() && SQLITE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.add(path.resolve(target));
      if (scanned >= MAX_SCAN_ENTRIES) break;
    }
  }
  if (protectedDatabase && fs.existsSync(protectedDatabase)) files.add(path.resolve(protectedDatabase));
  let healthy = 0;
  let unhealthy = 0;
  for (const filename of files) {
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(filename, { readOnly: true, timeout: 1_000 });
      const result = database.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
      if (result?.quick_check === 'ok') healthy++; else unhealthy++;
    } catch { unhealthy++; } finally { database?.close(); }
  }
  return { managed: files.size, healthy, unhealthy, scanned, truncated: queue.length > 0 };
}
