import * as vscode from 'vscode';
import { Provider } from './provider/provider';
import BailianProvider from './provider/bailian';
import CozeProvider from './provider/coze';
import LLMProvider from './provider/llm';

export interface RequestConfig {
    input?: any;
    // headers?: Record<string, string>;
    // data?: any;
    // params?: Record<string, any>;
}

/**
 * 发送 HTTP 请求的通用函数
 * @param config 请求配置对象
 * @returns Promise 包含响应数据
 */
export async function sendHttpRequest(config: RequestConfig): Promise<any> {
    try {
        const provider = createProvider();
        const response = await provider.sendRequest(config);
        return response;
    } catch (error) {
        console.error('Request failed:', error);
        throw error;
    }
}


function createProvider(): Provider {
    // 获取扩展的配置
    const ext_config = vscode.workspace.getConfiguration('ai-translate');
    const provider = ext_config.get<string>('provider'); // 获取 provider 配置

    if (provider === 'bailian') {
        const APP_ID = ext_config.get<string>('bailian.APP_ID') || '';
        const API_KEY = ext_config.get<string>('bailian.API_KEY') || '';
        return new BailianProvider(APP_ID, API_KEY);
    } else if (provider === 'coze') {
        const botId = ext_config.get<string>('coze.botId') || '';
        const token = ext_config.get<string>('coze.token') || '';
        return new CozeProvider(botId, token);
    } else if (provider == 'LLM') {
        return new LLMProvider();
    } else {
        throw new Error(`Unsupported provider: ${provider}`);
    }
}
