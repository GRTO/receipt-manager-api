export interface Config {
  host: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.HOST?.trim() || "127.0.0.1";
  const portText = env.PORT?.trim() || "3000";
  const port = Number(portText);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return { host, port };
}
