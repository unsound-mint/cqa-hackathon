import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';

buildApp()
  .listen({ port, host })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
