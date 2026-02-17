import * as vscode from 'vscode';
import { Provider } from './provider';
import { RequestConfig } from '../http'
import { ConfigurationError } from '../error';
import { clearOutputPanel, showOutputPanel, finishOutputPanel } from '../util';
import { OpenAI } from "openai";
import { Anthropic } from "@anthropic-ai/sdk";
import DeepL from './deepl';

interface ProviderConfig {
    provider: string;
    baseUrl: string;
    apiKey: string;
    model: string;
}

interface PromptTemplate {
    prompt: string;
    systemPrompt: string;
}

interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface Options {
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    n?: number;
    stop?: string | null;
    stream?: boolean;
    clear_output: boolean;
    max_context_tokens?: number;
}

const defaultPromptTemplate: PromptTemplate = {
    systemPrompt: `
    You are a highly skilled translation engine with expertise in the technology sector. Your function is to translate texts accurately into the target {{to}}, maintaining the original format, technical terms, and abbreviations. Before translation, identify and remove all comment symbols (e.g., //, /*, */) and any associated whitespace. Preserve the structure of paragraphs, ensuring that multiple lines within a single logical sentence are combined into one before translation. After translation, format the text into coherent paragraphs, separating distinct sentences appropriately. Do not add any explanations or annotations to the translated text.
    `,
    prompt: `
Translate the following source text to {{to}}, output the translation directly without any additional text. Ensure all comment symbols are removed and sentences are combined into coherent paragraphs before translation. 
Source Text: {{text}} 
Translated Text:
    `,
}

// 默认值
const defaultOptions: Options = {
    temperature: 1,
    max_tokens: 1024,
    top_p: 1,
    n: 1,
    stream: false,

    clear_output: true,
    max_context_tokens: 4000,
};

let providerInstance: LLMProvider | null = null;

export default class LLMProvider implements Provider {
    private onDataCallback: (chunk: string) => void;

    private options: Options;
    private target_language = '';
    private text: string = "";
    private providerConfig: ProviderConfig;
    private promptTemplate: PromptTemplate = defaultPromptTemplate
    private conversationHistory: ConversationMessage[] = [];
    private contextTokens = 0;

    private constructor() {
        const ext_config = vscode.workspace.getConfiguration('ai-translate');

        this.providerConfig = {
            provider: ext_config.get<string>('ServiceProvider') || "",
            baseUrl: ext_config.get<string>('baseUrl') || "",
            apiKey: ext_config.get<string>('apiKey') || "",
            model: ext_config.get<string>('model') || "",
        }

        this.providerConfig = {
            provider: ext_config.get<string>('ServiceProvider') || "",
            baseUrl: ext_config.get<string>('baseUrl') || "",
            apiKey: ext_config.get<string>('apiKey') || "",
            model: ext_config.get<string>('model') || "",
        }

        if (!this.providerConfig.baseUrl) {
            throw new ConfigurationError("The base URL cannot be empty.");
        }
        if (!this.providerConfig.apiKey) {
            throw new ConfigurationError("The API key cannot be empty.");
        }
        if (this.providerConfig.provider != "DeepL") {
            if (!this.providerConfig.model) {
                throw new ConfigurationError("The LLM model cannot be empty");
            }
        }


        // target language
        this.target_language = ext_config.get<string>('targetLanguage') || "";

        // promptTemplate
        let promptTmpl = ext_config.get<string>('prompt') || "";
        if (promptTmpl !== "") {
            this.promptTemplate.prompt = promptTmpl;
        }

        // options
        this.options = { ...defaultOptions };
        const max_tokens = ext_config.get<number>('maxTokens') || 1024;
        const temperature = ext_config.get<number>('Temperature') || 1.0;
        const streamEnabled = ext_config.get<boolean>('stream') || false;
        const clearOutput = ext_config.get<boolean>('clearOutput') || false;
        const maxContextTokens = ext_config.get<number>('maxContextTokens') || 4000;
        if (max_tokens > 0) {
            this.options.max_tokens = max_tokens;
        }
        this.options.temperature = temperature;
        this.options.stream = streamEnabled;

        this.options.clear_output = clearOutput;
        this.options.max_context_tokens = maxContextTokens;

        // render callback
        this.onDataCallback = showOutputPanel;
    }

    public static getInstance(): LLMProvider {
        if (!providerInstance) {
            providerInstance = new LLMProvider();
        }
        return providerInstance;
    }

    public static resetInstance(): void {
        providerInstance = null;
    }

    private getPrompt(): string {
        let prompt = this.promptTemplate.prompt || "";
        prompt = prompt.replace(/{{to}}/g, this.target_language);
        prompt = prompt?.replace(/{{text}}/g, this.text);

        return prompt;
    }

    private getSystemPrompt(): string {
        let prompt = this.promptTemplate.systemPrompt || "";
        prompt = prompt.replace(/{{to}}/g, this.target_language);

        return prompt;
    }

    private setText(text: string): void {
        this.text = text;
    }

    private estimateTokens(text: string): number {
        return Math.ceil(text.length / 3);
    }

