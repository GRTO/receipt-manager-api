export interface Config {
  host: string;
  port: number;
  databaseUrl?: string;
  supabaseUrl?: string;
  storageBucket?: string;
  storageEndpoint?: string;
}

function optionalUrl(
  value: string | undefined,
  name: string,
): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    const url = new URL(text);
    const allowedProtocols =
      name === "DATABASE_URL"
        ? ["postgres:", "postgresql:"]
        : ["https:", "http:"];
    if (!allowedProtocols.includes(url.protocol)) {
      throw new Error();
    }
    if (!url.hostname) throw new Error();
    return text;
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.HOST?.trim() || "127.0.0.1";
  const portText = env.PORT?.trim() || "3000";
  const port = Number(portText);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const databaseUrl = optionalUrl(env.DATABASE_URL, "DATABASE_URL");
  const supabaseUrl = optionalUrl(env.SUPABASE_URL, "SUPABASE_URL");
  const storageEndpoint = optionalUrl(env.STORAGE_ENDPOINT, "STORAGE_ENDPOINT");
  const storageBucket = env.STORAGE_BUCKET?.trim() || undefined;

  if (supabaseUrl && new URL(supabaseUrl).protocol !== "https:") {
    throw new Error("SUPABASE_URL must use HTTPS");
  }
  if (storageBucket && !/^[a-z0-9][a-z0-9.-]{2,62}$/.test(storageBucket)) {
    throw new Error("STORAGE_BUCKET must be a valid bucket name");
  }

  return {
    host,
    port,
    databaseUrl,
    supabaseUrl,
    storageBucket,
    storageEndpoint,
  };
}
