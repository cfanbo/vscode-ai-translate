// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { sendHttpRequest } from './http';
import { ConfigurationError } from './error';
import LLMProvider from './provider/llm';

var Loading = false;

// 服务商模型静态配置
interface ServiceProviderItem {
	name: string;
	baseurl: string;
	apikey: string;
	models: string[];
	description: string;
}
const serviceProvidersConfig: { [key: string]: ServiceProviderItem } = {
	openai: {
		name: "OpenAI",
		baseurl: 'https://api.openai.com/v1',
		apikey: 'OpenAI',
		models: ["gpt-3.5-turbo", "gpt-3.5-turbo-0125", "gpt-3.5-turbo-1106", "gpt-3.5-turbo-0613", "gpt-4-1106-preview", "gpt-4-0125-preview", "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4"],
		description: "openai"
	},
	anthropic: {
		name: "Anthropic",
		baseurl: 'https://api.anthropic.com/',
		apikey: 'Anthropic',
		models: ['claude-3-5-sonnet-20240620', 'claude-3-haiku-20240307', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229'],
		description: "https://docs.anthropic.com/en/docs/welcome"
	},
	deepl: {
		name: "DeepL",
		baseurl: 'https://api-free.deepl.com',
		apikey: '',
		models: [],
		description: "https://www.deepl.com/"
	},
	// aws: {
	// 	name: "AWS",
	// 	baseurl: 'https://aws.io/openai/',
	// 	apikey: 'yyyyyyy',
	// 	models: [],
	// 	description: ""
	// },
	glm: {
		name: "GLM",
		baseurl: "https://open.bigmodel.cn/api/paas/v4",
		apikey: 'GLM',
		models: ['codegeex-4', 'glm-4-flash', 'glm-4v-plus', 'glm-4-0520', 'glm-4-long', 'glm-4v', 'glm-4-air', 'glm-4', 'glm-4-9b', 'glm-4-flashx'],
		description: ""
	},
	doubao: {
		name: "Doubao",
		baseurl: 'https://ark.cn-beijing.volces.com/api/v3',
		apikey: 'Doubao',
		models: [],
		description: ""
	},
	deepseek: {
		name: "Deepseek",
		baseurl: 'https://api.deepseek.com',
		apikey: 'Deepseek',
		models: ["deepseek-chat", "deepseek-coder"],
		description: "https://platform.deepseek.com/api_keys"
	},
	dashscope: {
		name: "Dashscope",
		baseurl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		apikey: 'Dashscope',
		models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
		description: ""
	},
	// azure: {
	// 	name: "azure",
	// 	baseurl: 'https://api.cognitive.microsofttranslator.com/',
	// 	apikey: 'azure',
	// 	models: [],
	// 	description: "https://learn.microsoft.com/zh-cn/azure/ai-services/translator/"
	// },
	github: {
		name: "GitHub",
		baseurl: 'https://models.inference.ai.azure.com',
		apikey: 'github',
		models: ['gpt-4o', 'gpt-4o-mini', "Meta-Llama-3.1-405B-Instruct", "Meta-Llama-3.1-70B-Instruct", "Meta-Llama-3.1-8B-Instruct", "Meta-Llama-3-70B-Instruct", "Meta-Llama-3-8B-Instruct", "Mistral-Nemo", "Mistral-large", "Mistral-large-2407", "Mistral-small"],
		description: "https://gh.io/models"
	},
	gemini: {
		name: "Gemini",
		baseurl: '',
		apikey: '',
		models: ['gemini-1.0-pro-latest', 'gemini-1.0-pro-002', "gemini-1.0-pro-001", "gemini-1.5-pro-latest", "gemini-1.5-flash"],
		description: ""
	},
};

// 更新模型选项
function updateModels() {
	// 获取所有配置属性
	const currentConfig = vscode.workspace.getConfiguration();
	let selectedProviderName = currentConfig.get<string>('ai-translate.ServiceProvider') || "";
	selectedProviderName = selectedProviderName.toLowerCase()
	console.log("selectedProviderName:", selectedProviderName)

	const selectedProvider = serviceProvidersConfig[selectedProviderName];
	console.log("selectedProvider: ", selectedProvider);
	if (selectedProvider) {
		currentConfig.update('ai-translate.model', '', vscode.ConfigurationTarget.Global);
		vscode.workspace.getConfiguration().update('ai-translate.baseUrl', selectedProvider.baseurl, vscode.ConfigurationTarget.Global);

		updateModelDropdown(selectedProvider);
	}
}

function updateModelDropdown(provider: ServiceProviderItem) {
	const modelConfigKey = 'ai-translate.model';
	const models = provider.models
	const currentModel = vscode.workspace.getConfiguration().get(modelConfigKey);

	const modelDropdown: vscode.QuickPickItem[] = models.map(model => ({
		label: model,
		description: currentModel === model ? '(当前选择)' : ''
	}));

	if (modelDropdown.length == 0) {
		return;
	}

	vscode.window.showQuickPick(modelDropdown, {
		placeHolder: 'Choosing a model',
		canPickMany: false
	}).then(selected => {
		if (selected) {
			vscode.workspace.getConfiguration().update(modelConfigKey, selected.label, vscode.ConfigurationTarget.Global);
		}
	});
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// const config = vscode.workspace.getConfiguration();
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('ai-translate.ServiceProvider')) {
				updateModels();
			}
			if (e.affectsConfiguration('ai-translate')) {
				LLMProvider.resetInstance();
			}
		})
	);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "AI-Translate" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('ai-translate.Do', async () => {
		if (Loading) {
			return
		}
		Loading = true

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showWarningMessage("No active text editor found.");
			return;
		}

		// 获取当前选区
		const selections = editor.selections;

		// 检查是否有选区
		if (selections.length === 0) {
			vscode.window.showWarningMessage("No text selected.");
			return;
		}

		// 获取第一个选区的文本
		const selectedText = editor.document.getText(selections[0]);
		console.log(selectedText)

		// 在状态栏显示
		// const loadingMessage = vscode.window.setStatusBarMessage('AI服务器正在处理，请稍候...')
		const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
		statusBarItem.show();
		statusBarItem.text = ` 👾 AI服务器正在拼命的运行...`

		// 使用封装的函数发送 HTTP 请求
		try {
			await sendHttpRequest({
				input: selectedText,
			});

		} catch (error) {
			if (error instanceof ConfigurationError) {
				console.error(error.message);
				// 提示用户进行配置
				vscode.window.showWarningMessage(
					error.message + '\n 是否立即打开插件配置界面？',
					{ modal: true }, // 设置为 modal 确保对话框是模态的
					'确认'
				).then(selection => {
					if (selection === '确认') {
						vscode.commands.executeCommand('workbench.action.openSettings', 'ai-translate');
					}
				});
			} else {
				// 请求错误
				// vscode.window.showErrorMessage('Failed to fetch data.' + error.message);
				// 请求错误
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				vscode.window.showErrorMessage('Failed to fetch data: \n' + errorMessage);
			}
		}

		Loading = false
		statusBarItem.dispose();
	});

	context.subscriptions.push(disposable);

	// issue Report
	// const issue = vscode.commands.registerCommand("extension.Issue", () => {
	// 	vscode.window.showInformationMessage("TODO")
	// })
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log("ai-translate is deactived")
}
