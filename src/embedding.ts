export interface EmbeddingOptions { signal?: AbortSignal }
export interface EmbeddingProvider {
  model: string; baseUrl?: string; dimensions?: number;
  embed(text: string, options?: EmbeddingOptions): Promise<number[]>;
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  constructor(public readonly model: string, public readonly baseUrl: string, private apiKey: string,
    private fetcher: typeof fetch = fetch, public readonly dimensions = 1024) {}
  async embed(input: string, options: EmbeddingOptions = {}): Promise<number[]> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
      signal: options.signal, method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input, dimensions: this.dimensions, encoding_format: 'float' }),
    });
    if (!response.ok) throw new Error(`embedding HTTP ${response.status}`);
    const data = await response.json() as { data: Array<{ embedding: number[] }> };
    return data.data[0].embedding;
  }
}
