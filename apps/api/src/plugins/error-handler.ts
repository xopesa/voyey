import type { FastifyError, FastifyInstance } from "fastify";
import { D1Conflict } from '@stenzo/database';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, "Request failed");

    const statusCode = error instanceof D1Conflict ? 409 : error.statusCode ?? 500;
    const message = statusCode >= 500 ? "Internal Server Error" : error.message;

    void reply.status(statusCode).send({ error: message, statusCode });
  });
}
