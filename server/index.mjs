import { createApp } from "./app.mjs";

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || "127.0.0.1";
const app = createApp();
app.server.listen(port, host, () => {
  const address = app.server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  console.log(
    `Noahbrain demo API listening on ${host}:${boundPort}. No external messages are sent.`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
