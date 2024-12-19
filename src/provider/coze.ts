import * as vscode from 'vscode';
import axios from 'axios';
import { Readable } from 'stream';
import { Provider } from './provider';
import { RequestConfig } from '../http'
import { ConfigurationError } from '../error';
import {clearOutputPanel, showOutputPanel, finishOutputPanel } from '../util';

export default class CozeProvider implements Provider {
    private botId: string;
    private token: string;
    private streamEnabled: boolean;
    private clearOutput: boolean;
    private onDataCallback: (chunk: string) => void;  // 回调函数

    constructor(botId: string, token: string) {
        if (!botId) {
            throw new ConfigurationError("botId 不能为空");
        }
        if (!token) {
            throw new ConfigurationError("token 不能为空");
        }

        // 流式输出
        const ext_config = vscode.workspace.getConfiguration('ai-translate');
        const streamEnabled = ext_config.get<boolean>('stream') || false;
        const clearOutput = ext_config.get<boolean>('LLM.clearOutput') || true;

        this.botId = botId;
        this.token = token;
        this.streamEnabled = streamEnabled;
        this.clearOutput = clearOutput;
        this.onDataCallback = showOutputPanel;
    }

    async sendRequest(config: RequestConfig): Promise<any> {
        try {
            let headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.token
            }

            let data = {
                "bot_id": this.botId,
                "user_id": "ai-translate",
                "stream": this.streamEnabled,
                "auto_save_history": true,
                "additional_messages": [
                    {
                        "role": "user",
                        "content": config.input,
                        "content_type": "text"
                    }
                ]
            }

            let url = `https://api.coze.cn/v3/chat`;
            const response = await axios.request({
                timeout: 100000,
                url: url,
                method: 'POST',
                headers: headers,
                data: data,
                responseType: this.streamEnabled ? 'stream' : 'json'
            });

            if (this.streamEnabled) {
                return new Promise((resolve, reject) => {
                    const stream = response.data as Readable;

                    clearOutputPanel(this.clearOutput);
                    let bufferText = "";
                    stream.on('data', (chunk: Buffer) => {
                        const chunkStr = chunk.toString();
                        // console.log('Received chunk:', chunkStr);

                        // eventType
                        let event = "";
                        const eventMatch = chunkStr.match(/event:(.*)/);
                        if (eventMatch && eventMatch[1]) {
                            event = eventMatch[1].trim();
                        }
                        // console.log("event =", event);

                        // https://www.coze.cn/docs/developer_guides/chat_v3#544e4a28
                        if (event == "conversation.message.delta") {
                            const match = chunkStr.match(/data:(.*)/);
                            if (match && match[1]) {
                                try {
                                    const jsonData = JSON.parse(match[1].trim());
                                    let text = jsonData.content;
                                    // console.log(text)

                                    // 解决vscode console output 控制台，当输出内容长度过小时，经常性的不打印的 BUG
                                    bufferText += text;
                                    if (bufferText.length > 3) {
                                        this.onDataCallback(bufferText);  // 调用回调函数
                                        bufferText = "";
                                    }
                                } catch (error) {
                                    console.error('Failed to parse JSON:', error);
                                }
                            }
                        }

                        // switch (event) {
                        //     case "conversation.message.delta":
                        //         console.log("增量消息，通常是 type=answer 时的增量消息。");
                        //     case "conversation.message.completed":
                        //         console.log("message 已回复完成");
                        //     case "conversation.chat.completed":
                        //         console.log("对话完成");
                        //     case "conversation.chat.failed":
                        //         console.log("此事件用于标识对话失败。")
                        //     case "conversation.chat.requires_action":
                        //         console.log("对话中断，需要使用方上报工具的执行结果。")
                        //     case "error":
                        //         console.log("流式响应过程中的错误事件。关于 code 和 msg 的详细说明，可参考错误码: https://www.coze.cn/docs/developer_guides/coze_error_codes");
                        //     case "done":
                        //         console.log("本次会话的流式返回正常结束。");
                        //     case "conversation.chat.created":
                        //         console.log("服务端正在处理对话。")
                        //     case "conversation.chat.in_progress":
                        //         console.log("创建对话的事件，表示对话开始。")
                        //     default:
                        //         console.log(event)
                        // }

                    });

                    stream.on('end', () => {
                        console.log("stream data finished")
                        if (bufferText.length > 0) {
                            // console.log(bufferText);
                            this.onDataCallback(bufferText);
                            finishOutputPanel();
                        }
                        resolve({ text: bufferText });
                    });

                    stream.on('error', (error) => {
                        console.log(error)
                        reject(error);
                    });
                });
            } else {
                // 普通请求方式
                if (response.data.data.status == 'in_progress') {
                    try {
                        // 1. 检查bot会话状态状态 https://www.coze.cn/docs/developer_guides/get_chat_response
                        await this.check_session_status(response.data.data.conversation_id, response.data.data.id)
                        // 2. 获取最后一次bot响应
                        clearOutputPanel(this.clearOutput);
                        let content = await this.fetch_llm_response(response.data.data.conversation_id, response.data.data.id)
                        this.onDataCallback(content);
                        finishOutputPanel();
                        return { text: content }
                    } catch (error) {
                        throw error;
                    }

                } else {
                    return { text: response.data.msg };
                }
            }

        } catch (error) {
            console.error('Coze Request failed:', error);
            throw error;
        }
    }

    async check_session_status(conversation_id: string, chat_id: string) {
        console.log("check_session_status:", conversation_id, chat_id)
        let url = 'https://api.coze.cn/v3/chat/retrieve';
        let headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + this.token
        }

        while (true) { // 使用 while(true) 进行无限循环
            try {
                const response = await axios.request({
                    timeout: 100000,
                    url: url,
                    method: 'GET',
                    headers: headers,
                    params: {
                        conversation_id: conversation_id,
                        chat_id: chat_id
                    }
                });

                // 检查响应状态
                if (response.data.data.status !== 'in_progress') {
                    return response.data; // 返回最终的响应数据
                }
            } catch (error) {
                console.error('Error fetching response:', error);
                throw error; // 重新抛出错误或根据需求处理
            }

            // 加入延迟以避免发送过多请求
            await new Promise(resolve => setTimeout(resolve, 1000)); // 每次循环等待 1 秒
        }

    }

    async fetch_llm_response(conversation_id: string, chat_id: string) {
        console.log("fetch_llm_response:", conversation_id, chat_id)
        let url = ' https://api.coze.cn/v3/chat/message/list';
        let headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + this.token
        }

        try {
            const response = await axios.request({
                timeout: 100000,
                url: url,
                method: 'GET',
                headers: headers,
                params: {
                    conversation_id: conversation_id,
                    chat_id: chat_id
                }
            });

            // 检查响应状态
            let resp = response.data
            let last_session_idx = resp.data.length - 1

            for (let idx = 0; idx <= last_session_idx; idx++) {
                let item = resp.data[idx]
                if (item.role == 'assistant' && item.type == 'answer') {
                    return item.content
                }
            }

            return "Sorry, coze bot Exception!"
        } catch (error) {
            console.error('Error fetching response:', error);
            throw error; // 重新抛出错误或根据需求处理
        }
    }
}