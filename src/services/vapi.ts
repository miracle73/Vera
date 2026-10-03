import axios, { AxiosInstance } from "axios";
import { config } from "../config";
import { logger } from "../middleware/requestLogger";

class VapiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: "https://api.vapi.ai",
      headers: {
        Authorization: `Bearer ${config.vapi.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
  }

  async createAssistant(options: {
    name: string;
    model: string;
    voice: string;
    firstMessage: string;
    systemPrompt: string;
    functions: Array<{ name: string; description: string; parameters: any }>;
  }): Promise<any> {
    try {
      const { data } = await this.client.post("/assistant", {
        name: options.name,
        firstMessage: options.firstMessage,
        model: {
          provider: "openrouter",
          model: config.openrouter.model,
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content: options.systemPrompt,
            },
          ],
          toolCalls: options.functions.map((fn) => ({
            type: "function",
            function: {
              name: fn.name,
              description: fn.description,
              parameters: fn.parameters,
            },
          })),
        },
        voice: {
          provider: "11labs",
          voiceId: options.voice,
        },
        server: {
          url: `${process.env.PUBLIC_URL || "http://localhost:3000"}/webhook/vapi`,
          headers: {
            "x-vera-secret": config.vapi.apiKey,
          },
        },
        credentials: config.openrouter.apiKey
          ? [{ provider: "openrouter", apiKey: config.openrouter.apiKey }]
          : undefined,
        interruptionThreshold: 500,
        endCallFunctionEnabled: true,
        transferPlan: {
          sipEnabled: true,
        },
      });

      logger.info("Vapi assistant created", { id: data.id, name: options.name });
      return data;
    } catch (err) {
      logger.error("Failed to create Vapi assistant", {
        error: (err as Error).message,
      });
      throw err;
    }
  }

  async updateAssistant(
    assistantId: string,
    updates: Record<string, any>
  ): Promise<any> {
    const { data } = await this.client.patch(`/assistant/${assistantId}`, updates);
    return data;
  }

  async getAssistant(assistantId: string): Promise<any> {
    const { data } = await this.client.get(`/assistant/${assistantId}`);
    return data;
  }
}

export const vapiService = new VapiService();
