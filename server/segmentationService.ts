import { Jieba } from "@node-rs/jieba";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

// CDN URL for the user dictionary (vocabulary words for correct compound segmentation)
const USER_DICT_CDN = "https://d2xsxph8kpxj0f.cloudfront.net/310519663317949134/gyZHNejwRaX99q6q2mE9js/user_dict_1bcc86d6.txt";

class SegmentationService {
  private jieba: Jieba;
  private ready: Promise<void>;

  constructor() {
    this.jieba = new Jieba();
    this.ready = this.loadUserDict();
  }

  private async loadUserDict(): Promise<void> {
    try {
      // Try local file first (for development / bundled deploys)
      const localPath = join(process.cwd(), "server", "user_dict.txt");
      if (existsSync(localPath)) {
        const buf = readFileSync(localPath);
        this.jieba.loadDict(buf);
        console.log("[Segmentation] Loaded user dict from local file");
        return;
      }
      // Fall back to CDN
      const res = await fetch(USER_DICT_CDN);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      this.jieba.loadDict(Buffer.from(text));
      console.log("[Segmentation] Loaded user dict from CDN");
    } catch (err) {
      console.warn("[Segmentation] Could not load user dict, using default Jieba:", err);
    }
  }

  async waitReady(): Promise<void> {
    return this.ready;
  }

  segmentText(text: string): string[] {
    return this.jieba.cut(text, true); // HMM enabled
  }

  segmentWordsOnly(text: string): string[] {
    const tokens = this.segmentText(text);
    return tokens.filter((token) => /[\u4e00-\u9fff]/.test(token));
  }
}

// Singleton
export const segmentationService = new SegmentationService();
