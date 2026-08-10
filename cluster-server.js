require("dotenv").config();

const cluster = require("cluster");
const os = require("os");
const path = require("path");

function parseWorkerCount() {
  const available = typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;
  const fallback = Math.min(Math.max(available - 1, 1), 4);
  const requested = Number(process.env.WEB_CONCURRENCY || fallback);
  if (!Number.isFinite(requested) || requested < 1) {
    return fallback;
  }
  return Math.min(Math.floor(requested), Math.max(available, 1));
}

if (cluster.isPrimary) {
  const workerCount = parseWorkerCount();
  cluster.setupPrimary({
    exec: path.join(__dirname, "server.js")
  });

  console.log(`Starting CRM cluster with ${workerCount} Node workers.`);

  for (let index = 0; index < workerCount; index += 1) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.error(`CRM worker ${worker.process.pid} exited (${signal || code}). Restarting.`);
    cluster.fork();
  });
} else {
  require("./server");
}
