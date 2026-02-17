import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;
let logChannel: vscode.OutputChannel | undefined;

export function clearOutputPanel(clear: boolean) {
    if (outputChannel && clear) {
        outputChannel.clear();
    }
}
export function showOutputPanel(message: string) {
    // 如果 outputChannel 未初始化，则创建一个新的实例
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('ai-translate');
    }
    // 显示输出面板并追加消息
    outputChannel.show();
    outputChannel.append(message);
}

export function finishOutputPanel() {
    showOutputPanel("\r\n\r\n");
}

export function logDebug(message: string) {
    if (!logChannel) {
        logChannel = vscode.window.createOutputChannel('ai-translate Debug');
    }
    logChannel.show();
    logChannel.appendLine(message);
    console.log(message);
}