    private addToHistory(role: 'user' | 'assistant', content: string): void {
        const tokens = this.estimateTokens(content);
        this.conversationHistory.push({ role, content });
        this.contextTokens += tokens;
    }

    private shouldResetConversation(): boolean {
        const maxTokens = this.options.max_context_tokens || 4000;
        const systemPromptTokens = this.estimateTokens(this.getSystemPrompt());
        const currentPromptTokens = this.estimateTokens(this.getPrompt());
        return (this.contextTokens + systemPromptTokens + currentPromptTokens) > maxTokens;
    }

    private resetConversation(): void {
        this.conversationHistory = [];
        this.contextTokens = 0;
    }

    private getOpenAIMessages(): OpenAI.Chat.ChatCompletionMessageParam[] {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content: this.getSystemPrompt() }
        ];

        for (const msg of this.conversationHistory) {
            messages.push({ role: msg.role, content: msg.content });
        }

        messages.push({ role: "user", content: this.getPrompt() });
        return messages;
    }

    private getAnthropicMessages(): Anthropic.Messages.MessageParam[] {
        const messages: Anthropic.Messages.MessageParam[] = [];

        for (const msg of this.conversationHistory) {
            messages.push({ role: msg.role, content: msg.content });
        }

        messages.push({ role: "user", content: this.getPrompt() });
        return messages;
    }

    private async callOpenAI(): Promise<string | null> {
        if (this.shouldResetConversation()) {
            this.resetConversation();
        }

        const messages = this.getOpenAIMessages();

        const client = new OpenAI({
            apiKey: this.providerConfig.apiKey,
            baseURL: this.providerConfig.baseUrl,
        });

        try {
            if (this.options.stream) {
                const stream = await client.chat.completions.create({
                    model: this.providerConfig.model,
                    messages: messages,
                    ...this.options,
                    stream: this.options.stream,
                });

                let fullResponse = '';
                clearOutputPanel(this.options.clear_output);
                for await (const chunk of stream) {
                    const content = chunk.choices[0]?.delta?.content || '';
                    this.onDataCallback(content);

                    fullResponse += content;
                    process.stdout.write(content);
                }
                finishOutputPanel();

                this.addToHistory('user', this.text);
                this.addToHistory('assistant', fullResponse.trim());

                return fullResponse.trim();
            } else {
                const response = await client.chat.completions.create({
                    model: this.providerConfig.model,
                    messages: messages,
                    ...this.options,
                    stream: this.options.stream,
                });

                clearOutputPanel(this.options.clear_output);
                const resultStr = response.choices[0].message.content?.trim() || '';
                this.onDataCallback(resultStr);
                finishOutputPanel();

                this.addToHistory('user', this.text);
                this.addToHistory('assistant', resultStr);

                return resultStr;
            }
        } catch (error) {
            console.error(`An unexpected error occurred: ${error}`);
            throw error;
        }
    }

    private async callAnthropic(): Promise<string | null> {
        if (this.shouldResetConversation()) {
            this.resetConversation();
        }

        const messages = this.getAnthropicMessages();

        const client = new Anthropic({ baseURL: this.providerConfig.baseUrl, apiKey: this.providerConfig.apiKey });

        try {
            const response = await client.messages.create({
                model: this.providerConfig.model,
                system: this.getSystemPrompt(),
                messages: messages,
                max_tokens: 1024,
                stream: this.options.stream,
            });

            if (this.options.stream) {
                let fullResponse = "";

                let resp = response as AsyncIterable<Anthropic.Messages.RawMessageStreamEvent>
                for await (const chunk of resp) {
                    if (chunk.type === "content_block_delta") {
                        let delta = chunk.delta as Anthropic.Messages.TextDelta;
                        const content = delta?.text || "";
                        this.onDataCallback(content);
                        fullResponse += content;
                        process.stdout.write(content);
                    }
                }
                finishOutputPanel();

                this.addToHistory('user', this.text);
                this.addToHistory('assistant', fullResponse);

                return fullResponse;
            } else {
                const resp = response as Anthropic.Messages.Message;
                let resultStr = "";
                if (resp.type == "message") {
                    let textBlock = resp.content[0] as Anthropic.Messages.TextBlock;
                    resultStr = textBlock.text;
                }
                this.onDataCallback(resultStr);
                finishOutputPanel();

                this.addToHistory('user', this.text);
                this.addToHistory('assistant', resultStr);

                return resultStr || null;
            }
        } catch (error) {
            console.error(`Error occurred: ${error}`);
            throw error;
        }
    }

    public async sendRequest(config: RequestConfig): Promise<any> {
        this.setText(config.input);

        if (this.providerConfig.provider === "Anthropic") {
            return await this.callAnthropic();
        } else if (this.providerConfig.provider == "DeepL") {
            const deepLInstance = new DeepL(this.providerConfig.baseUrl, this.providerConfig.apiKey);
            deepLInstance.setText(this.text).setTargetLang(this.target_language);
            // deepLInstance.deepL().then(results => {
            //     if (results) {
            //         console.log(results); // 输出翻译结果
            //     }
            // });
            return await deepLInstance.deepL();
        } else {
            return await this.callOpenAI();
        }
    }
}