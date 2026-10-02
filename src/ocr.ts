import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { createWorker, OEM, type Worker } from "tesseract.js";

export interface TextRecognizer {
  recognize(image: Buffer): Promise<string>;
  close(): Promise<void>;
}

const require = createRequire(import.meta.url);

export class LocalTextRecognizer implements TextRecognizer {
  private worker?: Promise<Worker>;
  private languageDir?: string;

  private async getWorker(): Promise<Worker> {
    if (!this.worker) {
      this.worker = (async () => {
        const directory = await mkdtemp(path.join(tmpdir(), "receipt-ocr-"));
        this.languageDir = directory;
        await Promise.all(
          (["por", "eng"] as const).map((language) =>
            copyFile(
              require.resolve(
                `@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`,
              ),
              path.join(directory, `${language}.traineddata.gz`),
            ),
          ),
        );
        return createWorker(["por", "eng"], OEM.LSTM_ONLY, {
          langPath: directory,
          gzip: true,
          cacheMethod: "none",
        });
      })().catch(async (error: unknown) => {
        this.worker = undefined;
        if (this.languageDir) {
          await rm(this.languageDir, { recursive: true, force: true });
          this.languageDir = undefined;
        }
        throw error;
      });
    }
    return this.worker;
  }

  async recognize(image: Buffer): Promise<string> {
    const worker = await this.getWorker();
    const result = await worker.recognize(image);
    return result.data.text;
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) await (await worker).terminate();
    if (this.languageDir) {
      await rm(this.languageDir, { recursive: true, force: true });
      this.languageDir = undefined;
    }
  }
}
