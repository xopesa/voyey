import Fastify from "fastify";
import { buildApp } from "./application.js";

// Native Fastify entrypoint for Vercel: one reusable app, no listen/process exit.
const app = buildApp({}, Fastify);
export default app;
