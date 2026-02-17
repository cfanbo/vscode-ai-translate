import LLMProvider from './provider/llm';

export interface RequestConfig {
    input?: any;
}

/**
 * 发送 HTTP 请求的通用函数
 * @param config 请求配置对象
 * @returns Promise 包含响应数据
 */
export async function sendHttpRequest(config: RequestConfig): Promise<any> {
    try {
        const provider = LLMProvider.getInstance();
        const response = await provider.sendRequest(config);
        return response;
    } catch (error) {
        console.error('Request failed:', error);
        throw error;
    }
}
