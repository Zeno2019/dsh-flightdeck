import { createServer, type Server } from "node:net";
import { LOOPBACK_HOST } from "../shared/contracts.js";

export class PortReservationError extends Error {
  readonly name = "PortReservationError";

  constructor(message: string) {
    super(message);
  }
}

/**
 * Binds a temporary IPv4 loopback socket, reads the OS-assigned concrete port,
 * closes the socket, and returns the port for the DSH child process. The port
 * is reserved, never parsed from child output (plan section 3.2).
 */
export async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await listenOnLoopback(server);
  try {
    return tcpPortOf(server);
  } finally {
    await closeServer(server);
  }
}

function listenOnLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => resolve());
  });
}

function tcpPortOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new PortReservationError("reserved loopback socket has no TCP address");
  }
  return address.port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
