import net from 'net';

/**
 * Checks if a TCP port on a given host is available.
 */
export function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, host);
  });
}

/**
 * Finds the next available port sequentially.
 * Checks `preferredPort` first, then increments (port + 1, port + 2, ...)
 * until the first available port is found.
 */
export async function findAvailablePort(preferredPort = 3000, host = '127.0.0.1') {
  let port = preferredPort;
  const maxAttempts = 100;

  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortAvailable(port, host)) {
      if (port !== preferredPort) {
        console.log(`[Port] Port ${preferredPort} is in use on ${host}. Using next free port: ${port}`);
      }
      return port;
    }
    port++;
    if (port > 65535) {
      port = 1024;
    }
  }

  throw new Error(`Could not find an available port on ${host} starting from ${preferredPort}.`);
}
