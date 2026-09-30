import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const extensions: Record<ImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function detectImageType(bytes: Buffer): ImageType | null {
  if (
    bytes.length >= 3 &&
    bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  )
    return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return null;
}

export function imageTypeFromKey(key: string): ImageType | null {
  const extension = key.slice(key.lastIndexOf(".") + 1);
  return (
    (Object.entries(extensions).find(
      ([, value]) => value === extension,
    )?.[0] as ImageType | undefined) ?? null
  );
}

export interface ImageStorage {
  put(ownerId: string, bytes: Buffer, type: ImageType): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalImageStorage implements ImageStorage {
  constructor(private readonly root: string) {}

  private filePath(key: string): string {
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key))
      throw new Error("Invalid image key");
    return path.join(this.root, ...key.split("/"));
  }

  async put(ownerId: string, bytes: Buffer, type: ImageType): Promise<string> {
    const key = `${ownerId}/${randomUUID()}.${extensions[type]}`;
    const file = this.filePath(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.filePath(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.filePath(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
